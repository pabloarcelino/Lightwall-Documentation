import { withRetry } from "../gemini/client";
import { repairJSON, getActiveGenAI } from "../gemini/planAnalyzer";
import { auditAiCall, recordAiUsage, geminiUsageFromResponse } from "../audit/aiAuditor";
import type { BuildingType } from "../gemini/buildingTypePrompts";

/**
 * Etapa 1.5 — Caracterizacao precoce do projeto.
 *
 * Roda APOS a Etapa 1 (classificacao de paginas) e DEVERIA rodar antes da
 * Etapa 3 (extracao geometrica). Hoje executa em paralelo com a extracao
 * por restricoes arquiteturais do loop atual; o resultado e consumido pelas
 * etapas 3.5+ (inventory, envelope, selfCheck, describe).
 *
 * Diferente da Etapa 8 (`describeProject`), esta nao gera prosa — ela
 * produz JSON ESTRUTURADO tipado que vira contexto para os algoritmos
 * subsequentes:
 *
 *  - selfCheck usa `estimativas` (pe-direito, espessura) em vez de ranges
 *    hardcoded por buildingType, capturando padrao construtivo refinado.
 *  - wallInventory usa `paredeCountRange` como sanity check pos-deteccao.
 *  - envelopeExtractor usa `formaEnvelopePrincipal` como dica.
 *  - describeProject usa toda a caracterizacao como base da prosa final.
 *
 * Modelo: gemini-2.5-pro, thinkingBudget moderado. Custo aproximado: $0.003
 * por projeto (uma chamada, ~500KB imagens + 2KB prompt + 2KB output JSON).
 */

export type Typology =
  | "casa_terrea"
  | "casa_2_pavimentos"
  | "sobrado"
  | "edificio"
  | "comercial_loja"
  | "comercial_sala"
  | "industrial_galpao"
  | "outro";

export type Padrao = "popular" | "medio" | "alto";

export type FormaEnvelope = "retangular_simples" | "L" | "U" | "irregular";

export interface ProjectCharacterization {
  typology: Typology;
  pavimentos: string[];
  programa: Array<{ ambiente: string; qty: number }>;
  padrao: Padrao;
  estimativas: {
    paredeCountRange: [number, number];
    esquadriaCountRange: [number, number];
    espessuraParedeM: [number, number];
    peDireitoM: [number, number];
    areaTotalRangeM2: [number, number];
  };
  caracteristicas: {
    temCobertura: boolean;
    temGaragem: boolean;
    temMuros: boolean;
    temPergolado: boolean;
    formaEnvelopePrincipal: FormaEnvelope;
  };
  confidence: "high" | "medium" | "low";
  notes: string;
}

interface CharacterizationInput {
  projectId: number;
  pages: Array<{
    pageIndex: number;
    pavimento: string;
    base64: string;
    mimeType: string;
  }>;
  /** Hint vindo do formulario do usuario; serve como bias inicial. */
  buildingTypeHint?: BuildingType | null;
}

const MODEL = "gemini-2.5-pro";

function buildPrompt(buildingTypeHint?: string | null): string {
  const hintBlock = buildingTypeHint
    ? `\nHINT DO USUARIO: o cliente indicou que o tipo e "${buildingTypeHint}". Use como vies inicial, mas confirme/refine com base nas imagens.\n`
    : "";

  return `TAREFA: caracterize este projeto arquitetonico em JSON estruturado para alimentar os algoritmos de extracao subsequentes.

NAO descreva o projeto em prosa.
NAO conte cada parede individualmente.
NAO leia cotas.

Foque em identificar: tipologia, programa de ambientes, padrao construtivo, e RANGES esperados (nao valores exatos — ranges plausiveis para validar a extracao depois).
${hintBlock}
Devolva EXCLUSIVAMENTE este JSON, sem markdown, sem comentarios:
{
  "typology": "casa_terrea" | "casa_2_pavimentos" | "sobrado" | "edificio" | "comercial_loja" | "comercial_sala" | "industrial_galpao" | "outro",
  "pavimentos": ["Terreo", "Superior", ...],
  "programa": [{"ambiente": "quarto", "qty": 2}, {"ambiente": "sala", "qty": 1}, ...],
  "padrao": "popular" | "medio" | "alto",
  "estimativas": {
    "paredeCountRange": [12, 20],
    "esquadriaCountRange": [8, 14],
    "espessuraParedeM": [0.10, 0.15],
    "peDireitoM": [2.50, 2.80],
    "areaTotalRangeM2": [80, 140]
  },
  "caracteristicas": {
    "temCobertura": true,
    "temGaragem": false,
    "temMuros": true,
    "temPergolado": false,
    "formaEnvelopePrincipal": "retangular_simples" | "L" | "U" | "irregular"
  },
  "confidence": "high" | "medium" | "low",
  "notes": "observacao curta sobre o que e visivel/ambiguo"
}

DICAS PARA RANGES (use como referencia, nao como receita):
- casa_terrea popular (~50-80m2): paredes 8-14, esquadrias 5-9, espessura 0.10-0.12, pe-direito 2.50-2.70.
- casa_terrea media (~80-150m2): paredes 12-20, esquadrias 8-14, espessura 0.10-0.15, pe-direito 2.60-2.80.
- casa_terrea alta (~150-300m2): paredes 18-30, esquadrias 12-22, espessura 0.10-0.20, pe-direito 2.70-3.20.
- sobrado/casa_2_pavimentos: dobre os ranges por pavimento e some.
- comercial_loja/sala: menos paredes internas, pe-direito 3.0-4.0, esquadrias 2-6.
- industrial_galpao: poucas paredes internas (1-4), pe-direito 4.0-8.0, area > 200m2.

PROGRAMA: liste apenas os ambientes que voce VE com clareza. Sem inventar. Use nomes em minusculo: quarto, suite, sala, cozinha, bwc, lavabo, area_servico, garagem, varanda, escritorio, etc.

CONFIDENCE:
- high: ve claramente todos os comodos e cotas. Padrao e obvio.
- medium: identifica tipologia mas alguns ambientes ambiguos ou padrao incerto.
- low: imagens parciais, ilegiveis, ou conflitos entre paginas.

PAVIMENTOS: use exatamente os mesmos nomes que aparecem nas legendas das paginas (Terreo, Superior, Cobertura, Subsolo). Se so ve um, retorne ["Terreo"].`;
}

function validateRange(raw: any, min: number, max: number): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const lo = Number(raw[0]);
  const hi = Number(raw[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (lo > hi) return [hi, lo];
  if (lo < min || hi > max) return null;
  return [lo, hi];
}

function validateCharacterization(parsed: any): ProjectCharacterization | null {
  if (!parsed || typeof parsed !== "object") return null;

  const validTypologies: Typology[] = [
    "casa_terrea",
    "casa_2_pavimentos",
    "sobrado",
    "edificio",
    "comercial_loja",
    "comercial_sala",
    "industrial_galpao",
    "outro",
  ];
  const typology = validTypologies.includes(parsed.typology) ? parsed.typology : "outro";

  const padroes: Padrao[] = ["popular", "medio", "alto"];
  const padrao: Padrao = padroes.includes(parsed.padrao) ? parsed.padrao : "medio";

  const formasEnv: FormaEnvelope[] = ["retangular_simples", "L", "U", "irregular"];
  const formaEnvelope: FormaEnvelope = formasEnv.includes(parsed?.caracteristicas?.formaEnvelopePrincipal)
    ? parsed.caracteristicas.formaEnvelopePrincipal
    : "retangular_simples";

  const pavimentos: string[] = Array.isArray(parsed.pavimentos)
    ? parsed.pavimentos.filter((p: any) => typeof p === "string" && p.trim()).slice(0, 10)
    : ["Terreo"];
  if (pavimentos.length === 0) pavimentos.push("Terreo");

  const programa: Array<{ ambiente: string; qty: number }> = Array.isArray(parsed.programa)
    ? parsed.programa
        .filter((p: any) => p && typeof p.ambiente === "string" && Number.isFinite(Number(p.qty)))
        .map((p: any) => ({ ambiente: String(p.ambiente).toLowerCase().trim(), qty: Math.max(0, Math.round(Number(p.qty))) }))
        .slice(0, 30)
    : [];

  const est = parsed.estimativas ?? {};
  const paredeCountRange = validateRange(est.paredeCountRange, 1, 500) ?? [8, 25];
  const esquadriaCountRange = validateRange(est.esquadriaCountRange, 0, 200) ?? [4, 16];
  const espessuraParedeM = validateRange(est.espessuraParedeM, 0.04, 0.5) ?? [0.10, 0.15];
  const peDireitoM = validateRange(est.peDireitoM, 1.8, 8.0) ?? [2.5, 3.0];
  const areaTotalRangeM2 = validateRange(est.areaTotalRangeM2, 10, 50000) ?? [60, 200];

  const car = parsed.caracteristicas ?? {};
  const caracteristicas = {
    temCobertura: !!car.temCobertura,
    temGaragem: !!car.temGaragem,
    temMuros: !!car.temMuros,
    temPergolado: !!car.temPergolado,
    formaEnvelopePrincipal: formaEnvelope,
  };

  const confidences = ["high", "medium", "low"] as const;
  const confidence = confidences.includes(parsed.confidence) ? parsed.confidence : "low";

  const notes = typeof parsed.notes === "string" ? parsed.notes.slice(0, 600) : "";

  return {
    typology,
    pavimentos,
    programa,
    padrao,
    estimativas: { paredeCountRange, esquadriaCountRange, espessuraParedeM, peDireitoM, areaTotalRangeM2 },
    caracteristicas,
    confidence,
    notes,
  };
}

/**
 * Executa a caracterizacao. Retorna `null` se Gemini falhar ou JSON for
 * invalido — caller deve cair em fallback (selfCheck usa ranges hardcoded,
 * etc). NUNCA lanca — graceful degradation.
 */
export async function characterizeProject(
  input: CharacterizationInput,
): Promise<ProjectCharacterization | null> {
  if (input.pages.length === 0) {
    console.warn("[CARACTERIZACAO] Nenhuma planta_baixa disponivel — pulando.");
    return null;
  }

  const prompt = buildPrompt(input.buildingTypeHint ?? null);
  const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = input.pages.map((p) => ({
    inlineData: { mimeType: p.mimeType, data: p.base64 },
  }));
  parts.push({ text: prompt });

  try {
    const text = await auditAiCall(
      {
        projectId: input.projectId,
        promptVersion: "characterizeProject_v1",
        model: MODEL,
        inputSummary: `caracterizacao ${input.pages.length} planta(s) hint=${input.buildingTypeHint ?? "n/a"}`,
      },
      async () =>
        withRetry(async () => {
          const response = await getActiveGenAI().models.generateContent({
            model: MODEL,
            contents: [{ role: "user", parts }],
            config: {
              temperature: 0.1,
              maxOutputTokens: 4096,
              thinkingConfig: { thinkingBudget: 3072 },
            },
          });
          recordAiUsage(geminiUsageFromResponse(response));
          return response.text ?? "";
        }, "characterizeProject"),
    );

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[CARACTERIZACAO] Sem JSON na resposta — pulando.");
      return null;
    }
    const parsed = repairJSON(jsonMatch[0]);
    const validated = validateCharacterization(parsed);
    if (!validated) {
      console.warn("[CARACTERIZACAO] Validacao falhou — pulando.");
      return null;
    }
    console.log(
      `[CARACTERIZACAO] ${validated.typology} ${validated.padrao} | ${validated.pavimentos.join(",")} | ` +
        `${validated.programa.length} ambientes | paredes esperadas: ${validated.estimativas.paredeCountRange.join("-")} | ` +
        `confidence=${validated.confidence}`,
    );
    return validated;
  } catch (err: any) {
    console.error("[CARACTERIZACAO] Erro:", err?.message || err);
    return null;
  }
}
