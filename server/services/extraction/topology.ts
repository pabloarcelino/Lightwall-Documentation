import type { ExtractedWall } from "../gemini/planAnalyzer";
import type { EnvelopePolygon } from "./envelopeExtractor";

/**
 * Estagio S5 da metodologia: classificacao topologica DETERMINISTICA.
 *
 * O LLM trace o envelope (S2). Aqui usamos geometria pura para decidir
 * se cada parede e externa/interna/muro, baseado em onde fica o midpoint
 * da parede em relacao ao poligono do envelope (e ao lote, se houver).
 *
 * Princıpio: "uma parede esta dentro ou fora do edificio" e uma questao
 * geometrica. Codigo resolve isso com certeza absoluta. LLM, por melhor
 * que seja, tem variancia.
 */

export type WallClass = "externa" | "interna" | "muro";

export interface TopologyClassification {
  wallId: string;
  classe: WallClass;
  reason: string;
  needsReview: boolean;
  /** Verdade ou nao, no ponto da decisao. Para auditoria. */
  evidence: {
    inEnvelopeA: boolean;
    inEnvelopeB: boolean;
    inLotA?: boolean;
    inLotB?: boolean;
  };
}

// ============================================================
// Point-in-polygon (ray casting). Robusto para poligonos simples
// (sem buracos). Roda em O(N) para N vertices — instantaneo aqui.
// ============================================================

type Pt = [number, number];

function pointInPolygon(point: Pt, polygon: Pt[]): boolean {
  if (polygon.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ============================================================
// Heuristics: derivar dois pontos vizinhos da parede, um de cada
// lado do "eixo" do segmento, com offset ortogonal pequeno.
//
// Como nao temos endpoints p1/p2 (so bbox), usamos o midpoint do
// bbox e a orientacao do bbox (lado maior define a direcao do
// segmento). Offset ortogonal = 1/2 da menor dimensao + 2% do
// tamanho da imagem, garantindo que os pontos caiam de fato em
// lados opostos da parede.
// ============================================================

interface NeighborPoints {
  mA: Pt;
  mB: Pt;
}

function neighborPoints(bbox: [number, number, number, number]): NeighborPoints {
  const [ymin, xmin, ymax, xmax] = bbox;
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  const w = xmax - xmin;
  const h = ymax - ymin;

  // Eixo da parede = lado maior.
  // Offset = 1/2 do lado menor + 2% (epsilon contra walls finissimas).
  const isHorizontal = w >= h;
  if (isHorizontal) {
    const off = Math.max(h / 2 + 20, 25); // pelo menos 2.5% (em coords 0-1000)
    return { mA: [cx, cy - off], mB: [cx, cy + off] };
  } else {
    const off = Math.max(w / 2 + 20, 25);
    return { mA: [cx - off, cy], mB: [cx + off, cy] };
  }
}

// ============================================================
// Classificacao
// ============================================================

function findEnvelope(envelopes: EnvelopePolygon[], pavimento: string): EnvelopePolygon | undefined {
  // match exato; fallback case-insensitive
  return (
    envelopes.find((e) => e.pavimento === pavimento) ??
    envelopes.find((e) => e.pavimento.toLowerCase() === (pavimento || "").toLowerCase())
  );
}

function classifyOne(
  wall: ExtractedWall,
  envelope: EnvelopePolygon | undefined,
): TopologyClassification {
  const wallId = wall.id;
  if (!envelope || !wall.bbox) {
    return {
      wallId,
      classe: (wall.classe as WallClass) || "interna",
      reason: !envelope ? "envelope ausente — mantém classe da IA" : "bbox ausente — mantém classe da IA",
      needsReview: false,
      evidence: { inEnvelopeA: false, inEnvelopeB: false },
    };
  }

  const { mA, mB } = neighborPoints(wall.bbox);
  const inA = pointInPolygon(mA, envelope.polygon);
  const inB = pointInPolygon(mB, envelope.polygon);

  const lot = envelope.lotPolygon;
  const inLotA = lot ? pointInPolygon(mA, lot) : undefined;
  const inLotB = lot ? pointInPolygon(mB, lot) : undefined;

  const evidence = { inEnvelopeA: inA, inEnvelopeB: inB, inLotA, inLotB };

  if (inA && inB) {
    return { wallId, classe: "interna", reason: "ambos lados dentro do envelope", needsReview: false, evidence };
  }

  if (!inA && !inB) {
    // Ambos lados fora do envelope.
    // - Se ambos dentro do lote → MURO de divisa (sem cobertura, dentro do terreno).
    // - Senão (lado fora do lote OU sem lote) → segmento na borda ou parede solta; tratamos como externa.
    if (lot && inLotA && inLotB) {
      return {
        wallId,
        classe: "muro",
        reason: "ambos lados fora do envelope, ambos dentro do lote",
        needsReview: false,
        evidence,
      };
    }
    return {
      wallId,
      classe: "externa",
      reason: "ambos lados fora do envelope (segmento na borda ou recuo)",
      needsReview: true,
      evidence,
    };
  }

  // Caso classico: 1 dentro, 1 fora — parede externa da edificacao.
  return {
    wallId,
    classe: "externa",
    reason: inA ? "lado A dentro, lado B fora do envelope" : "lado B dentro, lado A fora do envelope",
    needsReview: false,
    evidence,
  };
}

export interface TopologyResult {
  classifications: TopologyClassification[];
  /** Total de walls cuja classe MUDOU em relacao ao que a IA havia dito. */
  reclassified: number;
  /** Walls sem envelope ou sem bbox — nao foram processadas. */
  skipped: number;
}

export function classifyWallsByTopology(
  walls: ExtractedWall[],
  envelopes: EnvelopePolygon[],
): TopologyResult {
  let reclassified = 0;
  let skipped = 0;
  const classifications: TopologyClassification[] = [];

  for (const wall of walls) {
    const env = findEnvelope(envelopes, wall.nivel || "Terreo");
    if (!env || !wall.bbox) {
      skipped++;
      continue;
    }
    const result = classifyOne(wall, env);
    classifications.push(result);
    if (result.classe !== wall.classe) reclassified++;
  }

  return { classifications, reclassified, skipped };
}
