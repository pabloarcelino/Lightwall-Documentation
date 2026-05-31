import { withRetry } from "../gemini/client";
import { repairJSON, getActiveGenAI } from "../gemini/planAnalyzer";
import { auditAiCall, recordAiUsage, geminiUsageFromResponse } from "../audit/aiAuditor";

/**
 * Estagio S4 da metodologia passo-a-passo (Fase B): inventario visual
 * focado de paredes.
 *
 * Em vez de pedir ao Gemini para fazer 8 coisas em um prompt (classificar,
 * ler cotas, contar comodos, etc.), aqui pedimos UMA coisa: para cada
 * planta_baixa, liste cada PAREDE como um SEGMENTO com:
 *   - p1, p2 (extremidades em coordenadas 0-1000)
 *   - thickness_pct (espessura aparente em % do lado maior da imagem)
 *   - has_door / has_window (existem aberturas? — sem detalhar)
 *
 * O resultado e o "ground truth geometrico" das paredes. A classificacao
 * (externa/interna/muro) e feita DEPOIS por geometria pura (S5 — topology).
 *
 * Vantagens vs. extractGeometryParallel monolitico:
 *  - Prompt curto e focado → modelo nao "alucina" para preencher 8 campos.
 *  - Endpoints reais permitem render correto (linha sobre eixo, nao retangulo).
 *  - Classificacao geometrica fica precisa (midpoint REAL do segmento).
 */

export interface WallSegment {
  /** Identificador local (W001, W002...) — sera substituido em fusao. */
  id: string;
  pavimento: string;
  pageIndex: number;
  /** Coordenadas normalizadas 0-1000 (x, y); (0,0) = canto sup esq. */
  p1: [number, number];
  p2: [number, number];
  /** Espessura aparente em % do lado maior da imagem. Default 1.2 = 12px num lado de 1000. */
  thickness_pct: number;
  has_door: boolean;
  has_window: boolean;
  confidence: number;
}

interface InventoryJob {
  projectId: number;
  pageIndex: number;
  pavimento: string;
  base64: string;
  mimeType: string;
}

const INVENTORY_MODEL = "gemini-2.5-pro";

function buildInventoryPrompt(pavimento: string): string {
  return `TAREFA UNICA: liste TODAS as paredes desta planta arquitetonica do pavimento "${pavimento}" como segmentos de reta.

NAO classifique como externa/interna/muro.
NAO leia cotas dimensionais.
NAO conte comodos.
NAO desenhe envelope.

Para cada parede que voce ve:
- p1: extremidade inicial em coordenadas (x, y) normalizadas 0-1000.
- p2: extremidade final em coordenadas (x, y) normalizadas 0-1000.
- thickness_pct: espessura aparente em % do lado maior da imagem (tipico: 0.8 a 2.5).
- has_door: ha uma porta nesse segmento? (arco, abertura visivel).
- has_window: ha uma janela nesse segmento? (linhas paralelas curtas).
- confidence: 0.0 a 1.0 (quanto voce confia no traco identificado).

INSTRUCOES:
- Trace o segmento ao longo do EIXO CENTRAL da parede (no meio da espessura, nao em uma das faces).
- Se uma parede tem um canto (L), divida em 2 segmentos.
- Se uma parede tem uma porta no meio, ainda assim e UM unico segmento (porta e atributo).
- INCLUA muros de divisa do lote se forem visiveis (ainda como segmentos; a classificacao vem depois).
- IGNORE mobiliario (sofa, cama, mesa, vaso, geladeira) — sao tracos finos diferentes.
- Coordenadas: (0,0) = canto superior esquerdo; x cresce para direita; y cresce para baixo.

Output JSON valido, sem texto antes ou depois, sem markdown:
{
  "segments": [
    {
      "p1": [x,y], "p2": [x,y],
      "thickness_pct": 1.2,
      "has_door": false, "has_window": false,
      "confidence": 0.9
    },
    ...
  ]
}

Casas simples tem ~10-25 segmentos. Plantas grandes ~30-80. Se ver mais que 100, voce esta confundindo mobiliario com paredes — refaca.`;
}

function validateSegment(raw: any, idx: number, pavimento: string, pageIndex: number): WallSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const p1 = raw.p1;
  const p2 = raw.p2;
  if (!Array.isArray(p1) || p1.length < 2) return null;
  if (!Array.isArray(p2) || p2.length < 2) return null;
  const x1 = Number(p1[0]), y1 = Number(p1[1]);
  const x2 = Number(p2[0]), y2 = Number(p2[1]);
  for (const v of [x1, y1, x2, y2]) {
    if (!Number.isFinite(v)) return null;
    if (v < 0 || v > 1000) return null;
  }
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 5) return null; // segmento <0.5% do lado — provavel ruido
  return {
    id: `W${String(idx + 1).padStart(3, "0")}`,
    pavimento,
    pageIndex,
    p1: [x1, y1],
    p2: [x2, y2],
    thickness_pct: Math.max(0.3, Math.min(5, Number(raw.thickness_pct) || 1.2)),
    has_door: !!raw.has_door,
    has_window: !!raw.has_window,
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0.7)),
  };
}

async function inventoryOnePage(job: InventoryJob): Promise<WallSegment[]> {
  const prompt = buildInventoryPrompt(job.pavimento);
  const parts = [{ inlineData: { mimeType: job.mimeType, data: job.base64 } }, { text: prompt }];

  const text = await auditAiCall(
    {
      projectId: job.projectId,
      pageId: job.pageIndex,
      promptVersion: "wallInventory_v1",
      model: INVENTORY_MODEL,
      inputSummary: `inventario paredes pavimento="${job.pavimento}" page=${job.pageIndex}`,
    },
    async () => {
      return withRetry(async () => {
        const response = await getActiveGenAI().models.generateContent({
          model: INVENTORY_MODEL,
          contents: [{ role: "user", parts }],
          // Thinking budget alto: identificar TODAS as paredes sem omitir
          // ou incluir mobiliario exige raciocinio visual cuidadoso.
          config: { maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 8192 } },
        });
        recordAiUsage(geminiUsageFromResponse(response));
        return response.text ?? "";
      }, "wallInventory");
    },
  );

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(`[INVENTARIO] Pav "${job.pavimento}" pg ${job.pageIndex}: sem JSON`);
    return [];
  }
  const parsed = repairJSON(jsonMatch[0]);
  if (!parsed || !Array.isArray(parsed.segments)) {
    console.warn(`[INVENTARIO] Pav "${job.pavimento}" pg ${job.pageIndex}: segments invalidos`);
    return [];
  }

  const segments: WallSegment[] = [];
  for (let i = 0; i < parsed.segments.length; i++) {
    const seg = validateSegment(parsed.segments[i], segments.length, job.pavimento, job.pageIndex);
    if (seg) segments.push(seg);
  }

  console.log(`[INVENTARIO] Pav "${job.pavimento}" pg ${job.pageIndex}: ${segments.length} segmento(s) extraidos`);
  return segments;
}

export interface InventoryInput {
  projectId: number;
  pages: Array<{ pageIndex: number; pavimento: string; base64: string; mimeType: string }>;
}

export interface InventoryResult {
  /** Walls como segmentos com endpoints reais. */
  segments: WallSegment[];
}

/**
 * Roda inventario de paredes em paralelo por pavimento.
 * Falhas por pagina sao isoladas — retornamos os que conseguiram.
 */
export async function inventoryWalls(input: InventoryInput): Promise<InventoryResult> {
  // Dedup: 1 chamada por pavimento (mesma logica do envelopeExtractor).
  const seen = new Set<string>();
  const jobs: InventoryJob[] = [];
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

  if (jobs.length === 0) return { segments: [] };

  const results = await Promise.allSettled(jobs.map(inventoryOnePage));
  const segments: WallSegment[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") segments.push(...r.value);
    else console.warn(`[INVENTARIO] Pav "${jobs[i].pavimento}" falhou:`, (r as PromiseRejectedResult).reason?.message);
  }
  // Re-numerar globalmente para evitar IDs duplicados W001/W001 entre pavimentos.
  segments.forEach((s, i) => { s.id = `W${String(i + 1).padStart(3, "0")}`; });
  return { segments };
}

// ============================================================
// Conversao: segmentos do inventario -> ExtractedWall-like
// ============================================================

/**
 * Deriva bbox normalizado [ymin, xmin, ymax, xmax] a partir dos endpoints,
 * com folga proporcional a thickness_pct (para o retangulo ainda envolver
 * a parede inteira, util para callers legados).
 */
export function segmentToBbox(seg: WallSegment): [number, number, number, number] {
  const minX = Math.min(seg.p1[0], seg.p2[0]);
  const maxX = Math.max(seg.p1[0], seg.p2[0]);
  const minY = Math.min(seg.p1[1], seg.p2[1]);
  const maxY = Math.max(seg.p1[1], seg.p2[1]);
  // Espessura em unidades normalizadas: thickness_pct (% do lado maior, ~1000)
  const halfThick = (seg.thickness_pct / 100) * 1000 / 2;
  return [
    Math.max(0, minY - halfThick),
    Math.max(0, minX - halfThick),
    Math.min(1000, maxY + halfThick),
    Math.min(1000, maxX + halfThick),
  ];
}

// ============================================================
// Merge: enriquece walls existentes com endpoints do inventario
// ============================================================

interface WallWithBbox {
  id: string;
  nivel?: string;
  bbox?: [number, number, number, number];
  endpoints?: { p1: [number, number]; p2: [number, number] };
  /** Espessura aparente em % do lado maior (0..100). Enriquecido pelo merge
   *  quando o segment do inventario casa com a wall. */
  thickness_pct?: number;
  /** Em metros. Usado como fallback de match por ranking quando a wall nao tem bbox. */
  comprimento_m?: number;
}

/** Comprimento de um segmento em unidades normalizadas (0..1000). */
function segmentLength(s: WallSegment): number {
  return Math.hypot(s.p2[0] - s.p1[0], s.p2[1] - s.p1[1]);
}

function bboxCenter(bbox: [number, number, number, number]): [number, number] {
  const [ymin, xmin, ymax, xmax] = bbox;
  return [(xmin + xmax) / 2, (ymin + ymax) / 2];
}

function segmentCenter(seg: WallSegment): [number, number] {
  return [(seg.p1[0] + seg.p2[0]) / 2, (seg.p1[1] + seg.p2[1]) / 2];
}

function bboxOverlapArea(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const [aym, axm, ayM, axM] = a;
  const [bym, bxm, byM, bxM] = b;
  const dx = Math.max(0, Math.min(axM, bxM) - Math.max(axm, bxm));
  const dy = Math.max(0, Math.min(ayM, byM) - Math.max(aym, bym));
  return dx * dy;
}

function bboxIoU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const inter = bboxOverlapArea(a, b);
  if (inter <= 0) return 0;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Faz match entre walls (com bbox) e segments (com endpoints) por overlap
 * de bbox + proximidade de centro. Copia endpoints do segment vencedor para
 * a wall correspondente. Roda em O(N*M) — aceitavel para projetos tipicos
 * (<200 paredes total).
 *
 * @returns numero de walls que foram enriquecidas com endpoints.
 */
export function mergeEndpointsIntoWalls(
  walls: WallWithBbox[],
  segments: WallSegment[],
): number {
  if (walls.length === 0 || segments.length === 0) return 0;

  // Para cada wall, pega o melhor segment (mesma pavimento + maior IoU).
  // Threshold: IoU >= 0.10 OU distancia entre centros < 60 (em coords 0-1000).
  // Esses valores sao gentis: paredes finas/longas tendem a ter IoU baixo
  // mesmo quando casam — apoiamos com distancia de centro.
  const segByPav = new Map<string, WallSegment[]>();
  for (const s of segments) {
    const k = (s.pavimento || "Terreo").toLowerCase();
    if (!segByPav.has(k)) segByPav.set(k, []);
    segByPav.get(k)!.push(s);
  }

  // Log diagnostico — ajuda a entender mismatches de nome de pavimento entre
  // Etapa 3 (que produz walls) e Etapa 3.5 (que produz segments).
  const wallsByPav = new Map<string, number>();
  for (const w of walls) {
    const k = (w.nivel || "Terreo").toLowerCase();
    wallsByPav.set(k, (wallsByPav.get(k) || 0) + 1);
  }
  const wPavStr = Array.from(wallsByPav.entries()).map(([k, n]) => `${k}:${n}`).join(",");
  const sPavStr = Array.from(segByPav.entries()).map(([k, v]) => `${k}:${v.length}`).join(",");
  console.log(`[INVENTARIO] Por pavimento: walls={${wPavStr}}, segments={${sPavStr}}`);

  // Cada segment so pode ser usado uma vez (evita 1 segment alimentar 2 walls).
  const usedSegmentIds = new Set<string>();
  let enriched = 0;

  for (const w of walls) {
    if (!w.bbox || w.endpoints) continue; // ja tem ou nao tem como casar
    const wPavKey = (w.nivel || "Terreo").toLowerCase();
    // Quando o pavimento da wall e generico ("outro", "n/a", vazio) OU quando
    // o segByPav do pavimento dela esta vazio, o match cross-pavimento entra:
    // usa TODOS os segments. Isso resolve casos onde a Etapa 1 retorna
    // "Outro" como pavimento (Gemini nao identificou nome real) mas a Etapa
    // 3.5 detectou segments com nomes diferentes.
    const sameLevel = segByPav.get(wPavKey) || [];
    const isGenericPav = wPavKey === "outro" || wPavKey === "n/a" || wPavKey === "" || wPavKey === "todos";
    const candidates = sameLevel.length > 0 && !isGenericPav ? sameLevel : segments;

    let bestSeg: WallSegment | null = null;
    let bestScore = 0;
    const wCenter = bboxCenter(w.bbox);
    const wDiag = Math.hypot(w.bbox[2] - w.bbox[0], w.bbox[3] - w.bbox[1]) || 1;

    for (const seg of candidates) {
      if (usedSegmentIds.has(seg.id)) continue;
      const segBbox = segmentToBbox(seg);
      const iou = bboxIoU(w.bbox, segBbox);
      const sCenter = segmentCenter(seg);
      const dist = Math.hypot(wCenter[0] - sCenter[0], wCenter[1] - sCenter[1]);
      const distScore = Math.max(0, 1 - dist / wDiag);
      const score = iou * 0.6 + distScore * 0.4;
      if (score > bestScore && (iou >= 0.10 || dist < 60)) {
        bestScore = score;
        bestSeg = seg;
      }
    }

    if (bestSeg) {
      w.endpoints = { p1: [...bestSeg.p1] as [number, number], p2: [...bestSeg.p2] as [number, number] };
      // Propaga a espessura aparente do segment pra wall — o renderer usa
      // pra pintar a faixa retangular (wallStyle="filled") em vez de uma
      // linha sobre o eixo. Quando nao casa, fica undefined e o renderer
      // usa defaultThicknessPct.
      w.thickness_pct = bestSeg.thickness_pct;
      usedSegmentIds.add(bestSeg.id);
      enriched++;
    }
  }

  // NOTA: o 2nd pass de "rank-match por comprimento" foi removido (commit
  // anterior introduzia, este reverte). Razao: casar W001 do Gemini com o
  // segmento mais longo do inventario fazia COMPRIMENTOS casarem mas as
  // POSICOES fisicas nao — pintava faixas no lugar errado da planta. A
  // renderizacao agora trata os segments do inventario como fonte de verdade
  // visual; walls da Etapa 3 ficam so pra inventory logico (id, classe,
  // esquadrias). Ver server/routes.ts Etapa 4.5.

  return enriched;
}
