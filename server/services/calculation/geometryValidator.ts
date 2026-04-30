import type { ExtractedWall, ExtractedSlab, ExtractedCorner } from "../gemini/planAnalyzer";

export interface ValidationStats {
  wallsBefore: number;
  wallsAfter: number;
  slabsBefore: number;
  slabsAfter: number;
  removedThinWalls: number;
  removedThickWalls: number;
  removedTinyWalls: number;
  removedHugeWalls: number;
  removedTinySlabs: number;
  removedHugeSlabs: number;
  snappedWallHeights: number;
  notes: string[];
}

export interface ValidatorOptions {
  minThicknessM?: number;
  maxThicknessM?: number;
  minWallLengthM?: number;
  maxWallLengthM?: number;
  minSlabAreaM2?: number;
  maxSlabAreaM2?: number;
  minWallHeightM?: number;
  maxWallHeightM?: number;
  defaultPeDireitoM?: number;
}

const DEFAULTS: Required<ValidatorOptions> = {
  minThicknessM: 0.06,
  maxThicknessM: 0.40,
  minWallLengthM: 0.30,
  maxWallLengthM: 50.0,
  minSlabAreaM2: 1.0,
  maxSlabAreaM2: 5000.0,
  minWallHeightM: 1.5,
  maxWallHeightM: 6.0,
  defaultPeDireitoM: 3.0,
};

export interface ValidatedGeometry {
  walls: ExtractedWall[];
  slabs: ExtractedSlab[];
  corners: ExtractedCorner[];
  stats: ValidationStats;
}

/**
 * Apply geometric plausibility validators recommended by the takeoff best-practices doc:
 * - Filter walls outside thickness range (drops noise + decorative lines)
 * - Filter walls outside reasonable length range (drops stray segments + over-large)
 * - Filter slabs outside reasonable area range (drops tiny rooms misclassified or impossible totals)
 * - Snap wall heights to a sane range, falling back to peDireito for missing/wrong values
 */
export function validateGeometry(
  walls: ExtractedWall[],
  slabs: ExtractedSlab[],
  corners: ExtractedCorner[],
  opts: ValidatorOptions = {},
): ValidatedGeometry {
  const cfg = { ...DEFAULTS, ...opts };
  const stats: ValidationStats = {
    wallsBefore: walls.length,
    wallsAfter: 0,
    slabsBefore: slabs.length,
    slabsAfter: 0,
    removedThinWalls: 0,
    removedThickWalls: 0,
    removedTinyWalls: 0,
    removedHugeWalls: 0,
    removedTinySlabs: 0,
    removedHugeSlabs: 0,
    snappedWallHeights: 0,
    notes: [],
  };

  let removedNonFiniteWalls = 0;
  let removedNonFiniteSlabs = 0;

  const validWalls: ExtractedWall[] = [];
  for (const w of walls) {
    const thickRaw = w.espessura_m;
    const lenRaw = w.comprimento_m;
    if (!Number.isFinite(lenRaw) || (lenRaw as number) <= 0) { removedNonFiniteWalls++; continue; }
    const thick = Number.isFinite(thickRaw) && (thickRaw as number) > 0 ? (thickRaw as number) : 0.10;
    if (thick < cfg.minThicknessM) { stats.removedThinWalls++; continue; }
    if (thick > cfg.maxThicknessM) { stats.removedThickWalls++; continue; }
    if ((lenRaw as number) < cfg.minWallLengthM) { stats.removedTinyWalls++; continue; }
    if ((lenRaw as number) > cfg.maxWallLengthM) { stats.removedHugeWalls++; continue; }

    let altura = w.altura_m;
    if (!Number.isFinite(altura) || !altura || altura <= 0 || altura < cfg.minWallHeightM || altura > cfg.maxWallHeightM) {
      altura = cfg.defaultPeDireitoM;
      stats.snappedWallHeights++;
    }
    validWalls.push({ ...w, espessura_m: thick, altura_m: altura });
  }
  stats.wallsAfter = validWalls.length;

  const validSlabs: ExtractedSlab[] = [];
  for (const s of slabs) {
    if (!Number.isFinite(s.area_m2) || (s.area_m2 as number) <= 0) { removedNonFiniteSlabs++; continue; }
    if (s.area_m2 < cfg.minSlabAreaM2) { stats.removedTinySlabs++; continue; }
    if (s.area_m2 > cfg.maxSlabAreaM2) { stats.removedHugeSlabs++; continue; }
    validSlabs.push(s);
  }
  if (removedNonFiniteWalls) stats.notes.push(`${removedNonFiniteWalls} parede(s) com valores inválidos (NaN/Infinity)`);
  if (removedNonFiniteSlabs) stats.notes.push(`${removedNonFiniteSlabs} laje(s) com áreas inválidas (NaN/Infinity)`);
  stats.slabsAfter = validSlabs.length;

  if (stats.removedThinWalls) stats.notes.push(`${stats.removedThinWalls} parede(s) finas demais (< ${cfg.minThicknessM}m)`);
  if (stats.removedThickWalls) stats.notes.push(`${stats.removedThickWalls} parede(s) grossas demais (> ${cfg.maxThicknessM}m)`);
  if (stats.removedTinyWalls) stats.notes.push(`${stats.removedTinyWalls} parede(s) curtas demais (< ${cfg.minWallLengthM}m)`);
  if (stats.removedHugeWalls) stats.notes.push(`${stats.removedHugeWalls} parede(s) longas demais (> ${cfg.maxWallLengthM}m)`);
  if (stats.removedTinySlabs) stats.notes.push(`${stats.removedTinySlabs} laje(s) pequenas demais (< ${cfg.minSlabAreaM2}m²)`);
  if (stats.removedHugeSlabs) stats.notes.push(`${stats.removedHugeSlabs} laje(s) absurdas (> ${cfg.maxSlabAreaM2}m²)`);
  if (stats.snappedWallHeights) stats.notes.push(`${stats.snappedWallHeights} parede(s) com altura ajustada ao pé-direito`);

  return { walls: validWalls, slabs: validSlabs, corners, stats };
}

export function summarizeValidation(stats: ValidationStats): string {
  const dropsW = stats.wallsBefore - stats.wallsAfter;
  const dropsS = stats.slabsBefore - stats.slabsAfter;
  return `paredes: ${stats.wallsBefore}→${stats.wallsAfter} (-${dropsW}) | lajes: ${stats.slabsBefore}→${stats.slabsAfter} (-${dropsS})${stats.snappedWallHeights ? ` | alturas ajustadas: ${stats.snappedWallHeights}` : ""}`;
}
