/**
 * Helpers geometricos compartilhados pelas etapas de extracao.
 *
 * Coordenadas vivem em unidades normalizadas (0..1000 x 0..1000) durante o
 * pipeline. A escala para metros depende de pixelsPerMeter resolvido em S1
 * e e aplicada pelos consumidores quando relevante.
 */

export type Point = [number, number];
export type Polygon = Point[];

/** Area de um poligono via shoelace, em unidades normalizadas. */
export function polygonAreaNorm(poly: Polygon): number {
  if (poly.length < 3) return 0;
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  }
  return Math.abs(s) / 2;
}

/** Perimetro de um poligono fechado, em unidades normalizadas. */
export function polygonPerimeterNorm(poly: Polygon): number {
  if (poly.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}
