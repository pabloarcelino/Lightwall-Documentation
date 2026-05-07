import fs from "fs/promises";
import type { ExtractedWall, GeometryResult } from "../gemini/planAnalyzer";

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  angle: number;
}

interface ScaleInfo {
  unitsPerMeter: number;
  source: "cota" | "default";
  detail: string;
}

// Faixas tipicas de paredes residenciais Lightwall. Valores anteriores eram
// mais permissivos (0.30m / 0.06–0.40m) e capturavam moveis (balcao, cama,
// pia, mesa) e elementos sanitarios como "paredes". Apertando aqui reduzimos
// drasticamente falsos positivos sem perder paredes reais (Lightwall padrao
// e 0.09m de espessura, paredes de alvenaria ~0.15–0.25m).
const MIN_WALL_LENGTH_M = 0.50;
const MAX_WALL_LENGTH_M = 30.0;
const MIN_THICKNESS_M = 0.08;
const MAX_THICKNESS_M = 0.30;
const PARALLEL_TOLERANCE_DEG = 3;
const COLLINEAR_DIST_TOLERANCE = 0.005;
// Regex robusta de cotas: tolera sinal opcional (+/-), apostrofo decimal,
// separadores , ou ., unidade opcional, e cotas como "464" (cm) ou "4,64".
// Aceita "1.20", "1,20", "1.20m", "120cm", "+1.20", "1.20 ".
const COTA_REGEX = /^[+\-]?(\d{1,4}(?:[.,]\d{1,3})?)\s*(m|cm|mm)?$/i;
// Cotas adicionais com formato "L=1.20" ou "1,20m" embutidas em texto livre.
const COTA_INLINE_REGEX = /(?:^|[\s=:])([+\-]?\d{1,4}(?:[.,]\d{1,3})?)\s*(m|cm|mm)?(?:\s|$)/i;

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

function normalizeAngle(deg: number): number {
  let a = deg % 180;
  if (a < 0) a += 180;
  return a;
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(px, py, x1, y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return dist(px, py, x1 + t * dx, y1 + t * dy);
}

function transformPoint(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function multiplyMatrix(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

interface RawTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function extractPageData(page: any): Promise<{ segments: Segment[]; texts: RawTextItem[]; viewport: any }> {
  const ops = await page.getOperatorList();
  const OPS = (await import("pdfjs-dist/legacy/build/pdf.mjs") as any).OPS;
  const segments: Segment[] = [];

  const matStack: number[][] = [[1, 0, 0, 1, 0, 0]];
  let cur: number[] = matStack[0];
  let pathStartX = 0, pathStartY = 0;
  let curX = 0, curY = 0;
  let pendingPath: Array<[number, number, number, number]> = [];

  const fnArr = ops?.fnArray ?? [];
  const argsArr = ops?.argsArray ?? [];

  for (let i = 0; i < fnArr.length; i++) {
    const fn = fnArr[i];
    const args = argsArr[i];
    if (fn === OPS.save) matStack.push(cur.slice());
    else if (fn === OPS.restore) { matStack.pop(); cur = matStack[matStack.length - 1] || [1, 0, 0, 1, 0, 0]; }
    else if (fn === OPS.transform) cur = multiplyMatrix(cur, args);
    else if (fn === OPS.constructPath) {
      // pdfjs-dist v5+: constructPath(op, data, minMax) where:
      //   args[0] = painting op (OPS.stroke=20, OPS.fill=22, OPS.fillStroke=24, OPS.endPath=28, OPS.clip=29, etc.)
      //   args[1] = [Float32Array] inline DrawOPS-encoded sub-ops:
      //     moveTo(0,x,y) | lineTo(1,x,y) | curveTo(2,...6 floats) | quadraticCurveTo(3,...4 floats) | closePath(4)
      //   args[2] = bbox [xMin, yMin, xMax, yMax] (optional)
      if (!args || !Array.isArray(args)) continue;
      const paintingOp = args[0];
      // Explicit whitelist of visible paint ops (stroke/fill/fillStroke variants).
      // Excludes endPath/clip/eoClip and any future opcode pdfjs may add for non-visible paths.
      const isVisiblePaint =
        paintingOp === OPS.stroke || paintingOp === OPS.closeStroke ||
        paintingOp === OPS.fill || paintingOp === OPS.eoFill ||
        paintingOp === OPS.fillStroke || paintingOp === OPS.eoFillStroke ||
        paintingOp === OPS.closeFillStroke || paintingOp === OPS.closeEOFillStroke;
      if (!isVisiblePaint) continue;

      const rawData = args[1];
      let dataArr: ArrayLike<number> | null = null;
      if (rawData instanceof Float32Array || rawData instanceof Float64Array) {
        dataArr = rawData;
      } else if (Array.isArray(rawData)) {
        const inner = rawData[0];
        if (inner instanceof Float32Array || inner instanceof Float64Array) dataArr = inner;
        else if (rawData.every((v) => typeof v === "number")) dataArr = rawData as number[];
      }
      if (!dataArr) continue;

      const localPath: Array<[number, number, number, number]> = [];
      let lx = curX, ly = curY, lpsx = pathStartX, lpsy = pathStartY;
      let ai = 0;
      const dlen = dataArr.length;
      let aborted = false;
      while (ai < dlen) {
        const op = dataArr[ai++];
        if (op === 0) { // moveTo
          if (ai + 1 >= dlen) { aborted = true; break; }
          const [x, y] = transformPoint(cur, dataArr[ai], dataArr[ai + 1]);
          lx = x; ly = y; lpsx = x; lpsy = y; ai += 2;
        } else if (op === 1) { // lineTo
          if (ai + 1 >= dlen) { aborted = true; break; }
          const [x, y] = transformPoint(cur, dataArr[ai], dataArr[ai + 1]);
          localPath.push([lx, ly, x, y]);
          lx = x; ly = y; ai += 2;
        } else if (op === 2) { // curveTo (6 floats) — chord approximation
          if (ai + 5 >= dlen) { aborted = true; break; }
          const [x, y] = transformPoint(cur, dataArr[ai + 4], dataArr[ai + 5]);
          localPath.push([lx, ly, x, y]);
          lx = x; ly = y; ai += 6;
        } else if (op === 3) { // quadraticCurveTo (4 floats) — chord approximation
          if (ai + 3 >= dlen) { aborted = true; break; }
          const [x, y] = transformPoint(cur, dataArr[ai + 2], dataArr[ai + 3]);
          localPath.push([lx, ly, x, y]);
          lx = x; ly = y; ai += 4;
        } else if (op === 4) { // closePath
          if (lx !== lpsx || ly !== lpsy) localPath.push([lx, ly, lpsx, lpsy]);
          lx = lpsx; ly = lpsy;
        } else {
          aborted = true; break;
        }
      }
      if (aborted) continue;
      // Persist if op represents visible geometry (stroke or fill ops both produce visible lines/edges)
      for (const [a1, b1, a2, b2] of localPath) {
        const len = dist(a1, b1, a2, b2);
        if (len < 0.5) continue;
        segments.push({
          x1: a1, y1: b1, x2: a2, y2: b2, length: len,
          angle: normalizeAngle(Math.atan2(b2 - b1, a2 - a1) * 180 / Math.PI),
        });
      }
      curX = lx; curY = ly; pathStartX = lpsx; pathStartY = lpsy;
    } else if (fn === OPS.rectangle) {
      // Rectangle as standalone op: args=[x, y, w, h]
      if (Array.isArray(args) && args.length >= 4) {
        const [x, y] = transformPoint(cur, args[0], args[1]);
        const [x2, y2] = transformPoint(cur, args[0] + args[2], args[1] + args[3]);
        const rect: Array<[number, number, number, number]> = [
          [x, y, x2, y], [x2, y, x2, y2], [x2, y2, x, y2], [x, y2, x, y],
        ];
        for (const [a1, b1, a2, b2] of rect) {
          const len = dist(a1, b1, a2, b2);
          if (len < 0.5) continue;
          segments.push({
            x1: a1, y1: b1, x2: a2, y2: b2, length: len,
            angle: normalizeAngle(Math.atan2(b2 - b1, a2 - a1) * 180 / Math.PI),
          });
        }
      }
    } else if (
      fn === OPS.stroke || fn === OPS.closeStroke ||
      fn === OPS.fillStroke || fn === OPS.eoFillStroke ||
      fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke ||
      fn === OPS.fill || fn === OPS.eoFill
    ) {
      // pdfjs v5 fuses stroke/fill into constructPath; this branch is a fallback for older shapes
      for (const [a1, b1, a2, b2] of pendingPath) {
        const len = dist(a1, b1, a2, b2);
        if (len < 0.5) continue;
        segments.push({
          x1: a1, y1: b1, x2: a2, y2: b2, length: len,
          angle: normalizeAngle(Math.atan2(b2 - b1, a2 - a1) * 180 / Math.PI),
        });
      }
      pendingPath = [];
    } else if (fn === OPS.endPath) {
      pendingPath = [];
    }
  }

  const txt = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const texts: RawTextItem[] = (txt?.items ?? []).map((it: any) => {
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    return { str: String(it.str ?? ""), x: tr[4], y: tr[5], width: it.width || 0, height: it.height || 0 };
  });

  return { segments, texts, viewport };
}

/**
 * Parse a single textual token into a candidate cota (real-world meters).
 * Handles: "5.20", "5,20", "5.20m", "120cm", "+1.20", and bare integers like
 * "464" (treated as cm when ≥ 30 to cover plotted dimensions).
 */
function parseCotaToken(raw: string): number | null {
  const m = raw.trim().match(COTA_REGEX);
  if (!m) return null;
  let v = parseFloat(m[1].replace(",", "."));
  const unit = (m[2] || "").toLowerCase();
  if (!isFinite(v) || v <= 0) return null;
  if (unit === "cm") v /= 100;
  else if (unit === "mm") v /= 1000;
  else if (!unit) {
    // Sem unidade — heuristica de duas faixas:
    //  (a) decimal presente OU inteiro pequeno 3..15  → metros (cotas tipicas)
    //  (b) inteiro 30..1500 sem decimal              → cm (cotas plotadas em
    //      mm/cm em plantas: ex "350" = 3,50m, "464" = 4,64m). Limite superior
    //      1500 cm = 15 m exclui codigos como "2024" (ano) e numeros grandes.
    //      Faixa <30 e excluida porque facilmente vira ruido (numeracao,
    //      texto de cota de nivel "+0.15" ja vira 0.15 com decimal acima).
    const hasDecimal = /[.,]/.test(m[1]);
    if (!hasDecimal) {
      if (!Number.isInteger(v)) return null;
      if (v >= 3 && v <= 15) {
        // metros — manter como esta
      } else if (v >= 30 && v <= 1500) {
        v /= 100; // cm -> m
      } else {
        return null;
      }
    }
  }
  if (v < 0.20 || v > 50) return null;
  return v;
}

function parseInlineCota(raw: string): number | null {
  // Reconstroi o token "valor + unidade" a partir dos grupos capturados.
  const m = raw.match(COTA_INLINE_REGEX);
  if (!m) return null;
  return parseCotaToken(`${m[1]}${m[2] || ""}`);
}

function collectCotaCandidates(texts: RawTextItem[]): Array<{ value: number; cx: number; cy: number }> {
  const out: Array<{ value: number; cx: number; cy: number }> = [];
  for (const t of texts) {
    const cx = t.x + t.width / 2;
    const cy = t.y;
    // Try the whole string first (most cotas are isolated tokens).
    const direct = parseCotaToken(t.str);
    if (direct !== null) {
      out.push({ value: direct, cx, cy });
      continue;
    }
    // Fallback: scan for inline numbers (handles "L=1.20", "1.20m total", etc.)
    const parsed = parseInlineCota(t.str);
    if (parsed !== null) out.push({ value: parsed, cx, cy });
  }
  return out;
}

/**
 * 1D clustering of ratios. Groups values within ±tol of a center and returns
 * the densest cluster's median + size. Much more robust than a single median
 * when there are 2+ scale modes (e.g. cotas em cm misturadas com cotas em m).
 */
function clusterRatios(ratios: number[], tol: number): { center: number; size: number } | null {
  if (ratios.length === 0) return null;
  const sorted = [...ratios].sort((a, b) => a - b);
  let bestSize = 0;
  let bestCenter = sorted[0];
  for (let i = 0; i < sorted.length; i++) {
    const lo = sorted[i] * (1 - tol);
    const hi = sorted[i] * (1 + tol);
    let j = i;
    while (j < sorted.length && sorted[j] <= hi) j++;
    const cluster = sorted.slice(i, j).filter((r) => r >= lo);
    if (cluster.length > bestSize) {
      bestSize = cluster.length;
      bestCenter = cluster[Math.floor(cluster.length / 2)];
    }
  }
  return { center: bestCenter, size: bestSize };
}

function detectScale(texts: RawTextItem[], segments: Segment[]): ScaleInfo {
  // Default: PDF user units = points (1 inch = 72 pt). Architectural drawings in mm at 1:50 scale usually have ~14.17 pt = 1m. 
  // Heuristic: find textual cota (e.g. "5.20") near a segment; ratio = real_meters / segment_length_pt.
  const cotaCandidates = collectCotaCandidates(texts);

  // Distance threshold scales with page size (cotas ficam mais longe em folhas A1/A0).
  let pageDiag = 0;
  for (const s of segments) {
    pageDiag = Math.max(pageDiag, dist(s.x1, s.y1, s.x2, s.y2));
  }
  const proximityThreshold = Math.max(30, pageDiag * 0.04);

  const ratios: number[] = [];
  for (const c of cotaCandidates) {
    let best: { d: number; len: number } | null = null;
    for (const s of segments) {
      const d = pointToSegmentDistance(c.cx, c.cy, s.x1, s.y1, s.x2, s.y2);
      if (!best || d < best.d) best = { d, len: s.length };
    }
    if (best && best.d < proximityThreshold && best.len > 5) {
      ratios.push(best.len / c.value);
    }
  }

  if (ratios.length >= 3) {
    // Cluster with ±15% tolerance — tighter than the +/-25% median band, so
    // outliers (cota associated to wrong segment) cannot drag the center.
    const cluster = clusterRatios(ratios, 0.15);
    if (cluster && cluster.size >= 3 && cluster.size / ratios.length >= 0.4) {
      return {
        unitsPerMeter: cluster.center,
        source: "cota",
        detail: `${cluster.size}/${ratios.length} cotas no cluster dominante (centro ${cluster.center.toFixed(2)} pt/m)`,
      };
    }
    // Fallback: keep the previous +/-25% median band as a less strict path.
    ratios.sort((a, b) => a - b);
    const mid = ratios[Math.floor(ratios.length / 2)];
    const inBand = ratios.filter((r) => r >= mid * 0.75 && r <= mid * 1.25);
    if (inBand.length / ratios.length >= 0.55) {
      const robustMid = inBand[Math.floor(inBand.length / 2)];
      return {
        unitsPerMeter: robustMid,
        source: "cota",
        detail: `${inBand.length}/${ratios.length} cotas concordam (mediana ${robustMid.toFixed(2)} pt/m)`,
      };
    }
    return {
      unitsPerMeter: 14.17,
      source: "default",
      detail: `cotas dispersas (cluster=${cluster?.size ?? 0}/${ratios.length}), fallback 1:50 (14.17 pt/m)`,
    };
  }

  return { unitsPerMeter: 14.17, source: "default", detail: `fallback 1:50 (14.17 pt/m, ${ratios.length} cotas)` };
}

/** Project both endpoints of segment B onto segment A's direction, return [tMin, tMax] in [0,lenA] units. */
function projectedOverlap(a: Segment, b: Segment): { overlap: number; perpDist: number } {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { overlap: 0, perpDist: Infinity };
  const lenA = Math.sqrt(len2);
  const ux = dx / lenA, uy = dy / lenA;
  const nx = -uy, ny = ux; // unit normal to A
  const t1 = ((b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy);
  const t2 = ((b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy);
  const tMin = Math.max(0, Math.min(t1, t2));
  const tMax = Math.min(lenA, Math.max(t1, t2));
  const overlap = Math.max(0, tMax - tMin);
  const perp1 = Math.abs((b.x1 - a.x1) * nx + (b.y1 - a.y1) * ny);
  const perp2 = Math.abs((b.x2 - a.x1) * nx + (b.y2 - a.y1) * ny);
  const perpDist = (perp1 + perp2) / 2;
  return { overlap, perpDist };
}

function findParallelPairs(segments: Segment[], scale: ScaleInfo): Array<{ a: Segment; b: Segment; thicknessM: number; lengthM: number }> {
  const pairs: Array<{ a: Segment; b: Segment; thicknessM: number; lengthM: number }> = [];
  const minLenUnits = MIN_WALL_LENGTH_M * scale.unitsPerMeter;
  const maxLenUnits = MAX_WALL_LENGTH_M * scale.unitsPerMeter;
  const minThickUnits = MIN_THICKNESS_M * scale.unitsPerMeter;
  const maxThickUnits = MAX_THICKNESS_M * scale.unitsPerMeter;
  // Require pairs to share at least 60% of the shorter side as actual projected overlap (excludes T-junction noise)
  const MIN_OVERLAP_RATIO = 0.6;

  const candidates = segments.filter(s => s.length >= minLenUnits && s.length <= maxLenUnits);
  const used = new Set<number>();

  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;
    const a = candidates[i];
    let bestJ = -1;
    let bestThick = Infinity;
    let bestOverlapLen = 0;
    for (let j = i + 1; j < candidates.length; j++) {
      if (used.has(j)) continue;
      const b = candidates[j];
      if (angleDiff(a.angle, b.angle) > PARALLEL_TOLERANCE_DEG) continue;
      const { overlap, perpDist } = projectedOverlap(a, b);
      if (perpDist < minThickUnits || perpDist > maxThickUnits) continue;
      // Require true projected overlap (collinear within tolerance + sufficient shared span)
      const minSide = Math.min(a.length, b.length);
      if (overlap < minSide * MIN_OVERLAP_RATIO) continue;
      if (overlap < minLenUnits) continue;
      if (overlap > bestOverlapLen || (overlap === bestOverlapLen && perpDist < bestThick)) {
        bestJ = j;
        bestThick = perpDist;
        bestOverlapLen = overlap;
      }
    }
    if (bestJ >= 0) {
      const b = candidates[bestJ];
      used.add(i); used.add(bestJ);
      pairs.push({
        a, b,
        thicknessM: bestThick / scale.unitsPerMeter,
        lengthM: bestOverlapLen / scale.unitsPerMeter,
      });
    }
  }
  return pairs;
}

/**
 * Deduplicate wall pairs sharing the same centerline.
 *
 * findParallelPairs is fooled by:
 *  - Wall hatching/fill patterns drawn as parallel lines inside a single wall
 *    (e.g. concrete/brick representation): a wall with 2 outer edges + N hatch
 *    lines yields multiple "parallel pairs" all representing the same physical wall.
 *  - PDF wall fills broken into many short parallel sub-segments.
 *
 * Two pairs are duplicates when their centerlines (midline between a and b)
 * are nearly collinear (perp distance ≤ ~half a wall thickness) AND their spans
 * overlap by ≥50% of the shorter pair. Longer pairs are kept (they better
 * represent the real wall length).
 */
function deduplicateWallPairs(
  pairs: Array<{ a: Segment; b: Segment; thicknessM: number; lengthM: number }>,
  scale: ScaleInfo,
): Array<{ a: Segment; b: Segment; thicknessM: number; lengthM: number }> {
  if (pairs.length <= 1) return pairs;
  const ANGLE_TOL = 5; // degrees
  const COLLINEAR_PERP = (MIN_THICKNESS_M * 0.6) * scale.unitsPerMeter;
  const OVERLAP_RATIO = 0.5;

  const lines = pairs.map(p => {
    const cx1 = (p.a.x1 + p.b.x1) / 2;
    const cy1 = (p.a.y1 + p.b.y1) / 2;
    const cx2 = (p.a.x2 + p.b.x2) / 2;
    const cy2 = (p.a.y2 + p.b.y2) / 2;
    const len = Math.hypot(cx2 - cx1, cy2 - cy1);
    const ang = normalizeAngle((Math.atan2(cy2 - cy1, cx2 - cx1) * 180) / Math.PI);
    return { x1: cx1, y1: cy1, x2: cx2, y2: cy2, length: len, angle: ang };
  });

  // Order: longest pairs first so they win as canonical.
  const indices = pairs.map((_, i) => i).sort((i, j) => pairs[j].lengthM - pairs[i].lengthM);
  const removed = new Set<number>();

  for (const i of indices) {
    if (removed.has(i)) continue;
    const li = lines[i];
    const dx = li.x2 - li.x1, dy = li.y2 - li.y1;
    const lenI = Math.hypot(dx, dy);
    if (lenI === 0) continue;
    const ux = dx / lenI, uy = dy / lenI;
    // Constant for line equation Ax + By + C = 0 with A=dy, B=-dx, C=x2*y1 - y2*x1
    const lineConst = li.x2 * li.y1 - li.y2 * li.x1;
    for (const j of indices) {
      if (j === i || removed.has(j)) continue;
      const lj = lines[j];
      if (lj.length < 1e-3) { removed.add(j); continue; }
      if (angleDiff(li.angle, lj.angle) > ANGLE_TOL) continue;
      const d1 = Math.abs((dy * lj.x1 - dx * lj.y1 + lineConst) / lenI);
      const d2 = Math.abs((dy * lj.x2 - dx * lj.y2 + lineConst) / lenI);
      if (d1 > COLLINEAR_PERP || d2 > COLLINEAR_PERP) continue;
      const t1 = (lj.x1 - li.x1) * ux + (lj.y1 - li.y1) * uy;
      const t2 = (lj.x2 - li.x1) * ux + (lj.y2 - li.y1) * uy;
      const tMin = Math.max(0, Math.min(t1, t2));
      const tMax = Math.min(lenI, Math.max(t1, t2));
      const overlap = Math.max(0, tMax - tMin);
      const minSide = Math.min(li.length, lj.length);
      if (minSide <= 0) continue;
      if (overlap / minSide < OVERLAP_RATIO) continue;
      removed.add(j);
    }
  }

  return pairs.filter((_, i) => !removed.has(i));
}

function buildBoundingBox(segments: Segment[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxX = Math.max(maxX, s.x1, s.x2);
    maxY = Math.max(maxY, s.y1, s.y2);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Segment-segment intersection test (proper crossing, no endpoint touching).
 * Returns true if [p1,p2] crosses [p3,p4].
 */
function segmentsIntersect(
  p1x: number, p1y: number, p2x: number, p2y: number,
  p3x: number, p3y: number, p4x: number, p4y: number
): boolean {
  const d1x = p2x - p1x, d1y = p2y - p1y;
  const d2x = p4x - p3x, d2y = p4y - p3y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return false; // parallel/colinear
  const t = ((p3x - p1x) * d2y - (p3y - p1y) * d2x) / denom;
  const u = ((p3x - p1x) * d1y - (p3y - p1y) * d1x) / denom;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}

/**
 * Topological wall classification by perpendicular ray-casting.
 *
 * For each wall, cast TWO rays perpendicular to its axis (opposite directions)
 * from a point slightly offset from the wall midpoint. Count how many OTHER
 * walls each ray crosses before reaching the bounding-box boundary.
 *
 * - If at least one ray reaches outside without crossing any wall → EXTERNA
 *   (that side faces the exterior — garden, street, garage, etc.)
 * - If both rays cross at least one wall → INTERNA
 *   (rooms on both sides; the wall is enclosed by other walls)
 *
 * This is much more robust than bounding-box proximity because:
 *  - Works for L-shaped buildings, garages, varandas, irregular footprints
 *  - Internal walls near the bbox edge (e.g., narrow corridor along facade)
 *    are correctly classified as INTERNA
 *  - External walls in concave corners (e.g., back of an L) are correctly
 *    classified as EXTERNA
 */
function classifyWalls(
  pairs: Array<{ a: Segment; b: Segment; thicknessM: number; lengthM: number }>,
  segments: Segment[],
  scale: ScaleInfo
): Array<"externa" | "interna"> {
  if (pairs.length === 0) return [];
  const bbox = buildBoundingBox(segments);
  const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  if (diag === 0) return pairs.map(() => "interna");

  // Pre-compute centerline endpoints per pair (avg of pair's two parallel segments).
  // Using centerline (vs raw a/b) makes the ray-cast cleaner: ignores wall thickness.
  const centerlines = pairs.map(p => {
    // Try to align b's endpoints with a's by projecting b onto a's direction
    const ax = p.a.x2 - p.a.x1, ay = p.a.y2 - p.a.y1;
    const lenA = Math.hypot(ax, ay) || 1;
    const ux = ax / lenA, uy = ay / lenA;
    // Project both b endpoints onto a's line; sort to align with a's direction
    const t1 = (p.b.x1 - p.a.x1) * ux + (p.b.y1 - p.a.y1) * uy;
    const t2 = (p.b.x2 - p.a.x1) * ux + (p.b.y2 - p.a.y1) * uy;
    const bStart = t1 <= t2 ? { x: p.b.x1, y: p.b.y1 } : { x: p.b.x2, y: p.b.y2 };
    const bEnd = t1 <= t2 ? { x: p.b.x2, y: p.b.y2 } : { x: p.b.x1, y: p.b.y1 };
    return {
      x1: (p.a.x1 + bStart.x) / 2,
      y1: (p.a.y1 + bStart.y) / 2,
      x2: (p.a.x2 + bEnd.x) / 2,
      y2: (p.a.y2 + bEnd.y) / 2,
    };
  });

  const out: Array<"externa" | "interna"> = [];
  for (let i = 0; i < pairs.length; i++) {
    const cl = centerlines[i];
    const cx = (cl.x1 + cl.x2) / 2;
    const cy = (cl.y1 + cl.y2) / 2;
    const dx = cl.x2 - cl.x1, dy = cl.y2 - cl.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // unit normal

    // Offset start of each ray just past the wall's own face to avoid hitting itself.
    // thicknessM is in meters; convert to PDF units via scale. Add a 1cm epsilon.
    const thicknessUnits = pairs[i].thicknessM * scale.unitsPerMeter;
    const epsilonUnits = 0.01 * scale.unitsPerMeter; // 1cm
    const offset = (thicknessUnits / 2) + epsilonUnits;
    const reach = diag * 1.5;
    const startPosX = cx + nx * offset, startPosY = cy + ny * offset;
    const endPosX = cx + nx * reach, endPosY = cy + ny * reach;
    const startNegX = cx - nx * offset, startNegY = cy - ny * offset;
    const endNegX = cx - nx * reach, endNegY = cy - ny * reach;

    let crossingsPos = 0, crossingsNeg = 0;
    for (let j = 0; j < centerlines.length; j++) {
      if (j === i) continue;
      const oc = centerlines[j];
      if (segmentsIntersect(startPosX, startPosY, endPosX, endPosY, oc.x1, oc.y1, oc.x2, oc.y2)) crossingsPos++;
      if (segmentsIntersect(startNegX, startNegY, endNegX, endNegY, oc.x1, oc.y1, oc.x2, oc.y2)) crossingsNeg++;
      // Early exit: if both sides already have crossings, classification is fixed
      if (crossingsPos > 0 && crossingsNeg > 0) break;
    }

    const isExternal = crossingsPos === 0 || crossingsNeg === 0;
    out.push(isExternal ? "externa" : "interna");
  }
  return out;
}

export interface VectorExtractionResult {
  geometry: GeometryResult;
  scale: ScaleInfo;
  pagesProcessed: number;
  segmentCount: number;
  candidateWallCount: number;
  notes: string[];
}

/**
 * Extract wall candidates from native PDF vector content.
 * - Only processes pages explicitly listed in `pavimentoByPage` (planta pages).
 * - Slab extraction is intentionally NOT performed here: free-text "X m²" labels often
 *   refer to room areas and would inflate the budget. Slabs come from AI/IFC paths only.
 */
export async function extractFromVectorPdf(filePath: string, pavimentoByPage: Map<number, string>, peDireitoM: number): Promise<VectorExtractionResult> {
  const notes: string[] = [];
  const geo: GeometryResult = { walls: [], slabs: [], corners: [] };

  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await fs.readFile(filePath));
  const loadingTask = pdfjsLib.getDocument({ data, disableWorker: true, isEvalSupported: false });
  const doc = await loadingTask.promise;

  let totalSegments = 0;
  let totalCandidateWalls = 0;
  let pagesProcessed = 0;
  let aggregatedScale: ScaleInfo = { unitsPerMeter: 14.17, source: "default", detail: "no pages processed" };

  // Process only the pages explicitly classified as planta_baixa
  const targetPageIndices = Array.from(pavimentoByPage.keys()).sort((a, b) => a - b);
  if (targetPageIndices.length === 0) {
    notes.push("Nenhuma página de planta_baixa fornecida — nada a extrair");
    await doc.destroy?.();
    return { geometry: geo, scale: aggregatedScale, pagesProcessed: 0, segmentCount: 0, candidateWallCount: 0, notes };
  }

  for (const zeroBasedIdx of targetPageIndices) {
    const pageNum = zeroBasedIdx + 1;
    if (pageNum < 1 || pageNum > doc.numPages) continue;
    const pavimento = pavimentoByPage.get(zeroBasedIdx) || "Terreo";
    try {
      const page = await doc.getPage(pageNum);
      const { segments, texts } = await extractPageData(page);
      totalSegments += segments.length;
      pagesProcessed++;
      if (segments.length < 30) {
        notes.push(`Pag ${pageNum}: poucos segmentos (${segments.length}), pulando`);
        continue;
      }
      const scale = detectScale(texts, segments);
      if (scale.source === "cota" || aggregatedScale.source === "default") aggregatedScale = scale;

      // GATE POR PAGINA: sem cotas confiaveis, os comprimentos sao palpite e
      // pares paralelos viram principalmente moveis/hatches/cotas. Pulamos
      // a pagina inteira em vez de poluir o orcamento com paredes fantasmas.
      if (scale.source !== "cota") {
        notes.push(`Pag ${pageNum}: escala nao confiavel (${scale.detail}) — pulando extracao vetorial`);
        console.log(`[PDF-VECTOR] Pag ${pageNum} pav ${pavimento}: ${segments.length} segs — pulado (escala: ${scale.detail})`);
        continue;
      }

      const rawPairs = findParallelPairs(segments, scale);
      const pairs = deduplicateWallPairs(rawPairs, scale);
      const dropped = rawPairs.length - pairs.length;
      if (dropped > 0) {
        console.log(`[PDF-VECTOR] Pag ${pageNum}: dedup centerline removeu ${dropped} pares duplicados (${rawPairs.length} → ${pairs.length})`);
      }
      const classes = classifyWalls(pairs, segments, scale);
      let pIdx = 0;
      for (const p of pairs) {
        if (!isFinite(p.lengthM) || !isFinite(p.thicknessM) || p.lengthM <= 0 || p.thicknessM <= 0) continue;
        const classe = classes[pIdx++] || "interna";
        const wall: ExtractedWall = {
          id: `pdfvec-${pageNum}-${pIdx}`,
          nivel: pavimento,
          classe,
          comprimento_m: p.lengthM,
          altura_m: peDireitoM,
          espessura_m: p.thicknessM,
          measurement_source: "pdf_vector",
          confidence: scale.source === "cota" ? 0.85 : 0.65,
          has_door: false,
          has_window: false,
          opening_area_m2: 0,
          esquadrias: [],
          page_index: zeroBasedIdx,
        };
        geo.walls.push(wall);
        totalCandidateWalls++;
      }

      console.log(`[PDF-VECTOR] Pag ${pageNum} pav ${pavimento}: ${segments.length} segs → ${pairs.length} paredes (escala: ${scale.detail})`);
    } catch (err: any) {
      notes.push(`Pag ${pageNum} falhou: ${err?.message || err}`);
    }
  }

  await doc.destroy?.();

  return {
    geometry: geo,
    scale: aggregatedScale,
    pagesProcessed,
    segmentCount: totalSegments,
    candidateWallCount: totalCandidateWalls,
    notes,
  };
}
