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
import { auditAiCall } from "../audit/aiAuditor";
import {
  buildClassificationPrompt,
  buildSectionHeightPrompt,
  buildAreaPrompt,
  buildImageAnnotationPrompt,
  buildCharacterizationPrompt,
  buildSanityCheckPrompt,
} from "./prompts";

export type SanityFinding = {
  severity: "warning" | "error";
  categoria:
    | "paredes_externas"
    | "paredes_internas"
    | "muros"
    | "laje_piso"
    | "laje_coberta"
    | "aberturas"
    | "geral";
  mensagem: string;
};

/**
 * Wrapper que envolve a chamada em auditAiCall quando projectId esta presente.
 * Quando ausente (modo /vision-direct sem projeto), apenas executa direto.
 */
async function withAudit<T>(
  projectId: number | undefined,
  opts: { model: string; promptVersion: string; inputSummary: string; pageId?: number | null },
  fn: () => Promise<T>,
): Promise<T> {
  if (projectId === undefined) return fn();
  return auditAiCall(
    {
      projectId,
      pageId: opts.pageId ?? null,
      promptVersion: opts.promptVersion,
      model: opts.model,
      inputSummary: opts.inputSummary,
    },
    fn,
  );
}

// ============================================================
// Tipos públicos
// ============================================================

export interface VisionDirectInput {
  filePath: string;
  fileType: string;
  fileName: string;
  defaultPeDireitoM: number; // configurado pelo usuário
  userId?: number;
  /** Quando presente, cada chamada Gemini sera persistida em ai_runs via
   * auditAiCall. Quando ausente (modo /vision-direct sem projeto), o audit
   * e pulado. */
  projectId?: number;
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

export interface ProjectCharacterization {
  tipologia: "casa_terrea" | "sobrado" | "edificio" | "comercial" | "misto" | "outro";
  programa: {
    quartos: number;
    suites: number;
    salas: number;
    banheiros: number;
    cozinhas: number;
    garagens: number;
    outros: string[];
  };
  padrao: "popular" | "medio" | "alto";
  areaConstruidaEstimada_m2: number;
  confidence: "high" | "medium" | "low";
  observacoes: string;
}

export interface VisionDirectResult {
  peDireitoUsadoM: number;
  peDireitoFonte: "corte" | "default";
  /** Pe-direito por pavimento extraido do corte (quando ha multiplos
   *  pavimentos visiveis). Chaves sao rotulos do desenho ("Terreo",
   *  "Superior", "Subsolo", "Cobertura", "Sotao"...). Vazio se so um
   *  pavimento foi detectado ou se a extracao falhou. */
  pesDireitoPorPavimento: Record<string, number>;
  /** Caracterizacao do projeto (tipologia + programa + padrao). Roda
   *  uma vez por projeto apos consolidacao. null quando a extracao
   *  falhou ou nao havia planta_baixa disponivel. */
  characterization?: ProjectCharacterization | null;
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
// Rasterizacao de PDFs
// ============================================================

/**
 * Converte paginas PDF em PNG. getFilePages() retorna PDFs individuais
 * (mimeType="application/pdf", ~500KB-2MB cada). Mandar isso pro Gemini
 * Pro em 2 chamadas paralelas por pagina sobrecarregava o gateway e
 * causava HTTP 502.
 *
 * Rasterizando para PNG ~1024px de largura, cada payload cai para
 * ~200-400KB. Paginas que ja sao raster (PNG/JPG) passam direto.
 */
async function rasterizePdfPages(
  pages: Array<{ pageIndex: number; mimeType: string; base64: string }>,
): Promise<Array<{ pageIndex: number; mimeType: string; base64: string }>> {
  const out: typeof pages = [];
  for (const p of pages) {
    if (p.mimeType !== "application/pdf") {
      out.push(p);
      continue;
    }
    try {
      const { pdfToPng } = await import("pdf-to-png-converter");
      const pdfBuffer = Buffer.from(p.base64, "base64");
      const rasterPages = await pdfToPng(pdfBuffer, {
        viewportScale: 2.5,
        pagesToProcess: [1],
        disableFontFace: false,
        useSystemFonts: false,
      });
      const sharp = (await import("sharp")).default;
      const pngContent = rasterPages[0]?.content;
      if (!pngContent) throw new Error("pdfToPng nao retornou conteudo");
      const resized = await sharp(pngContent)
        .resize({ width: 1600, withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
      out.push({
        pageIndex: p.pageIndex,
        mimeType: "image/png",
        base64: resized.toString("base64"),
      });
      console.log(
        `[VISION-DIRECT] Pag ${p.pageIndex} rasterizada: PDF ${Math.round(pdfBuffer.length / 1024)}KB -> PNG ${Math.round(resized.length / 1024)}KB`,
      );
    } catch (err: any) {
      console.warn(
        `[VISION-DIRECT] Pag ${p.pageIndex} rasterizacao falhou (${err?.message || err}); mantendo PDF`,
      );
      out.push(p);
    }
  }
  return out;
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
  const rawPages = await getFilePages(input.filePath, input.fileType);
  if (rawPages.length === 0) {
    throw new Error("Nenhuma pagina extraida do arquivo");
  }
  log(`Split: ${rawPages.length} pagina(s) extraidas`);

  // ---------- 2.5) Rasterizar PDFs em PNG ----------
  // getFilePages retorna PDFs (1-2MB cada). Sem isso, 2 chamadas Gemini
  // paralelas por pagina sobrecarregam o gateway -> HTTP 502. Em PNG,
  // payload cai para ~200-400KB.
  log(`Rasterizando paginas (se PDF)...`);
  const pages = await rasterizePdfPages(rawPages);

  // ---------- 3) Classifica páginas ----------
  log(`Classificando paginas (Gemini Pro)...`);
  const classifyResult = await withAudit(
    input.projectId,
    {
      model: MODEL_PRO,
      promptVersion: "vd_classify_v1",
      inputSummary: `Classificar ${pages.length} pagina(s)`,
    },
    () => withRetry(async () => {
    const ai = getActiveGenAI();
    const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = pages.map(
      (p) => ({ inlineData: { mimeType: p.mimeType, data: p.base64 } }),
    );
    parts.push({ text: buildClassificationPrompt(pages.map((p) => p.pageIndex)) });
    const response = await ai.models.generateContent({
      model: MODEL_PRO,
      contents: [{ role: "user", parts }],
      config: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 1024 },
      },
    });
    totalCostUsd += estimateCost(MODEL_PRO, {
      input: response.usageMetadata?.promptTokenCount,
      output: response.usageMetadata?.candidatesTokenCount,
      thinking: response.usageMetadata?.thoughtsTokenCount,
    });
    return response.text ?? "";
  }, "VISION-DIRECT-classify"),
  );

  type PageClass = { page_index: number; tipo: "planta_baixa" | "corte" | "fachada" | "outro" };
  const classifyJson = extractJson(classifyResult);
  const pageClasses: PageClass[] = Array.isArray(classifyJson?.paginas)
    ? classifyJson.paginas
    : pages.map((p) => ({ page_index: p.pageIndex, tipo: "planta_baixa" as const }));
  log(`Classes: ${pageClasses.map((c) => `${c.page_index}:${c.tipo}`).join(", ")}`);

  // ---------- 4) Pe-direito ----------
  let peDireitoUsadoM = input.defaultPeDireitoM;
  let peDireitoFonte: "corte" | "default" = "default";
  const pesDireitoPorPavimento: Record<string, number> = {};
  const cortePages = pageClasses.filter((c) => c.tipo === "corte" || c.tipo === "fachada");
  if (cortePages.length > 0) {
    log(`${cortePages.length} corte/fachada detectado(s), extraindo pe-direito real...`);
    try {
      const cortePage = pages.find((p) => p.pageIndex === cortePages[0].page_index);
      if (cortePage) {
        const heightResult = await withAudit(
          input.projectId,
          {
            model: MODEL_PRO,
            promptVersion: "vd_height_v1",
            inputSummary: `Pe-direito de corte pg ${cortePage.pageIndex}`,
            pageId: cortePage.pageIndex,
          },
          () => withRetry(async () => {
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
        }, "VISION-DIRECT-height"),
        );
        const heightJson = extractJson(heightResult);
        const pe = Number(heightJson?.pe_direito_m);
        if (Number.isFinite(pe) && pe >= 2.0 && pe <= 6.0) {
          peDireitoUsadoM = pe;
          peDireitoFonte = "corte";
          log(`Pe-direito real: ${pe.toFixed(2)}m (era default ${input.defaultPeDireitoM.toFixed(2)}m)`);
        } else {
          log(`Pe-direito do corte invalido (${heightJson?.pe_direito_m}), mantendo default ${input.defaultPeDireitoM.toFixed(2)}m`);
        }
        if (Array.isArray(heightJson?.por_pavimento)) {
          for (const entry of heightJson.por_pavimento) {
            const nome = typeof entry?.pavimento === "string" ? entry.pavimento.trim() : "";
            const alt = Number(entry?.pe_direito_m);
            if (nome && Number.isFinite(alt) && alt >= 2.0 && alt <= 6.0) {
              pesDireitoPorPavimento[nome] = alt;
            }
          }
          if (Object.keys(pesDireitoPorPavimento).length > 0) {
            log(
              `Pe-direito por pavimento: ${Object.entries(pesDireitoPorPavimento)
                .map(([k, v]) => `${k}=${v.toFixed(2)}m`)
                .join(", ")}`,
            );
          }
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

    // Chamada de area (m² por categoria). A planta anotada via Nano Banana
    // roda DEPOIS, em sequencia (no async com polling, latencia total nao
    // e mais um problema — o gateway nao corta).
    let areaResult = "";
    let lastFinishReason: string | undefined;
    let lastUsage: { input?: number; output?: number; thinking?: number } | undefined;
    try {
      areaResult = await withAudit(
        input.projectId,
        {
          model: MODEL_PRO,
          promptVersion: "vd_area_v1",
          inputSummary: `Areas m² pg ${pg.pageIndex}`,
          pageId: pg.pageIndex,
        },
        () => withRetry(async () => {
        const ai = getActiveGenAI();
        const response = await ai.models.generateContent({
          model: MODEL_PRO,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: pg.mimeType, data: pg.base64 } },
                { text: buildAreaPrompt(peDireitoUsadoM, pesDireitoPorPavimento) },
              ],
            },
          ],
          // Sem responseMimeType: combinacao com thinkingConfig parece causar
          // resposta vazia no Gemini 2.5 Pro. O regex /\{[\s\S]*\}/ em
          // extractJson() captura JSON em texto livre ou markdown wrapper.
          config: {
            temperature: 0.1,
            maxOutputTokens: 16384,
            thinkingConfig: { thinkingBudget: 2048 },
          },
        });
        const usage = response.usageMetadata;
        const finishReason = response.candidates?.[0]?.finishReason;
        lastFinishReason = finishReason;
        lastUsage = {
          input: usage?.promptTokenCount,
          output: usage?.candidatesTokenCount,
          thinking: usage?.thoughtsTokenCount,
        };
        console.log(
          `[VISION-DIRECT] Pag ${pg.pageIndex} area usage: input=${usage?.promptTokenCount} output=${usage?.candidatesTokenCount} thinking=${usage?.thoughtsTokenCount} finish=${finishReason}`,
        );
        totalCostUsd += estimateCost(MODEL_PRO, lastUsage);
        const text = response.text ?? "";
        if (!text && finishReason && finishReason !== "STOP") {
          throw new Error(`Gemini Pro finalizou sem texto (finishReason=${finishReason})`);
        }
        return text;
      }, "VISION-DIRECT-area"),
      );
    } catch (err: any) {
      console.warn(`[VISION-DIRECT] Pag ${pg.pageIndex} chamada area falhou: ${err?.message || err}`);
      result.observacoes = `Falha na chamada Gemini: ${err?.message || "desconhecida"}`;
    }

    console.log(
      `[VISION-DIRECT] Pag ${pg.pageIndex} resposta IA (${areaResult.length} chars): ${areaResult.substring(0, 400)}`,
    );

    const areaJson = areaResult ? extractJson(areaResult) : null;
    if (!areaJson) {
      console.warn(`[VISION-DIRECT] Pag ${pg.pageIndex}: JSON invalido. Resposta completa:`);
      console.warn(areaResult);
      const diag =
        `finish=${lastFinishReason ?? "?"} ` +
        `tokens=in:${lastUsage?.input ?? "?"}/out:${lastUsage?.output ?? "?"}/think:${lastUsage?.thinking ?? "?"} ` +
        `chars=${areaResult.length}`;
      const preview = areaResult ? areaResult.substring(0, 200).replace(/\s+/g, " ") : "(vazia)";
      result.observacoes =
        result.observacoes ||
        `IA nao retornou JSON parseavel. Diagnostico: ${diag}. Inicio da resposta: "${preview}"`;
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

      // Detecta JSON PARCIAL: JSON parseou mas faltaram campos numericos
      // chave. Isso aconteceu (screenshot Mauricia/Vagner): Subsolo veio
      // so com paredes_externas, os outros 4 campos ausentes -> zerados
      // silenciosamente. Agora a UI mostra exatamente o que faltou.
      const requiredFields: Array<keyof typeof areaJson> = [
        "paredes_externas",
        "paredes_internas",
        "muros",
        "laje_piso_m2",
        "laje_coberta_m2",
      ];
      const missing = requiredFields.filter((k) => !(k in areaJson));
      if (missing.length > 0) {
        const diag =
          `finish=${lastFinishReason ?? "?"} ` +
          `tokens=in:${lastUsage?.input ?? "?"}/out:${lastUsage?.output ?? "?"}/think:${lastUsage?.thinking ?? "?"} ` +
          `chars=${areaResult.length}`;
        const partialMsg = `JSON parcial — campos ausentes: [${missing.join(", ")}]. ${diag}. Reprocesse a planta.`;
        result.observacoes = result.observacoes
          ? `${partialMsg} | IA: ${result.observacoes}`
          : partialMsg;
        console.warn(`[VISION-DIRECT] Pag ${pg.pageIndex} ${partialMsg}`);
      }
    }

    // Planta anotada via gemini-2.5-flash-image (Nano Banana) — estilo
    // Gemini chat. O usuario prefere esse visual em vez do renderer SVG
    // deterministico (que sai com retangulos por cima da planta).
    log(`Pag ${pg.pageIndex}: gerando planta anotada via IA...`);
    const imgStart = Date.now();
    try {
      const annotated = await withAudit(
        input.projectId,
        {
          model: "gemini-2.5-flash-image",
          promptVersion: "vd_annotated_v1",
          inputSummary: `Planta anotada pg ${pg.pageIndex}`,
          pageId: pg.pageIndex,
        },
        () => editImage(buildImageAnnotationPrompt(), [
          { data: pg.base64, mimeType: pg.mimeType },
        ]),
      );
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
    pesDireitoPorPavimento,
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

/**
 * Caracteriza o projeto (tipologia + programa + padrao). 1 chamada Gemini
 * Pro sobre a primeira planta_baixa + totais ja extraidos como contexto.
 * Roda 1 vez por projeto apos consolidacao multi-arquivo.
 *
 * Retorna null em qualquer falha — feature e enriquecimento, nao bloqueante.
 */
export async function characterizeProject(input: {
  firstPageBase64: string;
  firstPageMimeType: string;
  totais: VisionDirectResult["totais"];
  pageCount: number;
  projectId?: number;
  pageId?: number | null;
}): Promise<{ characterization: ProjectCharacterization | null; costUsd: number }> {
  let costUsd = 0;
  try {
    const raw = await withAudit(
      input.projectId,
      {
        model: MODEL_PRO,
        promptVersion: "vd_characterization_v1",
        inputSummary: `Caracterizacao do projeto (${input.pageCount} pag)`,
        pageId: input.pageId ?? null,
      },
      () => withRetry(async () => {
        const ai = getActiveGenAI();
        const response = await ai.models.generateContent({
          model: MODEL_PRO,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: input.firstPageMimeType, data: input.firstPageBase64 } },
                {
                  text: buildCharacterizationPrompt({
                    paredesExternasM2: input.totais.paredes_externas_liquida_m2,
                    paredesInternasM2: input.totais.paredes_internas_liquida_m2,
                    murosM2: input.totais.muros_m2,
                    lajePisoM2: input.totais.laje_piso_m2,
                    lajeCobertaM2: input.totais.laje_coberta_m2,
                    paginas: input.pageCount,
                  }),
                },
              ],
            },
          ],
          config: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 1024 },
          },
        });
        costUsd += estimateCost(MODEL_PRO, {
          input: response.usageMetadata?.promptTokenCount,
          output: response.usageMetadata?.candidatesTokenCount,
          thinking: response.usageMetadata?.thoughtsTokenCount,
        });
        return response.text ?? "";
      }, "VISION-DIRECT-characterization"),
    );

    const json = extractJson(raw);
    if (!json) {
      console.warn("[VISION-DIRECT] Caracterizacao: JSON invalido");
      return { characterization: null, costUsd };
    }

    const tipologiaSet = ["casa_terrea", "sobrado", "edificio", "comercial", "misto", "outro"] as const;
    const padraoSet = ["popular", "medio", "alto"] as const;
    const confidenceSet = ["high", "medium", "low"] as const;

    const characterization: ProjectCharacterization = {
      tipologia: (tipologiaSet as readonly string[]).includes(json.tipologia)
        ? (json.tipologia as ProjectCharacterization["tipologia"])
        : "outro",
      programa: {
        quartos: Math.max(0, Number(json?.programa?.quartos) || 0),
        suites: Math.max(0, Number(json?.programa?.suites) || 0),
        salas: Math.max(0, Number(json?.programa?.salas) || 0),
        banheiros: Math.max(0, Number(json?.programa?.banheiros) || 0),
        cozinhas: Math.max(0, Number(json?.programa?.cozinhas) || 0),
        garagens: Math.max(0, Number(json?.programa?.garagens) || 0),
        outros: Array.isArray(json?.programa?.outros)
          ? json.programa.outros.filter((s: any) => typeof s === "string").slice(0, 10)
          : [],
      },
      padrao: (padraoSet as readonly string[]).includes(json.padrao)
        ? (json.padrao as ProjectCharacterization["padrao"])
        : "medio",
      areaConstruidaEstimada_m2: Math.max(0, Number(json.areaConstruidaEstimada_m2) || 0),
      confidence: (confidenceSet as readonly string[]).includes(json.confidence)
        ? (json.confidence as ProjectCharacterization["confidence"])
        : "low",
      observacoes: typeof json.observacoes === "string" ? json.observacoes.slice(0, 300) : "",
    };

    console.log(
      `[VISION-DIRECT] Caracterizacao: ${characterization.tipologia} / ${characterization.padrao} (${characterization.confidence}) — ` +
        `${characterization.programa.quartos}Q ${characterization.programa.banheiros}B ${characterization.programa.salas}S`,
    );
    return { characterization, costUsd };
  } catch (err: any) {
    console.warn(`[VISION-DIRECT] Caracterizacao falhou: ${err?.message || err}`);
    return { characterization: null, costUsd };
  }
}

/**
 * Sanity-check pos-extracao. Roda 1 chamada Gemini Flash sobre os totais
 * consolidados + characterization. Retorna findings (warning/error) — array
 * vazio se tudo parece OK. Falha graciosa: retorna [] em erro.
 */
export async function sanityCheckProject(input: {
  consolidated: VisionDirectResult;
  projectId?: number;
}): Promise<{ findings: SanityFinding[]; costUsd: number }> {
  let costUsd = 0;
  const { consolidated } = input;
  const c = consolidated.characterization;
  const totalAberturasM2 = consolidated.pages.reduce(
    (acc, p) => acc + p.aberturas.reduce((s, a) => s + (Number(a.area_m2) || 0), 0),
    0,
  );
  const programaResumo = c
    ? `${c.programa.quartos}Q ${c.programa.suites}suite ${c.programa.salas}sala ${c.programa.banheiros}banh ${c.programa.cozinhas}coz ${c.programa.garagens}gar`
    : "desconhecido";
  try {
    const raw = await withAudit(
      input.projectId,
      {
        model: MODEL_FLASH,
        promptVersion: "vd_sanity_v1",
        inputSummary: `Sanity-check (${consolidated.pages.length} pag)`,
        pageId: null,
      },
      () => withRetry(async () => {
        const ai = getActiveGenAI();
        const response = await ai.models.generateContent({
          model: MODEL_FLASH,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: buildSanityCheckPrompt({
                    tipologia: c?.tipologia ?? "outro",
                    padrao: c?.padrao ?? "medio",
                    programa: programaResumo,
                    areaConstruidaEstimada_m2: c?.areaConstruidaEstimada_m2 ?? 0,
                    paredesExternasM2: consolidated.totais.paredes_externas_liquida_m2,
                    paredesInternasM2: consolidated.totais.paredes_internas_liquida_m2,
                    murosM2: consolidated.totais.muros_m2,
                    lajePisoM2: consolidated.totais.laje_piso_m2,
                    lajeCobertaM2: consolidated.totais.laje_coberta_m2,
                    totalAberturasM2,
                    paginas: consolidated.pages.length,
                    peDireitoM: consolidated.peDireitoUsadoM,
                  }),
                },
              ],
            },
          ],
          config: {
            temperature: 0.1,
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
          },
        });
        costUsd += estimateCost(MODEL_FLASH, {
          input: response.usageMetadata?.promptTokenCount,
          output: response.usageMetadata?.candidatesTokenCount,
          thinking: response.usageMetadata?.thoughtsTokenCount,
        });
        return response.text ?? "";
      }, "VISION-DIRECT-sanity"),
    );

    const json = extractJson(raw);
    if (!json || !Array.isArray(json.findings)) {
      return { findings: [], costUsd };
    }

    const categoriaSet = new Set([
      "paredes_externas",
      "paredes_internas",
      "muros",
      "laje_piso",
      "laje_coberta",
      "aberturas",
      "geral",
    ]);
    const findings: SanityFinding[] = json.findings
      .filter(
        (f: any) =>
          f &&
          (f.severity === "warning" || f.severity === "error") &&
          categoriaSet.has(f.categoria) &&
          typeof f.mensagem === "string" &&
          f.mensagem.trim(),
      )
      .map((f: any) => ({
        severity: f.severity,
        categoria: f.categoria,
        mensagem: f.mensagem.slice(0, 300),
      }))
      .slice(0, 10);

    console.log(
      `[VISION-DIRECT] Sanity-check: ${findings.length} finding(s) — ` +
        findings.map((f) => `${f.severity}:${f.categoria}`).join(", "),
    );
    return { findings, costUsd };
  } catch (err: any) {
    console.warn(`[VISION-DIRECT] Sanity-check falhou: ${err?.message || err}`);
    return { findings: [], costUsd };
  }
}
