import type { TakeoffPoint } from "@shared/schema";

export function euclidean(p1: TakeoffPoint, p2: TakeoffPoint, widthPx: number, heightPx: number): number {
  const dx = (p2.x - p1.x) * widthPx;
  const dy = (p2.y - p1.y) * heightPx;
  return Math.hypot(dx, dy);
}

export function polylineLengthPx(points: TakeoffPoint[], widthPx: number, heightPx: number): number {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += euclidean(points[i - 1], points[i], widthPx, heightPx);
  }
  return total;
}

export function lengthInMeters(points: TakeoffPoint[], widthPx: number, heightPx: number, pxPerMeter: number | null | undefined): number | null {
  if (!pxPerMeter || pxPerMeter <= 0) return null;
  const px = polylineLengthPx(points, widthPx, heightPx);
  return px / pxPerMeter;
}

/**
 * Polygon area via the Shoelace formula. Returns area in pixels-squared.
 */
export function shoelaceAreaPx(points: TakeoffPoint[], widthPx: number, heightPx: number): number {
  if (!points || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += (a.x * widthPx) * (b.y * heightPx) - (b.x * widthPx) * (a.y * heightPx);
  }
  return Math.abs(sum) / 2;
}

export function areaInSquareMeters(points: TakeoffPoint[], widthPx: number, heightPx: number, pxPerMeter: number | null | undefined): number | null {
  if (!pxPerMeter || pxPerMeter <= 0) return null;
  const areaPx = shoelaceAreaPx(points, widthPx, heightPx);
  return areaPx / (pxPerMeter * pxPerMeter);
}

/**
 * Compute pxPerMeter from two normalized calibration points and a known real-world distance in meters.
 */
export function computePxPerMeter(
  p1: TakeoffPoint,
  p2: TakeoffPoint,
  realMeters: number,
  widthPx: number,
  heightPx: number,
): number {
  if (realMeters <= 0) throw new Error("Distancia real deve ser > 0");
  const px = euclidean(p1, p2, widthPx, heightPx);
  if (px <= 0) throw new Error("Os dois pontos selecionados sao iguais");
  return px / realMeters;
}

export interface GeometryResult {
  lengthM: number | null;
  areaOneFaceM2: number | null;
  areaTwoFacesM2: number | null;
}

/**
 * Returns the recalculated length and (when applicable) wall areas based on geometry + scale + height.
 */
export function recomputeSegmentGeometry(
  points: TakeoffPoint[],
  widthPx: number,
  heightPx: number,
  pxPerMeter: number | null | undefined,
  heightM: number | null | undefined,
  category: "parede_externa" | "parede_interna" | "muro",
): GeometryResult {
  const lengthM = lengthInMeters(points, widthPx, heightPx, pxPerMeter);
  if (lengthM == null || heightM == null || heightM <= 0) {
    return { lengthM, areaOneFaceM2: null, areaTwoFacesM2: null };
  }
  const oneFace = lengthM * heightM;
  const twoFaces = category === "parede_interna" ? oneFace * 2 : null;
  return { lengthM, areaOneFaceM2: oneFace, areaTwoFacesM2: twoFaces };
}
