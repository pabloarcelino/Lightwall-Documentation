import type { ExtractedWall, ExtractedSlab, ExtractedCorner, TableData, GeometryResult } from "../gemini/planAnalyzer";
import { DEFAULT_ASSUMPTIONS } from "./assumptions";
import { getBuildingTypeConfig } from "../gemini/buildingTypePrompts";

const AREA_PAINEL_M2 = 1.83;
const TIPO_PAINEL = "2P";
const PERDA_LAJE = 0.10;

export interface WallItem {
  id: string;
  nivel: string;
  classe: "externa" | "interna" | "muro";
  comprimento_m: number;
  altura_m: number;
  espessura_m: number;
  measurement_source: string;
  confidence: number;
  opening_area_m2: number;
  esquadrias: Array<{ tipo: string; codigo: string; largura_m: number; altura_m: number; peitoril_m?: number }>;
  area_bruta_m2: number;
  area_liquida_m2: number;
  quantidade_paineis: number;
  needs_review?: boolean;
  review_reason?: string;
}

export interface SlabItem {
  id: string;
  nivel: string;
  classe: "coberta" | "piso" | "radier";
  area_m2: number;
  quantidade_paineis: number;
  is_radier: boolean;
  observacao?: string;
  measurement_source: string;
  confidence: number;
}

export interface FloorGroup {
  nome: string;
  paredes_externas: { comprimento_total_m: number; area_bruta_m2: number; area_liquida_m2: number; quantidade_paineis: number; measurement_source_dominant?: string; needs_review_count?: number; itens: WallItem[] };
  paredes_internas: { comprimento_total_m: number; area_bruta_m2: number; area_liquida_m2: number; quantidade_paineis: number; measurement_source_dominant?: string; needs_review_count?: number; itens: WallItem[] };
  muros: { comprimento_total_m: number; area_bruta_m2: number; quantidade_paineis: number; measurement_source_dominant?: string; needs_review_count?: number; itens: WallItem[] };
  laje_piso: { area_m2: number; quantidade_paineis: number; is_radier: boolean; observacao: string; measurement_source_dominant?: string };
  laje_coberta: { area_m2: number; quantidade_paineis: number; measurement_source_dominant?: string };
  cantos: { quantidade: number };
}

export interface Inconsistencia {
  severidade: "Critica" | "Media" | "Baixa";
  mensagem: string;
}

export interface BudgetResult {
  pavimentos: FloorGroup[];
  resumo: {
    paredes_externas: { quantidade_paineis: number; tipo_painel: string };
    paredes_internas: { quantidade_paineis: number; tipo_painel: string };
    muros: { quantidade_paineis: number; tipo_painel: string; comprimento_total_m: number };
    laje_piso: { quantidade_paineis: number; tipo_painel: string };
    laje_coberta: { quantidade_paineis: number; tipo_painel: string };
    total_geral_paineis: number;
  };
  consolidado_por_tipo: Array<{ tipo_painel: string; quantidade_total_paineis: number }>;
  alertas: string[];
  inconsistencias: Inconsistencia[];
  aviso: string;
}

function num(v: any, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function applyWallDefaults(wall: ExtractedWall): ExtractedWall {
  const w = { ...wall, esquadrias: [...(wall.esquadrias || [])] };
  w.altura_m = num(w.altura_m, 0);
  w.espessura_m = num(w.espessura_m, 0);
  w.comprimento_m = num(w.comprimento_m, 0);
  w.opening_area_m2 = num(w.opening_area_m2, 0);
  if (!w.altura_m || w.altura_m <= 0) w.altura_m = DEFAULT_ASSUMPTIONS.wallHeight.value;
  if (!w.espessura_m || w.espessura_m <= 0) w.espessura_m = 0.10;
  if (!w.comprimento_m || w.comprimento_m <= 0) w.comprimento_m = 0;

  for (const esq of w.esquadrias) {
    esq.largura_m = num(esq.largura_m, 0);
    esq.altura_m = num(esq.altura_m, 0);
    if (esq.peitoril_m !== undefined && esq.peitoril_m !== null) esq.peitoril_m = num(esq.peitoril_m, 0);
    if (esq.tipo === "porta") {
      if (!esq.largura_m || esq.largura_m <= 0) esq.largura_m = DEFAULT_ASSUMPTIONS.doorWidth.value;
      if (!esq.altura_m || esq.altura_m <= 0) esq.altura_m = DEFAULT_ASSUMPTIONS.doorHeight.value;
    } else {
      if (!esq.largura_m || esq.largura_m <= 0) esq.largura_m = DEFAULT_ASSUMPTIONS.windowWidth.value;
      if (!esq.altura_m || esq.altura_m <= 0) esq.altura_m = DEFAULT_ASSUMPTIONS.windowHeight.value;
      if (!esq.peitoril_m || esq.peitoril_m <= 0) esq.peitoril_m = DEFAULT_ASSUMPTIONS.windowSillHeight.value;
    }
  }

  let computedOpeningArea = 0;
  for (const esq of w.esquadrias) {
    computedOpeningArea += esq.largura_m * esq.altura_m;
  }
  if (computedOpeningArea > 0) {
    w.opening_area_m2 = computedOpeningArea;
  }

  return w;
}

function applySlabDefaults(slab: ExtractedSlab): ExtractedSlab {
  const s = { ...slab };
  return s;
}

function wallSignature(w: ExtractedWall): string {
  // 0.05m granularity (round to nearest 0.05) — prevents merging walls that differ by <0.1m
  const roundL = Math.round(w.comprimento_m * 20);
  const roundH = Math.round(w.altura_m * 20);
  // Include esquadria types+sizes for better differentiation
  const esqSig = (w.esquadrias || []).map(e => `${e.tipo[0]}${Math.round((e.largura_m || 0) * 10)}`).sort().join(",");
  return `${w.nivel}|${w.classe}|${roundL}|${roundH}|${esqSig || "0"}`;
}

function slabSignature(s: ExtractedSlab): string {
  // 0.05m² granularity
  return `${s.nivel}|${s.classe}|${Math.round(s.area_m2 * 20)}`;
}

export function fusionMultiView(
  geometries: GeometryResult[],
  tableData: TableData | null,
  buildingType?: string,
): { walls: ExtractedWall[]; slabs: ExtractedSlab[]; corners: ExtractedCorner[] } {
  let allWalls: ExtractedWall[] = [];
  let allSlabs: ExtractedSlab[] = [];
  let allCorners: ExtractedCorner[] = [];

  for (const geo of geometries) {
    allWalls.push(...geo.walls);
    allSlabs.push(...geo.slabs);
    allCorners.push(...geo.corners);
  }

  if (tableData) {
    for (const tw of tableData.paredes_de_tabela) {
      const twComprimento = num(tw.comprimento_m, 0);
      const twAltura = num(tw.altura_m, 0);
      const twEspessura = num(tw.espessura_m, 0.10);
      const existing = allWalls.find(w =>
        w.nivel === tw.nivel &&
        w.classe === (tw.classe as "externa" | "interna" | "muro") &&
        Math.abs(w.comprimento_m - twComprimento) < 0.5
      );
      if (existing) {
        existing.comprimento_m = twComprimento;
        existing.altura_m = twAltura;
        existing.espessura_m = twEspessura;
        existing.measurement_source = "table";
        existing.confidence = 0.95;
      } else {
        allWalls.push({
          id: tw.id || `PT${allWalls.length + 1}`,
          nivel: tw.nivel || "Terreo",
          classe: (tw.classe === "muro" ? "muro" : tw.classe === "interna" ? "interna" : "externa") as "externa" | "interna" | "muro",
          comprimento_m: twComprimento,
          altura_m: twAltura,
          espessura_m: twEspessura,
          measurement_source: "table",
          confidence: 0.95,
          has_door: false, has_window: false, opening_area_m2: 0, esquadrias: [],
        });
      }
    }

    for (const te of tableData.esquadrias_de_tabela) {
      const teLargura = num(te.largura_m, 0);
      const teAltura = num(te.altura_m, 0);
      for (const wall of allWalls) {
        for (const esq of wall.esquadrias) {
          if (esq.codigo === te.codigo) {
            esq.largura_m = teLargura;
            esq.altura_m = teAltura;
            esq.measurement_source = "table";
          }
        }
      }
    }

    if (tableData.areas_de_tabela.length > 0) {
      // Distinguir explicitamente entre area_total (autoritativa para piso),
      // area_coberta (autoritativa para coberta) e soma de comodos (referencia,
      // usada apenas como teto/fallback).
      const totalsByNivel = new Map<string, number>();
      const cobertaByNivel = new Map<string, number>();
      const sumsByNivel = new Map<string, number>();
      for (const at of tableData.areas_de_tabela) {
        const atArea = num(at.area_m2, 0);
        if (atArea <= 0) continue;
        if (at.tipo === "area_coberta") {
          cobertaByNivel.set(at.nivel, Math.max(cobertaByNivel.get(at.nivel) || 0, atArea));
          // area_coberta tambem participa do cap de piso (e>= area piso)
          totalsByNivel.set(at.nivel, Math.max(totalsByNivel.get(at.nivel) || 0, atArea));
        } else if (at.tipo === "area_total") {
          // Use o maior area_total reportado (caso haja duplicatas em multiplas paginas)
          totalsByNivel.set(at.nivel, Math.max(totalsByNivel.get(at.nivel) || 0, atArea));
        } else {
          sumsByNivel.set(at.nivel, (sumsByNivel.get(at.nivel) || 0) + atArea);
        }
      }

      // Autoritativo para laje COBERTA: area_coberta da tabela vira ground-truth.
      for (const [nivel, area] of cobertaByNivel) {
        const existingCoberta = allSlabs.find(s => s.nivel === nivel && s.classe === "coberta");
        if (existingCoberta) {
          if (existingCoberta.measurement_source !== "table_area_total") {
            console.log(`[FUSAO] Corrigindo area laje coberta ${nivel}: ${existingCoberta.area_m2} → ${area} (table_area_coberta)`);
            existingCoberta.area_m2 = area;
            existingCoberta.measurement_source = "table_area_total";
            existingCoberta.confidence = 0.98;
          }
        } else {
          allSlabs.push({
            id: `LCT_${nivel}`,
            nivel,
            classe: "coberta",
            area_m2: area,
            measurement_source: "table_area_total",
            confidence: 0.98,
          });
          console.log(`[FUSAO] Laje coberta ${nivel} criada a partir do quadro de areas: ${area} m²`);
        }
      }

      // Para cada nivel, escolher a referencia de area mais confiavel.
      // Prioridade: area_total da tabela > soma_comodos > nada.
      const referenceByNivel = new Map<string, { area: number; source: "table_area_total" | "table_sum_rooms" }>();
      for (const [nivel, total] of totalsByNivel) {
        referenceByNivel.set(nivel, { area: total, source: "table_area_total" });
      }
      for (const [nivel, sum] of sumsByNivel) {
        if (!referenceByNivel.has(nivel)) {
          referenceByNivel.set(nivel, { area: sum, source: "table_sum_rooms" });
        }
      }

      for (const [nivel, ref] of referenceByNivel) {
        const existingSlab = allSlabs.find(s => s.nivel === nivel && (s.classe === "piso" || s.classe === "radier"));
        if (existingSlab) {
          // area_total da tabela e GROUND-TRUTH: sempre adota (não depende de
          // desvio mínimo). Soma de comodos so substitui se a IA estiver muito
          // longe (>15%) — pode haver paredes/circulacao nao contada nos comodos.
          const shouldOverride = ref.source === "table_area_total"
            || (existingSlab.area_m2 > 0 && Math.abs(existingSlab.area_m2 - ref.area) / ref.area > 0.15)
            || existingSlab.area_m2 <= 0;
          if (shouldOverride && existingSlab.measurement_source !== "table") {
            console.log(`[FUSAO] Corrigindo area laje ${nivel}: ${existingSlab.area_m2} → ${ref.area} (${ref.source})`);
            existingSlab.area_m2 = ref.area;
            existingSlab.measurement_source = ref.source;
            existingSlab.confidence = ref.source === "table_area_total" ? 0.98 : 0.85;
          }
        } else if (ref.source === "table_area_total") {
          // Nem IA nem vetor detectaram laje desse nivel mas a tabela diz que
          // existe — criar a laje a partir da tabela (alta confianca).
          allSlabs.push({
            id: `LT_${nivel}`,
            nivel,
            classe: "piso",
            area_m2: ref.area,
            measurement_source: "table_area_total",
            confidence: 0.98,
          });
          console.log(`[FUSAO] Laje piso ${nivel} criada a partir do quadro de areas: ${ref.area} m²`);
        }
      }

      // Cap absoluto: nenhuma laje pode ultrapassar area_total da tabela em mais de 5%.
      for (const slab of allSlabs) {
        const total = totalsByNivel.get(slab.nivel);
        if (!total) continue;
        if (slab.classe !== "piso" && slab.classe !== "radier" && slab.classe !== "coberta") continue;
        const cap = total * 1.05;
        if (slab.area_m2 > cap && slab.measurement_source !== "table_area_total") {
          console.log(`[FUSAO] Cap por area_total tabela ${slab.nivel}: laje ${slab.classe} ${slab.area_m2} → ${total} (limite ${cap.toFixed(1)})`);
          slab.area_m2 = total;
          slab.measurement_source = `${slab.measurement_source}_capped_by_table`;
          slab.confidence = Math.max(slab.confidence, 0.9);
        }
      }
    }
  }

  for (const wall of allWalls) {
    if (wall.comprimento_m > 50) {
      console.log(`[FUSAO] Parede ${wall.id} com ${wall.comprimento_m}m parece em cm, convertendo...`);
      wall.comprimento_m = wall.comprimento_m / 100;
      wall.measurement_source = wall.measurement_source + "_cm_corrected";
    }
    if (wall.altura_m > 10) {
      console.log(`[FUSAO] Parede ${wall.id} com altura ${wall.altura_m}m parece em cm, convertendo...`);
      wall.altura_m = wall.altura_m / 100;
    }
  }

  allWalls = allWalls.map(applyWallDefaults);
  allSlabs = allSlabs.map(applySlabDefaults);

  const btHeuristics = getBuildingTypeConfig(buildingType).fusionHeuristics;

  const extWallCount = allWalls.filter(w => w.classe === "externa").length;
  const intWallCount = allWalls.filter(w => w.classe === "interna").length;
  const minInternalRatio = btHeuristics.minInternalWallRatio;
  const perimeterFraction = btHeuristics.perimeterWallFraction;
  const maxPerimeterWalls = btHeuristics.maxPerimeterWalls;

  // Score-based reclassification: walls more likely to be external get higher scores
  function wallExternalScore(wall: ExtractedWall): number {
    let score = wall.comprimento_m; // longer walls more likely external (perimeter)
    if (wall.has_window) score += 2.0; // windows strongly suggest external
    if (wall.has_door && wall.esquadrias.some(e => e.largura_m >= 1.0)) {
      score += 1.5; // wide doors suggest entry (external)
    }
    if (wall.bbox) {
      const [ymin, xmin, ymax, xmax] = wall.bbox;
      const nearEdge = ymin < 100 || xmin < 100 || ymax > 900 || xmax > 900;
      if (nearEdge) score += 3.0; // near image edge = likely perimeter
    }
    return score;
  }

  const reclassifiable = allWalls.filter(w => w.classe !== "muro");

  // CASO EXTREMO (preservado): se TODAS as paredes vieram como externas e o tipo
  // de edificacao espera paredes internas, reclassifica por score (sobrescrita).
  if (reclassifiable.length >= 6 && intWallCount === 0 && minInternalRatio > 0.15) {
    console.log(`[FUSAO] CORRECAO (${buildingType || "generico"}): Todas as ${extWallCount} paredes sao externas — reclassificando por score (muros nao afetados)`);
    const sorted = [...reclassifiable].sort((a, b) => wallExternalScore(b) - wallExternalScore(a));
    const perimeterCount = Math.min(Math.ceil(reclassifiable.length * perimeterFraction), maxPerimeterWalls);
    const perimeterIds = new Set(sorted.slice(0, perimeterCount).map(w => w.id));
    for (const wall of reclassifiable) {
      if (!perimeterIds.has(wall.id)) {
        wall.classe = "interna";
        wall.needs_review = true;
        wall.review_reason = `Reclassificada de externa para interna pelo score (${wallExternalScore(wall).toFixed(1)})`;
        console.log(`[FUSAO] Parede ${wall.id} (${wall.comprimento_m}m, score=${wallExternalScore(wall).toFixed(1)}) reclassificada como interna`);
      } else {
        console.log(`[FUSAO] Parede ${wall.id} (${wall.comprimento_m}m, score=${wallExternalScore(wall).toFixed(1)}) mantida como externa (perimetro)`);
      }
    }
  } else if (reclassifiable.length >= 8 && extWallCount > intWallCount * 2 && buildingType !== "industrial") {
    console.log(`[FUSAO] AVISO (${buildingType || "generico"}): ${extWallCount} externas vs ${intWallCount} internas — proporcao incomum, pode haver classificacao errada`);
  }

  // SEMPRE: marcar needs_review quando a classificacao da IA discordar do score.
  // Nao sobrescreve a classe — apenas sinaliza para revisao humana.
  if (reclassifiable.length >= 4) {
    const scored = reclassifiable.map(w => ({ wall: w, score: wallExternalScore(w) }));
    const scores = scored.map(s => s.score);
    const maxScore = Math.max(...scores, 1);
    const minScore = Math.min(...scores, 0);
    const range = Math.max(maxScore - minScore, 0.001);

    // Esperado de "perimeter walls" pelo tipo de edificacao
    const expectedPerimeter = Math.min(
      Math.ceil(reclassifiable.length * perimeterFraction),
      maxPerimeterWalls,
    );
    const sortedDesc = [...scored].sort((a, b) => b.score - a.score);
    const expectedExternalIds = new Set(sortedDesc.slice(0, expectedPerimeter).map(s => s.wall.id));

    for (const { wall, score } of scored) {
      // Pula paredes ja sinalizadas pelo caso extremo (evita double-flag)
      if (wall.needs_review) continue;

      // Score normalizado 0..1 dentro do projeto
      const norm = (score - minScore) / range;
      const expectedExternal = expectedExternalIds.has(wall.id);

      // Falsa externa: classificada como externa mas com score baixo e fora do top expected
      if (wall.classe === "externa" && norm < 0.35 && !expectedExternal) {
        wall.needs_review = true;
        wall.review_reason = `Classificada como externa mas score baixo (${score.toFixed(1)}, ${wall.comprimento_m.toFixed(1)}m, ${wall.has_window ? "" : "sem janela, "}${wall.bbox ? "" : "sem bbox, "}fora do perimetro esperado)`.replace(/, $/, "");
        wall.confidence = Math.min(wall.confidence, 0.6);
      }
      // Falsa interna: classificada como interna mas com score alto e dentro do top expected
      else if (wall.classe === "interna" && norm > 0.7 && expectedExternal) {
        wall.needs_review = true;
        wall.review_reason = `Classificada como interna mas score alto (${score.toFixed(1)}, ${wall.comprimento_m.toFixed(1)}m${wall.has_window ? ", tem janela" : ""}${wall.bbox ? ", perto da borda" : ""}) sugere externa`;
        wall.confidence = Math.min(wall.confidence, 0.6);
      }
    }

    const flagged = reclassifiable.filter(w => w.needs_review).length;
    if (flagged > 0) {
      console.log(`[FUSAO] ${flagged} parede(s) marcada(s) para revisao humana (classificacao vs score divergente)`);
    }
  }

  const seenWalls = new Set<string>();
  const sigDedupedWalls: ExtractedWall[] = [];
  for (const w of allWalls) {
    const sig = wallSignature(w);
    if (!seenWalls.has(sig)) {
      seenWalls.add(sig);
      sigDedupedWalls.push(w);
    }
  }

  const seenSlabs = new Set<string>();
  const sigDedupedSlabs: ExtractedSlab[] = [];
  for (const s of allSlabs) {
    const sig = slabSignature(s);
    if (!seenSlabs.has(sig)) {
      seenSlabs.add(sig);
      sigDedupedSlabs.push(s);
    }
  }

  // ===== Consolidacao por pagina dominante (apenas em caso de over-extraction) =====
  // Quando o mesmo pavimento aparece em multiplas paginas (planta arquitetonica
  // + cotada + humanizada + corte etc), a mesma estrutura e extraida N vezes com
  // pequenas variacoes de medida que driblam a deduplicacao por assinatura acima
  // (bucket de 5cm). Para cada (nivel, classe), se HOUVER suspeita de over-extraction
  // (mais paredes que o limite plausivel), mantemos apenas a pagina dominante.
  // Se a contagem for plausivel, preservamos tudo (cobre o caso de plantas legitimas
  // divididas em multiplas paginas).
  const PLAUSIBLE_MAX_WALLS_PER_NIVEL_CLASSE = 30; // residencial; tipos maiores ainda passam por dedup local
  const wallsByNivelClasse = new Map<string, ExtractedWall[]>();
  for (const w of sigDedupedWalls) {
    const key = `${w.nivel}|${w.classe}`;
    const arr = wallsByNivelClasse.get(key);
    if (arr) arr.push(w); else wallsByNivelClasse.set(key, [w]);
  }
  const deduplicatedWalls: ExtractedWall[] = [];
  for (const [key, group] of wallsByNivelClasse) {
    if (group.length === 0) continue;
    const pageCounts = new Map<number, number>();
    for (const w of group) {
      const p = typeof w.page_index === "number" ? w.page_index : -1;
      pageCounts.set(p, (pageCounts.get(p) ?? 0) + 1);
    }
    // Sem multiplas paginas OU contagem plausivel → mantem tudo
    if (pageCounts.size <= 1 || group.length <= PLAUSIBLE_MAX_WALLS_PER_NIVEL_CLASSE) {
      deduplicatedWalls.push(...group);
      continue;
    }
    // Trigger: > PLAUSIBLE_MAX paredes em multiplas paginas → suspeita de duplicacao multi-planta.
    // Pagina dominante = a com mais contribuicoes; desempate pela maior soma de comprimento.
    const ranked = [...pageCounts.keys()].map(pg => {
      const items = group.filter(w => (typeof w.page_index === "number" ? w.page_index : -1) === pg);
      const totalLen = items.reduce((a, w) => a + (w.comprimento_m || 0), 0);
      return { pg, count: items.length, totalLen };
    }).sort((a, b) => (b.count - a.count) || (b.totalLen - a.totalLen));
    const dominantPage = ranked[0].pg;
    const kept = group.filter(w => (typeof w.page_index === "number" ? w.page_index : -1) === dominantPage);
    const dropped = group.length - kept.length;
    console.log(`[FUSAO] paredes ${key}: ${group.length} > ${PLAUSIBLE_MAX_WALLS_PER_NIVEL_CLASSE} (over-extraction suspeita); ${pageCounts.size} pgs → mantendo ${kept.length} da pg dominante ${dominantPage} (descartadas ${dropped})`);
    deduplicatedWalls.push(...kept);
  }

  // Lajes: dedup por (nivel, classe) APENAS quando areas sao similares (>=70% match
  // = mesmas areas com leve jitter de extracao). Areas distintas no mesmo nivel/classe
  // (ex: 2 lajes piso de comodos diferentes) sao preservadas.
  const SLAB_AREA_SIMILARITY = 0.30; // diferenca relativa <= 30% → considera duplicata
  const slabsByNivelClasse = new Map<string, ExtractedSlab[]>();
  for (const s of sigDedupedSlabs) {
    const key = `${s.nivel}|${s.classe}`;
    const arr = slabsByNivelClasse.get(key);
    if (arr) arr.push(s); else slabsByNivelClasse.set(key, [s]);
  }
  const deduplicatedSlabs: ExtractedSlab[] = [];
  for (const [key, group] of slabsByNivelClasse) {
    if (group.length === 0) continue;
    if (group.length === 1) { deduplicatedSlabs.push(group[0]); continue; }
    // Preferir registros com confianca mais alta (table > pdf_vector > inferred);
    // entre confiancas iguais, preferir maior area (planta mais completa).
    const sorted = [...group].sort((a, b) => (b.confidence - a.confidence) || (b.area_m2 - a.area_m2));
    const kept: ExtractedSlab[] = [];
    for (const s of sorted) {
      const isDup = kept.some(k => {
        const maxArea = Math.max(k.area_m2, s.area_m2);
        if (maxArea <= 0) return false;
        return Math.abs(k.area_m2 - s.area_m2) / maxArea <= SLAB_AREA_SIMILARITY;
      });
      if (!isDup) kept.push(s);
    }
    const dropped = group.length - kept.length;
    if (dropped > 0) {
      console.log(`[FUSAO] lajes ${key}: ${group.length} → ${kept.length} (descartadas ${dropped} duplicatas com area similar)`);
    }
    deduplicatedSlabs.push(...kept);
  }

  deduplicatedWalls.forEach((w, i) => { w.id = `P${i + 1}`; });
  allCorners.forEach((c, i) => { c.id = `C${i + 1}`; });

  const floorOrder: Record<string, number> = {
    "subsolo": 0, "sub-solo": 0,
    "terreo": 1, "térreo": 1,
    "superior": 2, "1 pavimento": 2, "1º pavimento": 2,
    "2 pavimento": 3, "2º pavimento": 3, "segundo": 3,
    "3 pavimento": 4, "3º pavimento": 4,
    "coberta": 5, "cobertura": 5,
    "outro": 1,
  };

  function getFloorRank(nivel: string): number {
    const lower = nivel.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const [key, rank] of Object.entries(floorOrder)) {
      if (lower.includes(key)) return rank;
    }
    return 1;
  }

  const floors = new Set<string>();
  deduplicatedWalls.forEach(w => floors.add(w.nivel));
  deduplicatedSlabs.forEach(s => floors.add(s.nivel));

  const sortedFloors = [...floors].sort((a, b) => getFloorRank(a) - getFloorRank(b));
  const bottomFloor = sortedFloors[0];
  const topFloor = sortedFloors[sortedFloors.length - 1];

  // Limite de sanidade: residencial tipico tem ate ~600 m² por pavimento.
  // Acima disso, quase certamente o perimetro foi inflado por
  // duplicacao/over-extraction de paredes — nao auto-gerar laje absurda.
  const SANE_FLOOR_AREA_MAX_M2 = 800;

  function estimateFloorArea(floorName: string): number {
    const extWalls = deduplicatedWalls.filter(w => w.nivel === floorName && w.classe === "externa");
    if (extWalls.length > 0) {
      const totalPerimeter = extWalls.reduce((sum, w) => sum + w.comprimento_m, 0);
      const est = Math.pow(totalPerimeter / 4, 2);
      if (est > SANE_FLOOR_AREA_MAX_M2) {
        console.log(`[FUSAO] estimateFloorArea(${floorName}): estimativa ${est.toFixed(0)} m² > ${SANE_FLOOR_AREA_MAX_M2} (insano, perimetro ${totalPerimeter.toFixed(0)}m provavelmente inflado) — bail out`);
        return 0;
      }
      return Math.round(est * 100) / 100;
    }
    const allFloorWalls = deduplicatedWalls.filter(w => w.nivel === floorName);
    if (allFloorWalls.length > 0) {
      const totalPerimeter = allFloorWalls.reduce((sum, w) => sum + w.comprimento_m, 0);
      const est = Math.pow(totalPerimeter / 4, 2);
      if (est > SANE_FLOOR_AREA_MAX_M2) {
        console.log(`[FUSAO] estimateFloorArea(${floorName}): estimativa ${est.toFixed(0)} m² > ${SANE_FLOOR_AREA_MAX_M2} (insano) — bail out`);
        return 0;
      }
      return Math.round(est * 100) / 100;
    }
    return 0;
  }

  function getBestArea(floorName: string): number {
    const existingPiso = deduplicatedSlabs.find(s => s.nivel === floorName && (s.classe === "piso" || s.classe === "radier"));
    if (existingPiso && existingPiso.area_m2 > 0) return existingPiso.area_m2;
    const existingCoberta = deduplicatedSlabs.find(s => s.nivel === floorName && s.classe === "coberta");
    if (existingCoberta && existingCoberta.area_m2 > 0) return existingCoberta.area_m2;
    const anySlabArea = deduplicatedSlabs.find(s => s.area_m2 > 0);
    if (anySlabArea) return anySlabArea.area_m2;
    return estimateFloorArea(floorName);
  }

  for (const floorName of sortedFloors) {
    const isBottom = floorName === bottomFloor;
    const isTop = floorName === topFloor;

    const hasPiso = deduplicatedSlabs.some(s => s.nivel === floorName && s.classe === "piso");
    if (!hasPiso) {
      const area = estimateFloorArea(floorName) || getBestArea(floorName);
      if (area > 0) {
        deduplicatedSlabs.push({
          id: `L_auto`,
          nivel: floorName,
          classe: "piso",
          area_m2: area,
          measurement_source: "inferred_from_perimeter",
          confidence: 0.5,
        });
        console.log(`[FUSAO] Auto-gerada laje piso para ${floorName}: ${area} m²`);
      }
    }

    const existingRadier = deduplicatedSlabs.find(s => s.nivel === floorName && s.classe === "radier");
    if (existingRadier) {
      const hasSeparatePiso = deduplicatedSlabs.some(s => s.nivel === floorName && s.classe === "piso");
      if (!hasSeparatePiso) {
        deduplicatedSlabs.push({
          id: `L_auto`,
          nivel: floorName,
          classe: "piso",
          area_m2: existingRadier.area_m2,
          measurement_source: "inferred_from_radier",
          confidence: 0.5,
        });
        console.log(`[FUSAO] Auto-gerada laje piso a partir do radier para ${floorName}: ${existingRadier.area_m2} m²`);
      }
    }

    if (isBottom) {
      const hasRadier = deduplicatedSlabs.some(s => s.nivel === floorName && s.classe === "radier");
      if (!hasRadier) {
        const area = getBestArea(floorName);
        if (area > 0) {
          deduplicatedSlabs.push({
            id: `L_auto`,
            nivel: floorName,
            classe: "radier",
            area_m2: area,
            measurement_source: "inferred_radier",
            confidence: 0.5,
          });
          console.log(`[FUSAO] Auto-gerada laje radier para ${floorName}: ${area} m²`);
        }
      }
    }

    if (isTop) {
      const hasCoberta = deduplicatedSlabs.some(s => s.nivel === floorName && s.classe === "coberta");
      if (!hasCoberta) {
        const aiDetectedAnyCoberta = allSlabs.some(s => s.classe === "coberta");
        // Espelhamento de piso: residencias com laje plana frequentemente nao
        // tem a coberta marcada explicitamente na planta. Se HA piso detectado
        // no pavimento superior e confianca razoavel, espelhamos area do piso
        // como coberta. Continua sendo "auto", o usuario pode editar/desligar.
        const topPiso = deduplicatedSlabs.find(s => s.nivel === floorName && (s.classe === "piso" || s.classe === "radier"));
        if (aiDetectedAnyCoberta) {
          const area = getBestArea(floorName);
          if (area > 0) {
            deduplicatedSlabs.push({
              id: `L_auto`,
              nivel: floorName,
              classe: "coberta",
              area_m2: area,
              measurement_source: "inferred_coberta",
              confidence: 0.5,
            });
            console.log(`[FUSAO] Auto-gerada laje coberta para ${floorName}: ${area} m²`);
          }
        } else if (topPiso && topPiso.area_m2 > 0 && topPiso.area_m2 <= SANE_FLOOR_AREA_MAX_M2) {
          deduplicatedSlabs.push({
            id: `L_auto`,
            nivel: floorName,
            classe: "coberta",
            area_m2: topPiso.area_m2,
            measurement_source: "inferred_coberta_from_piso",
            confidence: 0.4,
          });
          console.log(`[FUSAO] Auto-gerada laje coberta para ${floorName} espelhando o piso: ${topPiso.area_m2} m² (IA nao detectou coberta; assumindo laje plana)`);
        } else {
          console.log(`[FUSAO] Nao auto-gerando laje coberta para ${floorName}: IA nao detectou e sem piso para espelhar (possivel telhado em telha)`);
        }
      }
    }
  }

  if (!deduplicatedSlabs.some(s => s.classe === "radier")) {
    const area = getBestArea(bottomFloor || "Terreo");
    if (area > 0) {
      deduplicatedSlabs.push({
        id: `L_auto`,
        nivel: bottomFloor || "Terreo",
        classe: "radier",
        area_m2: area,
        measurement_source: "inferred_guaranteed",
        confidence: 0.5,
      });
      console.log(`[FUSAO] Garantia: auto-gerada laje radier: ${area} m²`);
    }
  }
  const aiDetectedAnyCobertaGlobal = allSlabs.some(s => s.classe === "coberta");
  if (!deduplicatedSlabs.some(s => s.classe === "coberta") && aiDetectedAnyCobertaGlobal) {
    const area = getBestArea(topFloor || bottomFloor || "Terreo");
    if (area > 0) {
      deduplicatedSlabs.push({
        id: `L_auto`,
        nivel: topFloor || bottomFloor || "Terreo",
        classe: "coberta",
        area_m2: area,
        measurement_source: "inferred_guaranteed",
        confidence: 0.5,
      });
      console.log(`[FUSAO] Garantia: auto-gerada laje coberta: ${area} m²`);
    }
  } else if (!aiDetectedAnyCobertaGlobal) {
    console.log(`[FUSAO] Nao gerando laje coberta garantida: IA nao detectou nenhuma laje coberta em nenhuma pagina (possivel telhado em telha)`);
  }

  deduplicatedSlabs.forEach((s, i) => { s.id = `L${i + 1}`; });

  // ===== AUDITORIA DE PERIMETRO (cross-validation entre fontes) =====
  // Para cada nivel, comparar o perimetro externo somado das fontes disponiveis
  // (vetor PDF, IA Gemini/OpenAI, tabela). Discrepancias >50% indicam que uma
  // das fontes esta inflada (provavel duplicacao) ou subdimensionada (escala
  // errada). Marcamos needs_review nas paredes mais distantes da mediana e
  // logamos o resumo para diagnostico.
  try {
    const perByNivelBySource = new Map<string, Map<string, number>>();
    for (const w of deduplicatedWalls) {
      if (w.classe !== "externa") continue;
      const src = w.measurement_source?.startsWith("pdf_vector") ? "vector"
        : w.measurement_source?.startsWith("table") ? "table"
        : w.measurement_source === "ai_vision_takeoff" ? "openai"
        : "ai";
      const niv = perByNivelBySource.get(w.nivel) || new Map<string, number>();
      niv.set(src, (niv.get(src) || 0) + (w.comprimento_m || 0));
      perByNivelBySource.set(w.nivel, niv);
    }
    for (const [nivel, perBySrc] of perByNivelBySource) {
      const entries = Array.from(perBySrc.entries()).filter(([, v]) => v > 0);
      if (entries.length < 2) continue;
      const values = entries.map(([, v]) => v).sort((a, b) => a - b);
      const median = values[Math.floor(values.length / 2)];
      const maxDev = entries.reduce((acc, [src, v]) => {
        const dev = Math.abs(v - median) / median;
        return dev > acc.dev ? { src, v, dev } : acc;
      }, { src: "", v: 0, dev: 0 });
      console.log(`[FUSAO] Auditoria perimetro externo ${nivel}: ${entries.map(([s, v]) => `${s}=${v.toFixed(1)}m`).join(", ")} (mediana ${median.toFixed(1)}m)`);
      // Politica de arbitragem deterministica:
      //  - Se houver fonte "vector" (vetor PDF com escala cota-confirmada) ou
      //    "table" (quadro de areas), elas sao a referencia de verdade. Demais
      //    fontes que divergirem >50% da referencia ganham needs_review.
      //  - Senao, usa-se a mediana entre as fontes presentes como referencia.
      const truthSrc = entries.find(([s]) => s === "vector")?.[0]
        || entries.find(([s]) => s === "table")?.[0]
        || null;
      const referenceValue = truthSrc
        ? entries.find(([s]) => s === truthSrc)![1]
        : median;
      const referenceLabel = truthSrc || "mediana";
      // Marca TODAS as fontes (nao so a mais distante) que excederem o limiar.
      for (const [src, v] of entries) {
        if (src === truthSrc) continue;
        const dev = Math.abs(v - referenceValue) / referenceValue;
        if (dev <= 0.5) continue;
        console.warn(`[FUSAO] Perimetro discrepante em ${nivel}: fonte ${src} = ${v.toFixed(1)}m vs ${referenceLabel} ${referenceValue.toFixed(1)}m (${(dev * 100).toFixed(0)}% desvio) — marcando paredes para revisao`);
        const flagSrcPrefix = src === "vector" ? "pdf_vector" : src === "table" ? "table" : src === "openai" ? "ai_vision_takeoff" : "";
        for (const w of deduplicatedWalls) {
          if (w.nivel !== nivel || w.classe !== "externa") continue;
          const isFlaggedSource = flagSrcPrefix
            ? w.measurement_source?.startsWith(flagSrcPrefix)
            : (!w.measurement_source?.startsWith("pdf_vector") && !w.measurement_source?.startsWith("table") && w.measurement_source !== "ai_vision_takeoff");
          if (!isFlaggedSource) continue;
          if (w.needs_review) continue;
          w.needs_review = true;
          w.review_reason = `Perimetro externo da fonte ${src} diverge da referencia ${referenceLabel} (${(dev * 100).toFixed(0)}% desvio em ${nivel})`;
          w.confidence = Math.min(w.confidence, 0.55);
        }
      }
    }
  } catch (auditErr: any) {
    console.warn(`[FUSAO] Auditoria de perimetro falhou: ${auditErr?.message || auditErr}`);
  }

  return { walls: deduplicatedWalls, slabs: deduplicatedSlabs, corners: allCorners };
}

function calculateWallPanels(wall: ExtractedWall): WallItem {
  const area_bruta = wall.comprimento_m * wall.altura_m;
  const area_esquadrias = wall.opening_area_m2 || 0;
  const area_liquida = Math.max(0, area_bruta - area_esquadrias);
  const proporcao_esq = area_bruta > 0 ? area_esquadrias / area_bruta : 0;
  const coef_perda = proporcao_esq <= 0.20 ? 0.05 : 0.08;
  const qtd_paineis = area_liquida > 0 ? Math.ceil((area_liquida / AREA_PAINEL_M2) * (1 + coef_perda)) : 0;

  return {
    id: wall.id,
    nivel: wall.nivel,
    classe: wall.classe,
    comprimento_m: wall.comprimento_m,
    altura_m: wall.altura_m,
    espessura_m: wall.espessura_m,
    measurement_source: wall.measurement_source,
    confidence: wall.confidence,
    opening_area_m2: area_esquadrias,
    esquadrias: wall.esquadrias || [],
    area_bruta_m2: Math.round(area_bruta * 100) / 100,
    area_liquida_m2: Math.round(area_liquida * 100) / 100,
    quantidade_paineis: qtd_paineis,
    needs_review: wall.needs_review,
    review_reason: wall.review_reason,
  };
}

function calculateSlabPanels(slab: ExtractedSlab): SlabItem {
  const isRadier = slab.classe === "radier";
  const qtd = isRadier ? 0 : Math.ceil((slab.area_m2 / AREA_PAINEL_M2) * (1 + PERDA_LAJE));

  return {
    id: slab.id,
    nivel: slab.nivel,
    classe: slab.classe,
    area_m2: slab.area_m2,
    quantidade_paineis: qtd,
    is_radier: isRadier,
    observacao: isRadier ? "Radier excluido do calculo (piso terreo)" : undefined,
    measurement_source: slab.measurement_source,
    confidence: slab.confidence,
  };
}

export function calculateBudget(
  walls: ExtractedWall[],
  slabs: ExtractedSlab[],
  corners: ExtractedCorner[],
): BudgetResult {
  const floors = new Set<string>();
  walls.forEach(w => floors.add(w.nivel));
  slabs.forEach(s => floors.add(s.nivel));

  const pavimentos: FloorGroup[] = [];

  for (const floorName of floors) {
    const floorWalls = walls.filter(w => w.nivel === floorName);
    const floorSlabs = slabs.filter(s => s.nivel === floorName);
    const floorCorners = corners.filter(c => c.nivel === floorName);

    const extWalls = floorWalls.filter(w => w.classe === "externa").map(calculateWallPanels);
    const intWalls = floorWalls.filter(w => w.classe === "interna").map(calculateWallPanels);
    const muroWalls = floorWalls.filter(w => w.classe === "muro").map(calculateWallPanels);
    const pisoSlabs = floorSlabs.filter(s => s.classe === "piso").map(calculateSlabPanels);
    const radierSlabs = floorSlabs.filter(s => s.classe === "radier").map(calculateSlabPanels);
    const cobertaSlabs = floorSlabs.filter(s => s.classe === "coberta").map(calculateSlabPanels);
    const totalCorners = floorCorners.reduce((sum, c) => sum + c.qtd_cantos, 0);

    const dominantSourceWalls = (items: WallItem[]): string => {
      const counts = new Map<string, number>();
      for (const it of items) {
        const w = it.comprimento_m || 1;
        counts.set(it.measurement_source, (counts.get(it.measurement_source) || 0) + w);
      }
      let best = ""; let bestW = -1;
      for (const [k, w] of counts) { if (w > bestW) { best = k; bestW = w; } }
      return best;
    };
    const dominantSourceSlabs = (items: SlabItem[]): string => {
      const counts = new Map<string, number>();
      for (const it of items) {
        const w = it.area_m2 || 1;
        counts.set(it.measurement_source, (counts.get(it.measurement_source) || 0) + w);
      }
      let best = ""; let bestW = -1;
      for (const [k, w] of counts) { if (w > bestW) { best = k; bestW = w; } }
      return best;
    };
    const reviewCountWalls = (items: WallItem[]) => items.filter(i => i.needs_review).length;

    const extGroup = {
      comprimento_total_m: Math.round(extWalls.reduce((s, w) => s + w.comprimento_m, 0) * 100) / 100,
      area_bruta_m2: Math.round(extWalls.reduce((s, w) => s + w.area_bruta_m2, 0) * 100) / 100,
      area_liquida_m2: Math.round(extWalls.reduce((s, w) => s + w.area_liquida_m2, 0) * 100) / 100,
      quantidade_paineis: extWalls.reduce((s, w) => s + w.quantidade_paineis, 0),
      measurement_source_dominant: dominantSourceWalls(extWalls),
      needs_review_count: reviewCountWalls(extWalls),
      itens: extWalls,
    };

    const intGroup = {
      comprimento_total_m: Math.round(intWalls.reduce((s, w) => s + w.comprimento_m, 0) * 100) / 100,
      area_bruta_m2: Math.round(intWalls.reduce((s, w) => s + w.area_bruta_m2, 0) * 100) / 100,
      area_liquida_m2: Math.round(intWalls.reduce((s, w) => s + w.area_liquida_m2, 0) * 100) / 100,
      quantidade_paineis: intWalls.reduce((s, w) => s + w.quantidade_paineis, 0),
      measurement_source_dominant: dominantSourceWalls(intWalls),
      needs_review_count: reviewCountWalls(intWalls),
      itens: intWalls,
    };

    const muroGroup = {
      comprimento_total_m: Math.round(muroWalls.reduce((s, w) => s + w.comprimento_m, 0) * 100) / 100,
      area_bruta_m2: Math.round(muroWalls.reduce((s, w) => s + w.area_bruta_m2, 0) * 100) / 100,
      quantidade_paineis: muroWalls.reduce((s, w) => s + w.quantidade_paineis, 0),
      measurement_source_dominant: dominantSourceWalls(muroWalls),
      needs_review_count: reviewCountWalls(muroWalls),
      itens: muroWalls,
    };

    const pisoArea = pisoSlabs.reduce((s, l) => s + l.area_m2, 0);
    const pisoPanels = pisoSlabs.reduce((s, l) => s + l.quantidade_paineis, 0);
    const hasRadier = radierSlabs.length > 0;
    const radierArea = radierSlabs.reduce((s, l) => s + l.area_m2, 0);

    const cobertaArea = cobertaSlabs.reduce((s, l) => s + l.area_m2, 0);
    const cobertaPanels = cobertaSlabs.reduce((s, l) => s + l.quantidade_paineis, 0);

    pavimentos.push({
      nome: floorName,
      paredes_externas: extGroup,
      paredes_internas: intGroup,
      muros: muroGroup,
      laje_piso: {
        area_m2: Math.round(pisoArea * 100) / 100,
        quantidade_paineis: pisoPanels,
        is_radier: hasRadier,
        observacao: hasRadier ? `Radier presente (${Math.round(radierArea * 100) / 100} m²) - excluido do calculo de paineis` : "",
        measurement_source_dominant: dominantSourceSlabs(pisoSlabs),
      },
      laje_coberta: {
        area_m2: Math.round(cobertaArea * 100) / 100,
        quantidade_paineis: cobertaPanels,
        measurement_source_dominant: dominantSourceSlabs(cobertaSlabs),
      },
      cantos: { quantidade: totalCorners },
    });
  }

  const totalExtPanels = pavimentos.reduce((s, p) => s + p.paredes_externas.quantidade_paineis, 0);
  const totalIntPanels = pavimentos.reduce((s, p) => s + p.paredes_internas.quantidade_paineis, 0);
  const totalMuroPanels = pavimentos.reduce((s, p) => s + p.muros.quantidade_paineis, 0);
  const totalMuroLength = pavimentos.reduce((s, p) => s + p.muros.comprimento_total_m, 0);
  const totalPisoPanels = pavimentos.reduce((s, p) => s + p.laje_piso.quantidade_paineis, 0);
  const totalCobertaPanels = pavimentos.reduce((s, p) => s + p.laje_coberta.quantidade_paineis, 0);
  const totalPanels = totalExtPanels + totalIntPanels + totalMuroPanels + totalPisoPanels + totalCobertaPanels;

  const inconsistencias = validateResults(walls, slabs, pavimentos);
  const alertas: string[] = [];
  for (const inc of inconsistencias) {
    if (inc.severidade === "Critica") alertas.push(`[CRITICO] ${inc.mensagem}`);
  }

  return {
    pavimentos,
    resumo: {
      paredes_externas: { quantidade_paineis: totalExtPanels, tipo_painel: TIPO_PAINEL },
      paredes_internas: { quantidade_paineis: totalIntPanels, tipo_painel: TIPO_PAINEL },
      muros: { quantidade_paineis: totalMuroPanels, tipo_painel: TIPO_PAINEL, comprimento_total_m: Math.round(totalMuroLength * 100) / 100 },
      laje_piso: { quantidade_paineis: totalPisoPanels, tipo_painel: TIPO_PAINEL },
      laje_coberta: { quantidade_paineis: totalCobertaPanels, tipo_painel: TIPO_PAINEL },
      total_geral_paineis: totalPanels,
    },
    consolidado_por_tipo: [
      { tipo_painel: TIPO_PAINEL, quantidade_total_paineis: totalPanels },
    ],
    alertas,
    inconsistencias,
    aviso: "Este calculo e uma estimativa. A IA pode cometer erros, valide o orcamento junto a equipe tecnica.",
  };
}

function validateResults(
  walls: ExtractedWall[],
  slabs: ExtractedSlab[],
  pavimentos: FloorGroup[],
): Inconsistencia[] {
  const issues: Inconsistencia[] = [];

  if (walls.length === 0) {
    issues.push({ severidade: "Critica", mensagem: "Nenhuma parede foi detectada no projeto" });
  }

  for (const w of walls) {
    if (!w.comprimento_m || w.comprimento_m <= 0) {
      issues.push({ severidade: "Critica", mensagem: `Parede ${w.id}: comprimento invalido ou ausente` });
    }
    if (!w.altura_m || w.altura_m <= 0) {
      issues.push({ severidade: "Critica", mensagem: `Parede ${w.id}: altura invalida ou ausente` });
    }
    if (w.comprimento_m < 0.5 || w.comprimento_m > 50) {
      issues.push({ severidade: "Baixa", mensagem: `Parede ${w.id}: comprimento ${w.comprimento_m}m fora do intervalo usual (0.5-50m)` });
    }
    if (w.altura_m < 1.5 || w.altura_m > 6) {
      issues.push({ severidade: "Baixa", mensagem: `Parede ${w.id}: altura ${w.altura_m}m fora do intervalo usual (1.5-6m)` });
    }
    if (!w.nivel) {
      issues.push({ severidade: "Media", mensagem: `Parede ${w.id}: nivel/pavimento nao especificado` });
    }
  }

  for (const s of slabs) {
    if (!s.area_m2 || s.area_m2 <= 0) {
      issues.push({ severidade: "Critica", mensagem: `Laje ${s.id}: area invalida ou ausente` });
    }
    if (!s.nivel) {
      issues.push({ severidade: "Media", mensagem: `Laje ${s.id}: nivel/pavimento nao especificado` });
    }
  }

  for (const pav of pavimentos) {
    const areaExternas = pav.paredes_externas.area_bruta_m2;
    const areaLaje = pav.laje_piso.area_m2 + pav.laje_coberta.area_m2;
    if (areaExternas > 0 && areaLaje > 0) {
      const ratio = areaLaje / areaExternas;
      if (ratio > 5 || ratio < 0.05) {
        issues.push({ severidade: "Media", mensagem: `Pavimento ${pav.nome}: relacao area laje/parede inconsistente (${ratio.toFixed(2)})` });
      }
    }
  }

  const totalPanels = pavimentos.reduce((s, p) =>
    s + p.paredes_externas.quantidade_paineis + p.paredes_internas.quantidade_paineis +
    p.laje_piso.quantidade_paineis + p.laje_coberta.quantidade_paineis, 0);
  if (totalPanels === 0) {
    issues.push({ severidade: "Critica", mensagem: "Quantidade total de paineis e zero. Verifique os dados do projeto." });
  }

  return issues;
}

export interface QuantitativeResult {
  walls: {
    external: { grossArea: number; openingsArea: number; netArea: number; openingsRatio: number; lossCoefficient: number; areaWithLoss: number; panels2P: number };
    internal: { grossArea: number; openingsArea: number; netArea: number; openingsRatio: number; lossCoefficient: number; areaWithLoss: number; panels2P: number };
  };
  slabs: {
    floor: { totalArea: number; lossCoefficient: number; areaWithLoss: number; panels2P: number };
    roof: { totalArea: number; lossCoefficient: number; areaWithLoss: number; panels2P: number };
  };
  totals: { totalWallArea: number; totalSlabArea: number; totalPanels2P: number; totalPanels: number };
}

export function budgetToLegacy(budget: BudgetResult): QuantitativeResult {
  const extGross = budget.pavimentos.reduce((s, p) => s + p.paredes_externas.area_bruta_m2, 0);
  const extNet = budget.pavimentos.reduce((s, p) => s + p.paredes_externas.area_liquida_m2, 0);
  const extOpenings = extGross - extNet;
  const extPanels = budget.resumo.paredes_externas.quantidade_paineis;
  const intGross = budget.pavimentos.reduce((s, p) => s + p.paredes_internas.area_bruta_m2, 0);
  const intNet = budget.pavimentos.reduce((s, p) => s + p.paredes_internas.area_liquida_m2, 0);
  const intOpenings = intGross - intNet;
  const intPanels = budget.resumo.paredes_internas.quantidade_paineis;
  const floorArea = budget.pavimentos.reduce((s, p) => s + p.laje_piso.area_m2, 0);
  const roofArea = budget.pavimentos.reduce((s, p) => s + p.laje_coberta.area_m2, 0);
  const floorPanels = budget.resumo.laje_piso.quantidade_paineis;
  const roofPanels = budget.resumo.laje_coberta.quantidade_paineis;

  return {
    walls: {
      external: {
        grossArea: extGross, openingsArea: extOpenings, netArea: extNet,
        openingsRatio: extGross > 0 ? extOpenings / extGross : 0,
        lossCoefficient: (extGross > 0 && extOpenings / extGross > 0.2) ? 0.08 : 0.05,
        areaWithLoss: extNet * (1 + ((extGross > 0 && extOpenings / extGross > 0.2) ? 0.08 : 0.05)),
        panels2P: extPanels,
      },
      internal: {
        grossArea: intGross, openingsArea: intOpenings, netArea: intNet,
        openingsRatio: intGross > 0 ? intOpenings / intGross : 0,
        lossCoefficient: (intGross > 0 && intOpenings / intGross > 0.2) ? 0.08 : 0.05,
        areaWithLoss: intNet * (1 + ((intGross > 0 && intOpenings / intGross > 0.2) ? 0.08 : 0.05)),
        panels2P: intPanels,
      },
    },
    slabs: {
      floor: { totalArea: floorArea, lossCoefficient: 0.10, areaWithLoss: floorArea * 1.10, panels2P: floorPanels },
      roof: { totalArea: roofArea, lossCoefficient: 0.10, areaWithLoss: roofArea * 1.10, panels2P: roofPanels },
    },
    totals: {
      totalWallArea: extNet + intNet,
      totalSlabArea: floorArea + roofArea,
      totalPanels2P: budget.resumo.total_geral_paineis,
      totalPanels: budget.resumo.total_geral_paineis,
    },
  };
}

export interface TechnicalAlert {
  level: "critical" | "warning" | "info";
  message: string;
  affectedElements: string[];
}

export function inconsistenciasToAlerts(inc: Inconsistencia[]): TechnicalAlert[] {
  return inc.map(i => ({
    level: i.severidade === "Critica" ? "critical" as const : i.severidade === "Media" ? "warning" as const : "info" as const,
    message: i.mensagem,
    affectedElements: [],
  }));
}
