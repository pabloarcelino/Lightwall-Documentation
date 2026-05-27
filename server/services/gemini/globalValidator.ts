/**
 * Global Cross-Validation Pass (Etapa 4.6)
 *
 * After per-page extraction + multi-view fusion + geometric validation, we ask
 * the AI to look at ALL planta_baixa pages **together** along with the fused
 * geometry JSON, and answer: "given the full project context, are these
 * counts and lengths plausible? Suggest corrections only when evidence is strong."
 *
 * Why this helps: the per-page extraction in Etapa 3 sees one page at a time
 * and operates under a strict JSON schema. A single global pass with a
 * conversational prompt + high reasoning budget catches:
 *   - walls counted twice across cuts/elevations
 *   - missing walls visible only when comparing pages
 *   - lengths in the wrong unit (cm vs m)
 *   - misclassifications (externa↔interna, muros↔internas)
 *
 * Conservative by design: corrections are only applied when confidence >= 0.7.
 * Toggleable via project setting (default ON for OpenAI mode, OFF for Gemini-only
 * because the global call is expensive in tokens).
 */

import { auditAiCall } from "../audit/aiAuditor";
import { getActiveProvider, createOpenAIProvider, getOpenAIModelName } from "../ai/provider";

export interface WallCorrection {
  wallId: string;
  field: "comprimento_m" | "classe" | "altura_m" | "remove";
  newValue: string | number | null;
  reason: string;
}

export interface SlabCorrection {
  slabId: string;
  field: "area_m2" | "classe" | "remove";
  newValue: string | number | null;
  reason: string;
}

export interface GlobalValidationResult {
  confidence: number;
  summary: string;
  wallCorrections: WallCorrection[];
  slabCorrections: SlabCorrection[];
  applied: { walls: number; slabs: number; removedWalls: number; removedSlabs: number };
}

const MIN_CONFIDENCE_TO_APPLY = 0.7;

function buildPrompt(walls: any[], slabs: any[]): string {
  const wallSummary = walls.map((w) => ({
    id: w.id,
    nivel: w.nivel,
    classe: w.classe,
    comprimento_m: Number(w.comprimento_m || 0).toFixed(2),
    altura_m: Number(w.altura_m || 0).toFixed(2),
  }));
  const slabSummary = slabs.map((s) => ({
    id: s.id,
    nivel: s.nivel,
    classe: s.classe,
    area_m2: Number(s.area_m2 || 0).toFixed(2),
  }));

  return `Voce e um engenheiro especialista em quantitativos de paredes e lajes Lightwall (paineis de concreto leve 3x0.61m).

Eu te entreguei TODAS as plantas baixas do projeto neste mesmo prompt. Em paralelo, abaixo esta o JSON da extracao automatica que ja passou por:
1) Classificacao de paginas
2) Extracao geometrica por pagina (chain-of-thought)
3) Fusao multivista (deduplicacao)
4) Validador geometrico (filtros de plausibilidade)

Sua tarefa: VERIFICAR se a extracao bate com o que se ve nas plantas. Procure especificamente por:
- Paredes contadas em duplicidade entre cortes/elevacoes
- Paredes visiveis nas plantas mas ausentes do JSON
- Comprimentos em unidade errada (cm em vez de m: ex. 320 deveria ser 3.20)
- Classificacao trocada (externa marcada como interna ou vice-versa)
- Lajes com area absurda ou ausente
- Muros confundidos com paredes internas

REGRAS DE OURO (siga estritamente):
- Seja CONSERVADOR. So sugira correcao quando tiver evidencia visual clara.
- NAO invente paredes novas — apenas corrija ou remova existentes.
- NAO mexa em IDs (eles sao chaves do banco de dados).
- Confidence < 0.7 = nao tenho certeza, retorne lista vazia.

Retorne APENAS um JSON estritamente neste formato (sem markdown, sem explicacao fora do JSON):
{
  "confidence": <numero 0..1 indicando confianca geral>,
  "summary": "<resumo curto em portugues do que voce verificou>",
  "wallCorrections": [
    { "wallId": "<id>", "field": "comprimento_m"|"classe"|"altura_m"|"remove", "newValue": <novo valor ou null se remove>, "reason": "<por que>" }
  ],
  "slabCorrections": [
    { "slabId": "<id>", "field": "area_m2"|"classe"|"remove", "newValue": <novo valor ou null>, "reason": "<por que>" }
  ]
}

EXTRACAO ATUAL (${walls.length} paredes, ${slabs.length} lajes):
PAREDES: ${JSON.stringify(wallSummary)}
LAJES: ${JSON.stringify(slabSummary)}`;
}

function tryParseJson(text: string): any | null {
  if (!text) return null;
  // Strip fenced markdown if any
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract first {...} block
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return null; }
    }
    return null;
  }
}

/**
 * Runs the global cross-validation. Returns the corrections that were applied
 * to the walls/slabs arrays (mutated in place).
 *
 * If the AI call fails or returns invalid JSON, returns a no-op result and
 * leaves the input arrays untouched. Pipeline must continue.
 */
export async function runGlobalCrossValidation(
  walls: any[],
  slabs: any[],
  plantaImages: Array<{ base64: string; mimeType: string }>,
  ctx: { projectId: number },
): Promise<GlobalValidationResult> {
  const noop: GlobalValidationResult = {
    confidence: 0,
    summary: "skipped",
    wallCorrections: [],
    slabCorrections: [],
    applied: { walls: 0, slabs: 0, removedWalls: 0, removedSlabs: 0 },
  };

  if (walls.length === 0 && slabs.length === 0) return noop;
  if (plantaImages.length === 0) {
    return { ...noop, summary: "sem imagens de planta para validar" };
  }

  const prompt = buildPrompt(walls, slabs);
  const inputSummary = `walls=${walls.length} slabs=${slabs.length} pages=${plantaImages.length}`;

  // Use the active provider (OpenAI or Gemini). For Gemini we use the default
  // GeminiProvider via planAnalyzer's withRetry. For OpenAI we instantiate a
  // provider with high reasoning budget.
  const provider = getActiveProvider();
  let raw = "";

  try {
    raw = await auditAiCall(
      {
        projectId: ctx.projectId,
        promptVersion: "globalCrossValidation_v1",
        model: provider === "openai" ? `openai:${getOpenAIModelName()}` : "gemini-2.5-pro",
        inputSummary,
      },
      async () => {
        if (provider === "openai") {
          const op = createOpenAIProvider();
          if (!op) throw new Error("OpenAI provider nao configurado");
          return await op.generateContent(prompt, plantaImages, { maxOutputTokens: 16384 });
        } else {
          // Gemini path: usa o cliente ATIVO (respeita setUserApiKey). Antes
          // importavamos `genAI` direto, o que falhava com 403 quando o
          // usuario definia sua propria chave via UI.
          const { getActiveGenAI } = await import("./planAnalyzer");
          const parts: any[] = plantaImages.map((img) => ({
            inlineData: { mimeType: img.mimeType, data: img.base64 },
          }));
          parts.push({ text: prompt });
          // Modelos com thinking nao aceitam topP/topK/temperature personalizados.
          // Usamos thinkingBudget alto porque esta chamada e a verificacao
          // global cruzada — onde acurar a classificacao topologica vale o custo.
          const response = await getActiveGenAI().models.generateContent({
            model: "gemini-2.5-pro",
            contents: [{ role: "user", parts }],
            config: { maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 8192 } },
          });
          const { recordAiUsage, geminiUsageFromResponse } = await import("../audit/aiAuditor");
          recordAiUsage(geminiUsageFromResponse(response));
          return response.text ?? "";
        }
      },
    );
  } catch (err: any) {
    console.warn(`[GLOBAL-VALIDATOR] Falha na chamada IA: ${err?.message || err}`);
    return { ...noop, summary: `erro IA: ${err?.message || "desconhecido"}` };
  }

  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed !== "object") {
    console.warn("[GLOBAL-VALIDATOR] Resposta IA nao e JSON valido, ignorando");
    return { ...noop, summary: "resposta invalida" };
  }

  const confidence = Number(parsed.confidence ?? 0);
  const summary = String(parsed.summary ?? "");
  const wallCorrections: WallCorrection[] = Array.isArray(parsed.wallCorrections) ? parsed.wallCorrections : [];
  const slabCorrections: SlabCorrection[] = Array.isArray(parsed.slabCorrections) ? parsed.slabCorrections : [];

  if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE_TO_APPLY) {
    console.log(`[GLOBAL-VALIDATOR] Confianca baixa (${confidence.toFixed(2)} < ${MIN_CONFIDENCE_TO_APPLY}): ${summary}`);
    return { confidence, summary, wallCorrections, slabCorrections, applied: noop.applied };
  }

  // Apply corrections (mutate in place).
  // Caps mirror server/services/calculation/geometryValidator.ts so the AI
  // cannot push values outside the same plausibility envelope. After applying,
  // the caller MUST re-run validateGeometry to enforce the full ruleset
  // (snap orthogonal, drop floating walls, slab loops, etc).
  const MAX_WALL_LEN_M = 50.0;
  const MIN_WALL_HEIGHT_M = 1.5;
  const MAX_WALL_HEIGHT_M = 6.0;
  const MAX_SLAB_AREA_M2 = 5000;

  let appliedWalls = 0, appliedSlabs = 0, removedWalls = 0, removedSlabs = 0;
  for (const wc of wallCorrections) {
    const idx = walls.findIndex((w) => w.id === wc.wallId);
    if (idx < 0) continue;
    if (wc.field === "remove") {
      walls.splice(idx, 1);
      removedWalls++;
      continue;
    }
    if (wc.field === "comprimento_m") {
      const v = Number(wc.newValue);
      if (Number.isFinite(v) && v > 0 && v <= MAX_WALL_LEN_M) {
        walls[idx].comprimento_m = v;
        appliedWalls++;
      }
    } else if (wc.field === "altura_m") {
      const v = Number(wc.newValue);
      if (Number.isFinite(v) && v >= MIN_WALL_HEIGHT_M && v <= MAX_WALL_HEIGHT_M) {
        walls[idx].altura_m = v;
        appliedWalls++;
      }
    } else if (wc.field === "classe") {
      const v = String(wc.newValue);
      if (v === "externa" || v === "interna" || v === "muro") {
        walls[idx].classe = v;
        appliedWalls++;
      }
    }
  }
  for (const sc of slabCorrections) {
    const idx = slabs.findIndex((s) => s.id === sc.slabId);
    if (idx < 0) continue;
    if (sc.field === "remove") {
      slabs.splice(idx, 1);
      removedSlabs++;
      continue;
    }
    if (sc.field === "area_m2") {
      const v = Number(sc.newValue);
      if (Number.isFinite(v) && v > 0 && v <= MAX_SLAB_AREA_M2) {
        slabs[idx].area_m2 = v;
        appliedSlabs++;
      }
    } else if (sc.field === "classe") {
      const v = String(sc.newValue);
      if (v === "piso" || v === "radier" || v === "coberta") {
        slabs[idx].classe = v;
        appliedSlabs++;
      }
    }
  }

  console.log(
    `[GLOBAL-VALIDATOR] Confianca ${confidence.toFixed(2)} | aplicadas: ` +
    `${appliedWalls} alteracoes paredes (-${removedWalls}), ${appliedSlabs} alteracoes lajes (-${removedSlabs}) | ${summary}`,
  );

  return {
    confidence,
    summary,
    wallCorrections,
    slabCorrections,
    applied: { walls: appliedWalls, slabs: appliedSlabs, removedWalls, removedSlabs },
  };
}
