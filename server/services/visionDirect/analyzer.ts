/**
 * Modo Visão Direta — orquestrador.
 *
 * Pipeline mínimo:
 *  1. Pre-flight (inspectFile)
 *  2. Split em páginas (getFilePages)
 *  3. Classifica páginas (1 chamada Gemini Flash)
 *  4. Se há corte/fachada: extrai pé-direito real (1 chamada Gemini Pro)
 *  5. Para cada planta_baixa: extrai áreas em m² (1 chamada Gemini Pro por página)
 *  6. Agrega e retorna
 *
 * Custo típico: ~US$ 0,04-0,08. Latência: 30-60s.
 */

import { withRetry } from "../gemini/client";
import { repairJSON, getActiveGenAI, getFilePages } from "../gemini/planAnalyzer";
import { inspectFile } from "../preflight/inspector";
import { editImage } from "../../replit_integrations/image/client";
import {
  buildClassificationPrompt,
  buildSectionHeightPrompt,
  buildAreaPrompt,
  buildImageAnnotationPrompt,
} from "./prompts";

// ============================================================
// Tipos públicos
// ============================================================

export interface VisionDirectInput {
  filePath: string;
  fileType: string;
  fileName: string;
  defaultPeDireitoM: number; // configurado pelo usuário
  userId?: number;
  onProgress?: (msg: string) => void; // callback opcional para UI
}

export interface ParedeBreakdown {
  area_bruta_m2: number;
  area_aberturas_m2: number;
  area_liquida_m2: number;
}

export interface MuroBreakdown {
  area_bruta_m2: number;
  altura_assumida_m: number;
}

export interface Abertura {
  tipo: "janela" | "porta" | "cobogo" | "outro";
  parede: "externa" | "interna";
  largura_m: number;
  altura_m: number;
  area_m2: number;
}

export interface PageResult {
  pageIndex: number;
  pavimento: string;
  paredes_externas: ParedeBreakdown;
  paredes_internas: ParedeBreakdown;
  muros: MuroBreakdown;
  laje_piso_m2: number;
  laje_coberta_m2: number;
  aberturas: Abertura[];
  confidence: "high" | "medium" | "low";
  observacoes: string;
  /** Data URL da planta original (PNG/JPEG). */
  originalImage?: string;
  /** Data URL da planta anotada gerada pela IA (paredes pintadas).
   *  Usa modelo gemini-2.5-flash-image (estilo Gemini Web chat). Pode ser
   *  null quando a geracao de imagem falhar — UI degrada graciosamente. */
  annotatedImage?: string | null;
}

export interface VisionDirectResult {
  peDireitoUsadoM: number;
  peDireitoFonte: "corte" | "default";
  pages: PageResult[];
  totais: {
    paredes_externas_liquida_m2: number;
    paredes_internas_liquida_m2: number;
    muros_m2: number;
    laje_piso_m2: number;
    laje_coberta_m2: number;
  };
  costUsd: number;
  durationMs: number;
  preflight: {
    fileType: string;
    pageCount: number;
    isPdfVector: boolean | null;
  };
}

const MODEL_FLASH = "gemini-2.5-flash";
const MODEL_PRO = "gemini-2.5-pro";

// Pricing (USD por 1M tokens) — espelha PRICING em aiEvents.ts
const PRICING: Record<string, { input: number; output: number; thinking?: number }> = {
  "gemini-2.5-pro": { input: 1.25, output: 5.0, thinking: 5.0 },
  "gemini-2.5-flash": { input: 0.075, output: 0.3, thinking: 3.5 },
};

function estimateCost(
  model: string,
  usage: { input?: number; output?: number; thinking?: number } | undefined,
): number {
  if (!usage) return 0;
  const p = PRICING[model];
  if (!p) return 0;
  return (
    ((usage.input ?? 0) * p.input +
      (usage.output ?? 0) * p.output +
      (usage.thinking ?? 0) * (p.thinking ?? p.output)) /
    1_000_000
  );
}

function extractJson(text: string): any | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return repairJSON(match[0]);
  } catch {
    return null;
  }
}

// ============================================================
// Função principal
// ============================================================

export async function analyzeVisionDirect(
  input: VisionDirectInput,
): Promise<VisionDirectResult> {
  const start = Date.now();
  const log = (msg: string) => {
    console.log(`[VISION-DIRECT] ${msg}`);
    input.onProgress?.(msg);
  };

  let totalCostUsd = 0;

  // ---------- 1) Pre-flight ----------
  const preflight = await inspectFile(input.filePath, input.fileType);
  log(`Pre-flight: ${preflight.fileType} ${preflight.pageCount} pagina(s) vetorial=${preflight.isPdfVector}`);

  // ---------- 2) Split em páginas ----------
  const pages = await getFilePages(input.filePath, input.fileType);
  if (pages.length === 0) {
    throw new Error("Nenhuma pagina extraida do arquivo");
  }
  log(`Split: ${pages.length} pagina(s) prontas para analise`);

  // ---------- 3) Classifica páginas ----------
  log(`Classificando paginas (Gemini Flash)...`);
  const classifyResult = await withRetry(async () => {
    const ai = getActiveGenAI();
    const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = pages.map(
      (p) => ({ inlineData: { mimeType: p.mimeType, data: p.base64 } }),
    );
    parts.push({ text: buildClassificationPrompt(pages.map((p) => p.pageIndex)) });
    const response = await ai.models.generateContent({
      model: MODEL_FLASH,
      contents: [{ role: "user", parts }],
      config: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 1024 },
      },
    });
    totalCostUsd += estimateCost(MODEL_FLASH, {
      input: response.usageMetadata?.promptTokenCount,
      output: response.usageMetadata?.candidatesTokenCount,
      thinking: response.usageMetadata?.thoughtsTokenCount,
    });
    return response.text ?? "";
  }, "VISION-DIRECT-classify");

  type PageClass = { page_index: number; tipo: "planta_baixa" | "corte" | "fachada" | "outro" };
  const classifyJson = extractJson(classifyResult);
  const pageClasses: PageClass[] = Array.isArray(classifyJson?.paginas)
    ? classifyJson.paginas
    : pages.map((p) => ({ page_index: p.pageIndex, tipo: "planta_baixa" as const }));
  log(`Classes: ${pageClasses.map((c) => `${c.page_index}:${c.tipo}`).join(", ")}`);

  // ---------- 4) Pe-direito ----------
  let peDireitoUsadoM = input.defaultPeDireitoM;
  let peDireitoFonte: "corte" | "default" = "default";
  const cortePages = pageClasses.filter((c) => c.tipo === "corte" || c.tipo === "fachada");
  if (cortePages.length > 0) {
    log(`${cortePages.length} corte/fachada detectado(s), extraindo pe-direito real...`);
    try {
      const cortePage = pages.find((p) => p.pageIndex === cortePages[0].page_index);
      if (cortePage) {
        const heightResult = await withRetry(async () => {
          const ai = getActiveGenAI();
          const response = await ai.models.generateContent({
            model: MODEL_PRO,
            contents: [
              {
                role: "user",
                parts: [
                  { inlineData: { mimeType: cortePage.mimeType, data: cortePage.base64 } },
                  { text: buildSectionHeightPrompt() },
                ],
              },
            ],
            config: {
              temperature: 0.1,
              maxOutputTokens: 1024,
              responseMimeType: "application/json",
              thinkingConfig: { thinkingBudget: 2048 },
            },
          });
          totalCostUsd += estimateCost(MODEL_PRO, {
            input: response.usageMetadata?.promptTokenCount,
            output: response.usageMetadata?.candidatesTokenCount,
            thinking: response.usageMetadata?.thoughtsTokenCount,
          });
          return response.text ?? "";
        }, "VISION-DIRECT-height");
        const heightJson = extractJson(heightResult);
        const pe = Number(heightJson?.pe_direito_m);
        if (Number.isFinite(pe) && pe >= 2.0 && pe <= 6.0) {
          peDireitoUsadoM = pe;
          peDireitoFonte = "corte";
          log(`Pe-direito real: ${pe.toFixed(2)}m (era default ${input.defaultPeDireitoM.toFixed(2)}m)`);
        } else {
          log(`Pe-direito do corte invalido (${heightJson?.pe_direito_m}), mantendo default ${input.defaultPeDireitoM.toFixed(2)}m`);
        }
      }
    } catch (err: any) {
      console.warn(`[VISION-DIRECT] Extracao de pe-direito falhou, mantendo default: ${err?.message || err}`);
    }
  } else {
    log(`Sem cortes detectados, usando pe-direito default ${input.defaultPeDireitoM.toFixed(2)}m`);
  }

  // ---------- 5) Analisa cada planta_baixa ----------
  const plantaBaixaPages = pageClasses.filter((c) => c.tipo === "planta_baixa");
  // Fallback: se a classificacao nao identificou planta_baixa mas e o unico arquivo,
  // assume primeira pagina como planta. Evita 0 resultados em uploads de imagem unica.
  const targetPages = plantaBaixaPages.length > 0
    ? plantaBaixaPages
    : pages.map((p) => ({ page_index: p.pageIndex, tipo: "planta_baixa" as const }));

  const pageResults: PageResult[] = [];
  for (const cls of targetPages) {
    const pg = pages.find((p) => p.pageIndex === cls.page_index);
    if (!pg) continue;
    log(`Analisando planta pagina ${pg.pageIndex} (Gemini Pro)...`);

    // Sempre criamos um PageResult com a imagem original — assim a UI tem o que
    // mostrar mesmo se a IA falhar em devolver JSON valido. Os numeros sao
    // preenchidos depois caso o parse seja bem sucedido.
    const result: PageResult = {
      pageIndex: pg.pageIndex,
      pavimento: "Pavimento",
      paredes_externas: { area_bruta_m2: 0, area_aberturas_m2: 0, area_liquida_m2: 0 },
      paredes_internas: { area_bruta_m2: 0, area_aberturas_m2: 0, area_liquida_m2: 0 },
      muros: { area_bruta_m2: 0, altura_assumida_m: 2.0 },
      laje_piso_m2: 0,
      laje_coberta_m2: 0,
      aberturas: [],
      confidence: "low",
      observacoes: "",
      originalImage: `data:${pg.mimeType};base64,${pg.base64}`,
      annotatedImage: null,
    };

    let areaResult = "";
    try {
      areaResult = await withRetry(async () => {
        const ai = getActiveGenAI();
        const response = await ai.models.generateContent({
          model: MODEL_PRO,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: pg.mimeType, data: pg.base64 } },
                { text: buildAreaPrompt(peDireitoUsadoM) },
              ],
            },
          ],
          config: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 2048 },
          },
        });
        const usage = response.usageMetadata;
        const finishReason = response.candidates?.[0]?.finishReason;
        console.log(
          `[VISION-DIRECT] Pag ${pg.pageIndex} usage: input=${usage?.promptTokenCount} output=${usage?.candidatesTokenCount} thinking=${usage?.thoughtsTokenCount} finish=${finishReason}`,
        );
        totalCostUsd += estimateCost(MODEL_PRO, {
          input: usage?.promptTokenCount,
          output: usage?.candidatesTokenCount,
          thinking: usage?.thoughtsTokenCount,
        });
        const text = response.text ?? "";
        if (!text && finishReason && finishReason !== "STOP") {
          throw new Error(`Gemini Pro finalizou sem texto (finishReason=${finishReason})`);
        }
        return text;
      }, "VISION-DIRECT-area");
    } catch (err: any) {
      console.warn(`[VISION-DIRECT] Pag ${pg.pageIndex} chamada Gemini Pro falhou: ${err?.message || err}`);
      result.observacoes = `Falha na chamada Gemini: ${err?.message || "desconhecida"}`;
    }

    console.log(
      `[VISION-DIRECT] Pag ${pg.pageIndex} resposta IA (${areaResult.length} chars): ${areaResult.substring(0, 400)}`,
    );

    const areaJson = areaResult ? extractJson(areaResult) : null;
    if (!areaJson) {
      console.warn(`[VISION-DIRECT] Pag ${pg.pageIndex}: JSON invalido. Resposta completa:`);
      console.warn(areaResult);
      result.observacoes =
        result.observacoes ||
        `IA nao retornou JSON valido. Os valores estao zerados — verifique se a planta tem cotas legiveis.`;
    } else {
      console.log(
        `[VISION-DIRECT] Pag ${pg.pageIndex} JSON parseado:`,
        JSON.stringify(areaJson).substring(0, 500),
      );
      result.pavimento = typeof areaJson.pavimento === "string" ? areaJson.pavimento : "Pavimento";
      result.paredes_externas = {
        area_bruta_m2: Number(areaJson.paredes_externas?.area_bruta_m2) || 0,
        area_aberturas_m2: Number(areaJson.paredes_externas?.area_aberturas_m2) || 0,
        area_liquida_m2: Number(areaJson.paredes_externas?.area_liquida_m2) || 0,
      };
      result.paredes_internas = {
        area_bruta_m2: Number(areaJson.paredes_internas?.area_bruta_m2) || 0,
        area_aberturas_m2: Number(areaJson.paredes_internas?.area_aberturas_m2) || 0,
        area_liquida_m2: Number(areaJson.paredes_internas?.area_liquida_m2) || 0,
      };
      result.muros = {
        area_bruta_m2: Number(areaJson.muros?.area_bruta_m2) || 0,
        altura_assumida_m: Number(areaJson.muros?.altura_assumida_m) || 2.0,
      };
      result.laje_piso_m2 = Number(areaJson.laje_piso_m2) || 0;
      result.laje_coberta_m2 = Number(areaJson.laje_coberta_m2) || 0;
      result.aberturas = Array.isArray(areaJson.aberturas)
        ? areaJson.aberturas
            .filter((a: any) => a && typeof a === "object")
            .map((a: any) => ({
              tipo: ["janela", "porta", "cobogo", "outro"].includes(a.tipo) ? a.tipo : "outro",
              parede: a.parede === "interna" ? "interna" : "externa",
              largura_m: Number(a.largura_m) || 0,
              altura_m: Number(a.altura_m) || 0,
              area_m2: Number(a.area_m2) || (Number(a.largura_m) * Number(a.altura_m)) || 0,
            }))
        : [];
      result.confidence = ["high", "medium", "low"].includes(areaJson.confidence)
        ? areaJson.confidence
        : "low";
      result.observacoes =
        typeof areaJson.observacoes === "string" ? areaJson.observacoes.slice(0, 500) : "";
    }

    // Geracao da planta anotada via IA — best-effort, totalmente independente
    // do sucesso/falha do parse do JSON. Se falhar, UI mostra a original.
    log(`Pag ${pg.pageIndex}: gerando planta anotada via IA...`);
    const imgStart = Date.now();
    try {
      const annotated = await editImage(buildImageAnnotationPrompt(), [
        { data: pg.base64, mimeType: pg.mimeType },
      ]);
      result.annotatedImage = annotated;
      log(
        `Pag ${pg.pageIndex}: planta anotada OK (${Math.round(annotated.length / 1024)}KB, ${(
          (Date.now() - imgStart) /
          1000
        ).toFixed(1)}s)`,
      );
    } catch (imgErr: any) {
      console.warn(
        `[VISION-DIRECT] Pag ${pg.pageIndex} geracao de imagem falhou (${(
          (Date.now() - imgStart) /
          1000
        ).toFixed(1)}s): ${imgErr?.message || imgErr}`,
      );
    }

    pageResults.push(result);
    log(
      `Pag ${pg.pageIndex} (${result.pavimento}): ext=${result.paredes_externas.area_liquida_m2.toFixed(1)} ` +
        `int=${result.paredes_internas.area_liquida_m2.toFixed(1)} muros=${result.muros.area_bruta_m2.toFixed(1)} ` +
        `piso=${result.laje_piso_m2.toFixed(1)} coberta=${result.laje_coberta_m2.toFixed(1)} m²`,
    );
  }

  // ---------- 6) Agregar ----------
  const totais = pageResults.reduce(
    (acc, p) => ({
      paredes_externas_liquida_m2: acc.paredes_externas_liquida_m2 + p.paredes_externas.area_liquida_m2,
      paredes_internas_liquida_m2: acc.paredes_internas_liquida_m2 + p.paredes_internas.area_liquida_m2,
      muros_m2: acc.muros_m2 + p.muros.area_bruta_m2,
      laje_piso_m2: acc.laje_piso_m2 + p.laje_piso_m2,
      laje_coberta_m2: acc.laje_coberta_m2 + p.laje_coberta_m2,
    }),
    {
      paredes_externas_liquida_m2: 0,
      paredes_internas_liquida_m2: 0,
      muros_m2: 0,
      laje_piso_m2: 0,
      laje_coberta_m2: 0,
    },
  );

  const durationMs = Date.now() - start;
  log(
    `Concluido em ${(durationMs / 1000).toFixed(1)}s, ` +
      `custo US$ ${totalCostUsd.toFixed(4)}, totais: ext=${totais.paredes_externas_liquida_m2.toFixed(1)} ` +
      `int=${totais.paredes_internas_liquida_m2.toFixed(1)} muros=${totais.muros_m2.toFixed(1)} ` +
      `piso=${totais.laje_piso_m2.toFixed(1)} coberta=${totais.laje_coberta_m2.toFixed(1)} m²`,
  );

  return {
    peDireitoUsadoM,
    peDireitoFonte,
    pages: pageResults,
    totais,
    costUsd: totalCostUsd,
    durationMs,
    preflight: {
      fileType: preflight.fileType,
      pageCount: preflight.pageCount,
      isPdfVector: preflight.isPdfVector,
    },
  };
}
