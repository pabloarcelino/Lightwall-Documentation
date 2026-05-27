import type { ExtractedWall, ExtractedSlab } from "../gemini/planAnalyzer";
import type { EnvelopePolygon } from "./envelopeExtractor";

/**
 * Estagio S12 da metodologia: validacao global deterministica.
 *
 * Roda DEPOIS de toda a extracao + topologia + linker, ANTES de
 * apresentar resultado ao usuario. Faz checagens cruzadas que so
 * fazem sentido com a visao completa do projeto:
 *
 *  - Area de aberturas vs area da parede (impossibilidade fisica).
 *  - Externas formam um poligono fechado? (deve ter pelo menos 4).
 *  - Soma de comprimentos das externas coerente com perimetro do envelope.
 *  - Pe-direito plausivel (2.0 - 4.5m residencial; ate 6.0 comercial).
 *  - Espessura plausivel (5cm - 40cm em Lightwall).
 *  - Razao paredes_externas:internas plausivel (entre 1:1 e 1:5).
 *  - Area de coberta vs piso (devem ser similares em projetos terreas).
 *
 * Cada violacao vira uma audit_note com severidade (info, warning, error).
 * Nao MODIFICA dados — apenas reporta para a UI mostrar.
 */

export type AuditSeverity = "info" | "warning" | "error";

export interface AuditNote {
  severity: AuditSeverity;
  code: string;          // identificador estavel, ex: "OPENING_OVER_WALL"
  message: string;       // mensagem amigavel pt-BR
  context?: Record<string, unknown>; // valores envolvidos (para UI/debug)
  /** IDs de elementos relacionados (ex: walls.id), util para destacar UI. */
  relatedIds?: string[];
}

export interface SelfCheckInput {
  walls: ExtractedWall[];
  slabs: ExtractedSlab[];
  envelopes: EnvelopePolygon[];
  buildingType?: string;
}

export interface SelfCheckResult {
  notes: AuditNote[];
  summary: {
    total: number;
    info: number;
    warning: number;
    error: number;
  };
}

// ============================================================
// Helpers
// ============================================================

function polygonPerimeterNorm(poly: Array<[number, number]>): number {
  if (poly.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

function polygonAreaNorm(poly: Array<[number, number]>): number {
  if (poly.length < 3) return 0;
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  }
  return Math.abs(s) / 2;
}

// ============================================================
// Checagens individuais
// ============================================================

function checkOpeningsVsWallArea(walls: ExtractedWall[]): AuditNote[] {
  const notes: AuditNote[] = [];
  for (const w of walls) {
    if (!w.comprimento_m || !w.altura_m) continue;
    const wallArea = w.comprimento_m * w.altura_m;
    if (wallArea <= 0) continue;
    const openingArea = Number(w.opening_area_m2) || 0;
    if (openingArea > wallArea) {
      notes.push({
        severity: "error",
        code: "OPENING_OVER_WALL",
        message: `Parede ${(w as any).displayLabel || w.id}: area de aberturas (${openingArea.toFixed(2)}m²) excede a area da parede (${wallArea.toFixed(2)}m²). Reveja esquadrias ou dimensoes.`,
        context: { wallArea, openingArea, comprimento: w.comprimento_m, altura: w.altura_m },
        relatedIds: [w.id],
      });
    } else if (openingArea > wallArea * 0.85) {
      notes.push({
        severity: "warning",
        code: "OPENING_NEAR_WALL_LIMIT",
        message: `Parede ${(w as any).displayLabel || w.id}: area de aberturas (${openingArea.toFixed(2)}m²) ocupa mais de 85% da parede (${wallArea.toFixed(2)}m²). Estruturalmente improvavel.`,
        context: { wallArea, openingArea },
        relatedIds: [w.id],
      });
    }
  }
  return notes;
}

function checkPeDireito(walls: ExtractedWall[], buildingType?: string): AuditNote[] {
  const notes: AuditNote[] = [];
  const isCommercial =
    buildingType === "comercial" || buildingType === "industrial" || buildingType === "institucional";
  const maxOk = isCommercial ? 6.0 : 4.5;
  const minOk = 2.0;
  for (const w of walls) {
    if (!w.altura_m) continue;
    if (w.altura_m < minOk) {
      notes.push({
        severity: "warning",
        code: "PE_DIREITO_BAIXO",
        message: `Parede ${(w as any).displayLabel || w.id}: pe-direito ${w.altura_m.toFixed(2)}m abaixo do minimo plausivel (${minOk}m).`,
        context: { altura: w.altura_m },
        relatedIds: [w.id],
      });
    } else if (w.altura_m > maxOk) {
      notes.push({
        severity: "warning",
        code: "PE_DIREITO_ALTO",
        message: `Parede ${(w as any).displayLabel || w.id}: pe-direito ${w.altura_m.toFixed(2)}m acima do tipico (${maxOk}m). Confira corte.`,
        context: { altura: w.altura_m, buildingType },
        relatedIds: [w.id],
      });
    }
  }
  return notes;
}

function checkEspessura(walls: ExtractedWall[]): AuditNote[] {
  const notes: AuditNote[] = [];
  for (const w of walls) {
    if (!w.espessura_m) continue;
    if (w.espessura_m < 0.05) {
      notes.push({
        severity: "warning",
        code: "ESPESSURA_FINA",
        message: `Parede ${(w as any).displayLabel || w.id}: espessura ${(w.espessura_m * 100).toFixed(1)}cm abaixo do minimo Lightwall (5cm).`,
        context: { espessura_cm: w.espessura_m * 100 },
        relatedIds: [w.id],
      });
    } else if (w.espessura_m > 0.40) {
      notes.push({
        severity: "info",
        code: "ESPESSURA_GROSSA",
        message: `Parede ${(w as any).displayLabel || w.id}: espessura ${(w.espessura_m * 100).toFixed(1)}cm acima do tipico. Pode ser mobiliario ou shaft.`,
        context: { espessura_cm: w.espessura_m * 100 },
        relatedIds: [w.id],
      });
    }
  }
  return notes;
}

function checkExternaInternaRatio(walls: ExtractedWall[], buildingType?: string): AuditNote[] {
  const notes: AuditNote[] = [];
  const ext = walls.filter(w => w.classe === "externa");
  const int = walls.filter(w => w.classe === "interna");
  if (ext.length === 0) {
    notes.push({
      severity: "error",
      code: "SEM_EXTERNAS",
      message: "Nenhuma parede externa identificada. A edificacao nao fecha — confira o envelope detectado e a topologia.",
    });
    return notes;
  }
  if (int.length === 0 && ext.length > 4) {
    notes.push({
      severity: "warning",
      code: "SEM_INTERNAS",
      message: "Nenhuma parede interna identificada. Improvavel para casas/comerciais — confira a classificacao topologica.",
      context: { externas: ext.length },
    });
  }
  const ratio = int.length / ext.length;
  const minRatio = buildingType === "comercial" ? 0.2 : 0.4;
  const maxRatio = 6.0;
  if (ext.length >= 4 && (ratio < minRatio || ratio > maxRatio)) {
    notes.push({
      severity: "info",
      code: "RATIO_EXT_INT_ATIPICO",
      message: `Razao internas:externas = ${ratio.toFixed(2)} fora do tipico (${minRatio.toFixed(2)} - ${maxRatio.toFixed(1)}). Pode ser arquitetura especifica ou erro de classificacao.`,
      context: { externas: ext.length, internas: int.length, ratio },
    });
  }
  return notes;
}

function checkEnvelopeClosed(envelopes: EnvelopePolygon[]): AuditNote[] {
  const notes: AuditNote[] = [];
  for (const env of envelopes) {
    if (env.polygon.length < 4) {
      notes.push({
        severity: "warning",
        code: "ENVELOPE_POUCOS_VERTICES",
        message: `Envelope do pavimento "${env.pavimento}" tem apenas ${env.polygon.length} vertices. Pode estar mal tracado.`,
        context: { pavimento: env.pavimento, vertices: env.polygon.length },
      });
    }
    if (env.confidence < 0.5) {
      notes.push({
        severity: "warning",
        code: "ENVELOPE_CONFIANCA_BAIXA",
        message: `Envelope do pavimento "${env.pavimento}" com confianca ${env.confidence.toFixed(2)} < 0.5. A classificacao topologica pode estar comprometida.`,
        context: { pavimento: env.pavimento, confidence: env.confidence },
      });
    }
  }
  return notes;
}

function checkPerimetroVsExternas(
  walls: ExtractedWall[],
  envelopes: EnvelopePolygon[],
): AuditNote[] {
  const notes: AuditNote[] = [];
  // Calcula o perimetro do envelope em unidades normalizadas e compara com a
  // soma de comprimentos das paredes externas. Se a IA detectou perimetro mas
  // as externas somam muito menos, falta parede; muito mais, ha duplicacao.
  // Esta verificacao e qualitativa porque nao temos pixelsPerMeter aqui.
  for (const env of envelopes) {
    const perimNorm = polygonPerimeterNorm(env.polygon);
    if (perimNorm < 1) continue;
    const externas = walls.filter(
      w => w.classe === "externa" && (w.nivel || "Terreo").toLowerCase() === env.pavimento.toLowerCase(),
    );
    if (externas.length < 3) {
      notes.push({
        severity: "warning",
        code: "POUCAS_EXTERNAS_PARA_PERIMETRO",
        message: `Pavimento "${env.pavimento}": envelope detectado com ${env.polygon.length} vertices mas so ${externas.length} parede(s) externa(s). Provavelmente falta extrair paredes ou a classificacao esta errada.`,
        context: { pavimento: env.pavimento, vertices: env.polygon.length, externas: externas.length },
      });
    }
  }
  return notes;
}

function checkPisoVsCoberta(slabs: ExtractedSlab[]): AuditNote[] {
  const notes: AuditNote[] = [];
  const byPav = new Map<string, { piso: number; coberta: number }>();
  for (const s of slabs) {
    const k = (s.nivel || "Terreo").toLowerCase();
    if (!byPav.has(k)) byPav.set(k, { piso: 0, coberta: 0 });
    const obj = byPav.get(k)!;
    if (s.classe === "piso" || s.classe === "radier") obj.piso += s.area_m2 || 0;
    else if (s.classe === "coberta") obj.coberta += s.area_m2 || 0;
  }
  for (const [pav, { piso, coberta }] of byPav) {
    if (piso > 0 && coberta > 0) {
      const ratio = coberta / piso;
      if (ratio < 0.6 || ratio > 1.8) {
        notes.push({
          severity: "info",
          code: "PISO_COBERTA_DIVERGENTES",
          message: `Pavimento "${pav}": laje coberta (${coberta.toFixed(1)}m²) e laje piso (${piso.toFixed(1)}m²) divergem (razao ${ratio.toFixed(2)}). Tipico de cobertura com beiral grande ou erro de extracao.`,
          context: { pavimento: pav, piso, coberta, ratio },
        });
      }
    }
  }
  return notes;
}

// ============================================================
// Fase E (E.0.5): checagens de contrato multi-vista
// ============================================================

/**
 * REGRA DE OURO: nenhum wall pode ter primary.view diferente de
 * "planta_baixa"/"planta_cobertura". Se aparecer, e bug de pipeline
 * (extracao de cortes/fachadas/3D vazando para o orcamento).
 */
function checkOrphansFromNonPlanta(walls: ExtractedWall[], slabs: ExtractedSlab[]): AuditNote[] {
  const notes: AuditNote[] = [];
  const ALLOWED: Array<string> = ["planta_baixa", "planta_cobertura"];

  const orphanWalls = walls.filter(
    w => w.sourceContribution && !ALLOWED.includes(w.sourceContribution.primary.view),
  );
  if (orphanWalls.length > 0) {
    notes.push({
      severity: "error",
      code: "ORPHAN_FROM_NON_PLANTA",
      message:
        `${orphanWalls.length} parede(s) com origem primaria fora de planta_baixa/planta_cobertura. ` +
        `Apenas plantas baixas podem criar paredes — cortes/fachadas/3D so enriquecem.`,
      context: { count: orphanWalls.length, views: Array.from(new Set(orphanWalls.map(w => w.sourceContribution?.primary.view))) },
      relatedIds: orphanWalls.slice(0, 10).map(w => w.id),
    });
  }

  const orphanSlabs = slabs.filter(
    s => s.sourceContribution && !ALLOWED.includes(s.sourceContribution.primary.view),
  );
  if (orphanSlabs.length > 0) {
    notes.push({
      severity: "error",
      code: "ORPHAN_SLAB_FROM_NON_PLANTA",
      message:
        `${orphanSlabs.length} laje(s) com origem primaria fora de planta_baixa/planta_cobertura. ` +
        `Cortes/fachadas/3D nao podem criar lajes.`,
      context: { count: orphanSlabs.length },
      relatedIds: orphanSlabs.slice(0, 10).map(s => s.id),
    });
  }

  return notes;
}

/**
 * Resumo de procedencia: conta paredes por vista primaria e por enriquecimentos.
 * Vira note INFO (nao e erro) para visibilidade na UI.
 */
function checkProvenanceSummary(walls: ExtractedWall[]): AuditNote[] {
  const withContribution = walls.filter(w => !!w.sourceContribution);
  if (withContribution.length === 0) return [];

  const byPrimary = new Map<string, number>();
  const enrichByView = new Map<string, number>();
  for (const w of withContribution) {
    const pv = w.sourceContribution!.primary.view;
    byPrimary.set(pv, (byPrimary.get(pv) || 0) + 1);
    for (const e of w.sourceContribution!.enrichments) {
      enrichByView.set(e.view, (enrichByView.get(e.view) || 0) + 1);
    }
  }

  const primaryStr = Array.from(byPrimary.entries()).map(([k, v]) => `${k}=${v}`).join(", ");
  const enrichStr = Array.from(enrichByView.entries()).map(([k, v]) => `${k}=${v}`).join(", ") || "nenhum";

  return [{
    severity: "info",
    code: "PROVENANCE_SUMMARY",
    message:
      `Procedencia: paredes primarias [${primaryStr}]; enriquecimentos por vista [${enrichStr}].`,
    context: { primary: Object.fromEntries(byPrimary), enrichments: Object.fromEntries(enrichByView) },
  }];
}

// ============================================================
// Roda todos os checks
// ============================================================

export function runSelfCheck(input: SelfCheckInput): SelfCheckResult {
  const all: AuditNote[] = [];
  all.push(...checkOrphansFromNonPlanta(input.walls, input.slabs));
  all.push(...checkProvenanceSummary(input.walls));
  all.push(...checkOpeningsVsWallArea(input.walls));
  all.push(...checkPeDireito(input.walls, input.buildingType));
  all.push(...checkEspessura(input.walls));
  all.push(...checkExternaInternaRatio(input.walls, input.buildingType));
  all.push(...checkEnvelopeClosed(input.envelopes));
  all.push(...checkPerimetroVsExternas(input.walls, input.envelopes));
  all.push(...checkPisoVsCoberta(input.slabs));

  return {
    notes: all,
    summary: {
      total: all.length,
      info: all.filter(n => n.severity === "info").length,
      warning: all.filter(n => n.severity === "warning").length,
      error: all.filter(n => n.severity === "error").length,
    },
  };
}
