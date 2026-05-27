import { withRetry } from "../gemini/client";
import { repairJSON, getActiveGenAI, type ExtractedWall } from "../gemini/planAnalyzer";
import { auditAiCall, recordAiUsage, geminiUsageFromResponse } from "../audit/aiAuditor";

/**
 * Estagio S7 da metodologia: leitura focada de cotas dimensionais.
 *
 * Em vez de pedir ao Gemini para "ler cotas E classificar paredes E
 * contar comodos" num so prompt, aqui pedimos UMA coisa: liste TODAS
 * as cotas anotadas na planta com posicao (x, y) e valor numerico.
 *
 * Depois, codigo deterministico associa cada cota a parede mais proxima
 * compativel com a direcao (cotas horizontais para paredes horizontais,
 * idem verticais). O comprimento da parede e atualizado quando uma cota
 * compativel e encontrada — measurement_source="cota_text_focused".
 */

export interface CotaReading {
  /** Texto bruto lido (ex: "4,64 m", "350", "1.20"). */
  text: string;
  /** Valor em metros (ja convertido de cm se necessario). */
  value_m: number;
  /** Posicao do centro do texto, normalizado 0-1000. */
  x: number;
  y: number;
  /** Orientacao da cota: horizontal (para parede horizontal) ou vertical. */
  orientation: "horizontal" | "vertical" | "unknown";
  confidence: number;
}

interface CotaJob {
  projectId: number;
  pageIndex: number;
  pavimento: string;
  base64: string;
  mimeType: string;
}

const COTA_MODEL = "gemini-2.5-pro";

function buildCotaPrompt(pavimento: string): string {
  return `TAREFA UNICA: liste TODAS as cotas dimensionais anotadas nesta planta arquitetonica do pavimento "${pavimento}".

NAO classifique paredes.
NAO trace envelope.
NAO conte comodos.
NAO estime nada visualmente — apenas leia o que esta ESCRITO.

O que e "cota dimensional":
- Numero anotado entre setas, tracos ou linhas auxiliares indicando uma distancia.
- Pode estar em metros (ex: "4,64 m", "0,80m") ou centimetros (ex: "464", "80").
- Tipicamente acima ou abaixo de paredes horizontais; ao lado de paredes verticais.

Para cada cota:
- text: texto exato como aparece (com unidade se houver).
- value_m: valor convertido para METROS.
  * Se o numero original tinha "m" ou virgula/ponto decimal e estava entre 0.4 e 30, esta em metros — use direto.
  * Se o numero original e inteiro > 30 (ex: 80, 350, 1200), esta em centimetros — divida por 100.
- x, y: posicao do texto em coordenadas 0-1000.
- orientation: "horizontal" se o texto esta entre setas horizontais (cota indica distancia X);
                "vertical" se entre setas verticais (cota indica distancia Y);
                "unknown" se incerto.
- confidence: 0.0 a 1.0.

IGNORE:
- Nomes de comodos ("SALA", "QUARTO", etc.) — nao sao cotas.
- Areas em m² ("15.57 m²") — vao para outro estagio.
- Codigos de esquadrias ("P1", "J2") — outro estagio.
- Cotas de altura em cortes/elevacoes — esta etapa e so planta_baixa.

Output JSON valido, sem texto antes ou depois, sem markdown:
{
  "cotas": [
    { "text": "4,64 m", "value_m": 4.64, "x": 250, "y": 480, "orientation": "horizontal", "confidence": 0.95 },
    ...
  ]
}

Casas tipicas tem 10-40 cotas; plantas grandes 50-100. Se ver >150, voce esta confundindo numero de comodo ou ID de esquadria — refaca.`;
}

function validateCota(raw: any): CotaReading | null {
  if (!raw || typeof raw !== "object") return null;
  const value_m = Number(raw.value_m);
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(value_m) || value_m <= 0 || value_m > 50) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 1000 || y < 0 || y > 1000) return null;
  const orientation =
    raw.orientation === "horizontal" || raw.orientation === "vertical" ? raw.orientation : "unknown";
  return {
    text: String(raw.text || "").slice(0, 32),
    value_m,
    x,
    y,
    orientation,
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0.7)),
  };
}

async function readCotasOnePage(job: CotaJob): Promise<{ pavimento: string; cotas: CotaReading[] }> {
  const prompt = buildCotaPrompt(job.pavimento);
  const parts = [{ inlineData: { mimeType: job.mimeType, data: job.base64 } }, { text: prompt }];

  const text = await auditAiCall(
    {
      projectId: job.projectId,
      pageId: job.pageIndex,
      promptVersion: "cotaReader_v1",
      model: COTA_MODEL,
      inputSummary: `cotas pavimento="${job.pavimento}" page=${job.pageIndex}`,
    },
    async () => {
      return withRetry(async () => {
        const response = await getActiveGenAI().models.generateContent({
          model: COTA_MODEL,
          contents: [{ role: "user", parts }],
          // Thinking moderado: leitura de texto e mais visual+OCR, menos raciocinio.
          config: { maxOutputTokens: 12288, thinkingConfig: { thinkingBudget: 4096 } },
        });
        recordAiUsage(geminiUsageFromResponse(response));
        return response.text ?? "";
      }, "cotaReader");
    },
  );

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { pavimento: job.pavimento, cotas: [] };
  const parsed = repairJSON(jsonMatch[0]);
  if (!parsed || !Array.isArray(parsed.cotas)) return { pavimento: job.pavimento, cotas: [] };
  const cotas: CotaReading[] = [];
  for (const c of parsed.cotas) {
    const v = validateCota(c);
    if (v) cotas.push(v);
  }
  console.log(`[COTAS] Pav "${job.pavimento}" pg ${job.pageIndex}: ${cotas.length} cota(s) lidas`);
  return { pavimento: job.pavimento, cotas };
}

export interface ReadCotasInput {
  projectId: number;
  pages: Array<{ pageIndex: number; pavimento: string; base64: string; mimeType: string }>;
}

export interface ReadCotasResult {
  /** Mapa por pavimento (chave em lowercase) → cotas lidas. */
  byPavimento: Map<string, CotaReading[]>;
}

export async function readCotas(input: ReadCotasInput): Promise<ReadCotasResult> {
  const seen = new Set<string>();
  const jobs: CotaJob[] = [];
  for (const p of input.pages) {
    if (seen.has(p.pavimento)) continue;
    seen.add(p.pavimento);
    jobs.push({
      projectId: input.projectId,
      pageIndex: p.pageIndex,
      pavimento: p.pavimento,
      base64: p.base64,
      mimeType: p.mimeType,
    });
  }

  const byPavimento = new Map<string, CotaReading[]>();
  if (jobs.length === 0) return { byPavimento };

  const results = await Promise.allSettled(jobs.map(readCotasOnePage));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      byPavimento.set(r.value.pavimento.toLowerCase(), r.value.cotas);
    } else {
      console.warn(`[COTAS] Pav "${jobs[i].pavimento}" falhou:`, (r as PromiseRejectedResult).reason?.message);
    }
  }
  return { byPavimento };
}

// ============================================================
// Merge: associar cotas a paredes pela direcao e proximidade
// ============================================================

function wallDirection(w: ExtractedWall): "horizontal" | "vertical" | "unknown" {
  if (w.endpoints) {
    const dx = Math.abs(w.endpoints.p2[0] - w.endpoints.p1[0]);
    const dy = Math.abs(w.endpoints.p2[1] - w.endpoints.p1[1]);
    if (dx > dy * 1.5) return "horizontal";
    if (dy > dx * 1.5) return "vertical";
    return "unknown";
  }
  if (w.bbox) {
    const width = w.bbox[3] - w.bbox[1];
    const height = w.bbox[2] - w.bbox[0];
    if (width > height * 1.5) return "horizontal";
    if (height > width * 1.5) return "vertical";
    return "unknown";
  }
  return "unknown";
}

function wallCenter(w: ExtractedWall): [number, number] | null {
  if (w.endpoints) {
    return [
      (w.endpoints.p1[0] + w.endpoints.p2[0]) / 2,
      (w.endpoints.p1[1] + w.endpoints.p2[1]) / 2,
    ];
  }
  if (w.bbox) {
    const [ymin, xmin, ymax, xmax] = w.bbox;
    return [(xmin + xmax) / 2, (ymin + ymax) / 2];
  }
  return null;
}

function wallApproxLengthNorm(w: ExtractedWall): number {
  if (w.endpoints) {
    return Math.hypot(
      w.endpoints.p2[0] - w.endpoints.p1[0],
      w.endpoints.p2[1] - w.endpoints.p1[1],
    );
  }
  if (w.bbox) {
    const width = w.bbox[3] - w.bbox[1];
    const height = w.bbox[2] - w.bbox[0];
    return Math.max(width, height);
  }
  return 0;
}

export interface CotaMatchResult {
  /** Numero de paredes que tiveram comprimento atualizado pela cota. */
  matched: number;
  /** Cotas que nao casaram com nenhuma parede (info, nao erro). */
  unmatched: number;
}

/**
 * Para cada parede, encontra a cota mais proxima compativel:
 *  - mesma orientacao (cota horizontal para parede horizontal).
 *  - centro da cota dentro de uma faixa proxima do centro da parede
 *    (raio ~120 unidades, ~12% do lado).
 *  - valor da cota plausivel (entre 0.5x e 2.0x do comprimento atual).
 *
 * Se houver match, sobrescreve comprimento_m, marca measurement_source.
 */
export function mergeCotasIntoWalls(
  walls: ExtractedWall[],
  cotasByPavimento: Map<string, CotaReading[]>,
): CotaMatchResult {
  let matched = 0;
  const usedCotas = new Set<CotaReading>();

  for (const wall of walls) {
    const pav = (wall.nivel || "Terreo").toLowerCase();
    const cotas = cotasByPavimento.get(pav);
    if (!cotas || cotas.length === 0) continue;

    const dir = wallDirection(wall);
    if (dir === "unknown") continue;
    const center = wallCenter(wall);
    if (!center) continue;

    const lenNorm = wallApproxLengthNorm(wall);
    const radius = Math.max(60, Math.min(180, lenNorm * 0.6));

    // Candidatos: cotas com orientacao compativel (ou unknown) E dentro do raio
    let best: CotaReading | null = null;
    let bestDist = Infinity;

    for (const c of cotas) {
      if (usedCotas.has(c)) continue;
      if (c.orientation !== "unknown" && c.orientation !== dir) continue;
      const dist = Math.hypot(c.x - center[0], c.y - center[1]);
      if (dist > radius) continue;
      // Plausibilidade contra o comprimento ATUAL (se ja temos um). Se a
      // diferenca for >2x ou <0.5x, suspeitamos que esta cota e de outra
      // parede vizinha — descartamos.
      if (wall.comprimento_m > 0.2) {
        const ratio = c.value_m / wall.comprimento_m;
        if (ratio < 0.4 || ratio > 2.5) continue;
      } else {
        // Sem comprimento atual: aceita cotas razoaveis (0.5m–25m).
        if (c.value_m < 0.5 || c.value_m > 25) continue;
      }
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }

    if (best) {
      wall.comprimento_m = best.value_m;
      wall.measurement_source = "cota_text_focused";
      wall.confidence = Math.max(wall.confidence ?? 0, 0.92);
      usedCotas.add(best);
      matched++;
    }
  }

  const totalCotas = Array.from(cotasByPavimento.values()).reduce((s, arr) => s + arr.length, 0);
  return { matched, unmatched: totalCotas - usedCotas.size };
}
