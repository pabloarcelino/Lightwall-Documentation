/**
 * Geometria de paredes — helpers compartilhados pelo overlay client-side
 * de Quantitativos (PlantaWorkspace). Portados do server
 * `server/services/annotation/renderer.ts` pra que o fallback client-side
 * desenhe paredes no MESMO estilo visual que o renderer do servidor
 * (faixas preenchidas semi-transparentes em vez de linhas finas).
 */

/** Cores oficiais das paredes — espelha `COLORS` em server/services/annotation/renderer.ts:74. */
export const WALL_COLORS: Record<string, string> = {
  externa: "#dc2626", // vermelho
  interna: "#16a34a", // verde
  muro:    "#1d4ed8", // azul
};

export const WALL_FILL_OPACITY = 0.55;
export const WALL_STROKE_OPACITY = 0.85;

/**
 * Espessura default usada quando a parede nao tem `thickness_pct` proprio.
 * Em % do lado maior da imagem (espaco normalizado 0..1000). 1.5% costuma
 * dar ~22px de largura visual em uma imagem de 1500px — visivel sem soterrar
 * a planta.
 */
export const DEFAULT_THICKNESS_PCT = 1.5;

/**
 * Dado endpoints de uma parede em espaco normalizado 0..1000 e espessura
 * em percentual desse espaco, devolve os 4 vertices do retangulo orientado
 * que representa a parede. Cada vertice e [x, y] em 0..1000.
 *
 * Espelha `endpointsToWallPolygon` em renderer.ts:236-255 (server). Mantemos
 * comportamento identico pra que server-render e client-fallback gerem
 * geometria visualmente equivalente.
 */
export function endpointsToWallPolygon(
  p1: [number, number],
  p2: [number, number],
  thicknessPct: number,
): Array<[number, number]> {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // Normal unitaria perpendicular ao eixo da parede.
  const nx = -dy / len;
  const ny = dx / len;
  // Em 0..1000, halfThick = (% / 100) * 1000 / 2.
  const halfThick = (thicknessPct / 100) * 1000 / 2;
  return [
    [x1 + nx * halfThick, y1 + ny * halfThick],
    [x2 + nx * halfThick, y2 + ny * halfThick],
    [x2 - nx * halfThick, y2 - ny * halfThick],
    [x1 - nx * halfThick, y1 - ny * halfThick],
  ];
}

/**
 * Converte um polígono em espaco normalizado 0..1000 pra string `points` de
 * SVG ja escalada pras dimensoes reais da imagem.
 */
export function wallPolygonToSvgPoints(
  poly: Array<[number, number]>,
  widthPx: number,
  heightPx: number,
): string {
  return poly
    .map(([x, y]) => `${((x / 1000) * widthPx).toFixed(1)},${((y / 1000) * heightPx).toFixed(1)}`)
    .join(" ");
}
