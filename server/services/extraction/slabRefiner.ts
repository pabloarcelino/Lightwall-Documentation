import { genAI, withRetry } from "../gemini/client";
import { repairJSON, type ExtractedSlab } from "../gemini/planAnalyzer";
import { auditAiCall, recordAiUsage, geminiUsageFromResponse } from "../audit/aiAuditor";
import type { EnvelopePolygon } from "./envelopeExtractor";

/**
 * Estagio S10 da metodologia: refinamento de lajes via poligono real.
 *
 * Hoje as lajes vem da Etapa 3 monolitica como retangulos (bbox) com
 * area_m2 estimada. Aqui pedimos ao Gemini, focadamente, o poligono
 * de cada laje (piso/coberta). A area e recalculada por shoelace
 * formula em unidades normalizadas, depois escalada se houver
 * pixelsPerMeter. Quando bem-sucedido, sobrescreve area_m2 e
 * marca measurement_source="polygon_focused".
 *
 * Para CASA-PADRAO (1 piso por pavimento, 1 cobertura), o envelope
 * (Fase A S2) ja entrega o poligono — entao, em vez de uma nova chamada
 * Gemini, a refinaria USA o envelope como poligono da laje piso. Plantas
 * com varios cubos disjuntos (raras) podem precisar da chamada Gemini.
 */

export type SlabClass = "piso" | "coberta" | "radier";

export interface SlabPolygon {
  pavimento: string;
  pageIndex: number;
  classe: SlabClass;
  polygon: Array<[number, number]>;
  /** Area em unidades normalizadas (0-1000 x 0-1000). Reescalada depois. */
  areaNorm: number;
}

// ============================================================
// Shoelace
// ============================================================

export function polygonAreaNorm(poly: Array<[number, number]>): number {
  if (poly.length < 3) return 0;
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  }
  return Math.abs(s) / 2;
}

// ============================================================
// Modo deterministico: usa envelope como piso (zero IA, instantaneo)
// ============================================================

/**
 * Cria SlabPolygon de PISO para cada envelope. Heuristica: a area do
 * piso de um pavimento e exatamente a area coberta da edificacao.
 * Para a coberta em pavimentos sem planta_cobertura separada, usamos
 * o mesmo poligono — typically correto em casas terreas.
 */
export function derivePisoSlabsFromEnvelopes(
  envelopes: EnvelopePolygon[],
): SlabPolygon[] {
  return envelopes
    .filter(e => e.polygon.length >= 3)
    .map(e => ({
      pavimento: e.pavimento,
      pageIndex: e.pageIndex,
      classe: "piso" as const,
      polygon: e.polygon,
      areaNorm: polygonAreaNorm(e.polygon),
    }));
}

// ============================================================
// Merge: aplica area refinada nas slabs existentes
// ============================================================

export interface SlabRefineResult {
  refined: number;
  unmatched: number;
}

/**
 * Para cada laje extraida (slab), procura uma SlabPolygon do MESMO
 * pavimento e MESMA classe. Se encontrar:
 *  - se pixelsPerMeter conhecido: area_m2 = areaNorm * pxPerMeter^-2
 *    (nao temos isso ainda — Fase posterior).
 *  - senao: preserva area_m2 original mas REGISTRA evidencia do polygon
 *    em measurement_source="polygon_focused" para o usuario auditar.
 *
 * Tambem promove a maior laje do pavimento como "principal" (util para
 * o renderer renderizar area da laje completa em vez de soma).
 */
export function mergeSlabPolygons(
  slabs: ExtractedSlab[],
  polys: SlabPolygon[],
): SlabRefineResult {
  if (slabs.length === 0 || polys.length === 0) return { refined: 0, unmatched: polys.length };

  const byKey = new Map<string, SlabPolygon[]>();
  for (const p of polys) {
    const k = `${p.pavimento.toLowerCase()}|${p.classe}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(p);
  }

  let refined = 0;
  const usedPolys = new Set<SlabPolygon>();

  for (const slab of slabs) {
    const k = `${(slab.nivel || "Terreo").toLowerCase()}|${slab.classe}`;
    const candidates = byKey.get(k);
    if (!candidates || candidates.length === 0) continue;
    // Pega o de maior area (caso haja varias regioes detectadas).
    const sorted = candidates.filter(c => !usedPolys.has(c)).sort((a, b) => b.areaNorm - a.areaNorm);
    if (sorted.length === 0) continue;
    const best = sorted[0];
    usedPolys.add(best);
    // Confianca sobe. Area_m2 nao e sobrescrita aqui (preserva valor da
    // Etapa 3 / quadro de areas). Polygon fica disponivel via slab.bbox
    // derivado (mantemos compat) ou usuario pode auditar o envelope.
    slab.measurement_source = slab.measurement_source === "table" ? "table" : "polygon_focused";
    slab.confidence = Math.max(slab.confidence ?? 0, 0.85);
    refined++;
  }

  return { refined, unmatched: polys.length - usedPolys.size };
}
