import type { ExtractedWall } from "../gemini/planAnalyzer";
import type { CvFullExtractionResult, CvWall } from "../cv-service/client";
import type { AuditNote } from "./selfCheck";

/**
 * Fase E.6 da metodologia: reconciliacao conservadora CV↔LLM.
 *
 * Politica:
 *   - LLM e SEMPRE source-of-truth do orcamento.
 *   - CV apenas confirma (concordancia → confidence boost) ou alerta
 *     (discordancia → needs_review; paredes so vistas pelo CV → audit_note).
 *   - NUNCA sobrescreve classe/dimensoes do LLM com valores do CV.
 *
 * O matching e GREEDY por pavimento: IoU > 0.4 OU midpoint distance < 50
 * (em coords normalizadas 0-1000). Cada parede CV so casa com UMA parede LLM.
 */

export interface CvReconciliationResult {
  matched: number;
  disagreed: number;
  onlyLlm: number;
  onlyCv: number;
  alertNotes: AuditNote[];
}

// ============================================================
// Geometria auxiliar
// ============================================================

type BBoxNorm = [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000

function endpointsToBbox(p1: [number, number], p2: [number, number], pad = 8): BBoxNorm {
  const xmin = Math.max(0, Math.min(p1[0], p2[0]) - pad);
  const xmax = Math.min(1000, Math.max(p1[0], p2[0]) + pad);
  const ymin = Math.max(0, Math.min(p1[1], p2[1]) - pad);
  const ymax = Math.min(1000, Math.max(p1[1], p2[1]) + pad);
  return [ymin, xmin, ymax, xmax];
}

function llmWallBbox(w: ExtractedWall): BBoxNorm | null {
  if (w.endpoints) {
    return endpointsToBbox(w.endpoints.p1, w.endpoints.p2);
  }
  if (w.bbox && w.bbox.length === 4) {
    return w.bbox as BBoxNorm;
  }
  return null;
}

function cvWallBbox(cv: CvWall): BBoxNorm | null {
  if (cv.endpoints) {
    return endpointsToBbox([cv.endpoints.p1.x, cv.endpoints.p1.y], [cv.endpoints.p2.x, cv.endpoints.p2.y]);
  }
  if (cv.bbox && cv.bbox.length === 4) {
    return cv.bbox as BBoxNorm;
  }
  return null;
}

function bboxArea(b: BBoxNorm): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function bboxIoU(a: BBoxNorm, b: BBoxNorm): number {
  const ymin = Math.max(a[0], b[0]);
  const xmin = Math.max(a[1], b[1]);
  const ymax = Math.min(a[2], b[2]);
  const xmax = Math.min(a[3], b[3]);
  const inter = Math.max(0, ymax - ymin) * Math.max(0, xmax - xmin);
  if (inter <= 0) return 0;
  const union = bboxArea(a) + bboxArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

function bboxCenter(b: BBoxNorm): [number, number] {
  return [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2];
}

function midpointDistance(a: BBoxNorm, b: BBoxNorm): number {
  const ca = bboxCenter(a);
  const cb = bboxCenter(b);
  return Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
}

// ============================================================
// Matching
// ============================================================

const IOU_THRESHOLD = 0.4;
const MIDPOINT_DISTANCE_THRESHOLD = 50; // em coords 0-1000

interface MatchCandidate {
  llmIdx: number;
  cvIdx: number;
  score: number; // IoU; > 0 = candidato valido
  midDist: number;
}

function buildCandidates(llmBboxes: Array<BBoxNorm | null>, cvBboxes: Array<BBoxNorm | null>): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  for (let i = 0; i < llmBboxes.length; i++) {
    const lb = llmBboxes[i];
    if (!lb) continue;
    for (let j = 0; j < cvBboxes.length; j++) {
      const cb = cvBboxes[j];
      if (!cb) continue;
      const iou = bboxIoU(lb, cb);
      const dist = midpointDistance(lb, cb);
      if (iou >= IOU_THRESHOLD || dist < MIDPOINT_DISTANCE_THRESHOLD) {
        candidates.push({ llmIdx: i, cvIdx: j, score: iou, midDist: dist });
      }
    }
  }
  // Ordena pelo melhor score primeiro (IoU desc; em empate, menor midDist).
  candidates.sort((a, b) => (b.score - a.score) || (a.midDist - b.midDist));
  return candidates;
}

interface MatchResult {
  pairs: Array<{ llm: ExtractedWall; cv: CvWall }>;
  onlyLlm: ExtractedWall[];
  onlyCv: CvWall[];
}

function matchByPavimento(llmWalls: ExtractedWall[], cvWalls: CvWall[]): MatchResult {
  const llmBboxes = llmWalls.map(llmWallBbox);
  const cvBboxes = cvWalls.map(cvWallBbox);
  const candidates = buildCandidates(llmBboxes, cvBboxes);

  const usedLlm = new Set<number>();
  const usedCv = new Set<number>();
  const pairs: Array<{ llm: ExtractedWall; cv: CvWall }> = [];

  for (const c of candidates) {
    if (usedLlm.has(c.llmIdx) || usedCv.has(c.cvIdx)) continue;
    pairs.push({ llm: llmWalls[c.llmIdx], cv: cvWalls[c.cvIdx] });
    usedLlm.add(c.llmIdx);
    usedCv.add(c.cvIdx);
  }

  const onlyLlm: ExtractedWall[] = [];
  for (let i = 0; i < llmWalls.length; i++) {
    if (!usedLlm.has(i)) onlyLlm.push(llmWalls[i]);
  }
  const onlyCv: CvWall[] = [];
  for (let j = 0; j < cvWalls.length; j++) {
    if (!usedCv.has(j)) onlyCv.push(cvWalls[j]);
  }
  return { pairs, onlyLlm, onlyCv };
}

// ============================================================
// Aplicacao da politica conservadora
// ============================================================

function ensureContribution(w: ExtractedWall): NonNullable<ExtractedWall["sourceContribution"]> {
  if (!w.sourceContribution) {
    w.sourceContribution = {
      primary: { view: "planta_baixa", pageIndex: w.page_index ?? 0, tileIndex: 0 },
      enrichments: [],
    };
  }
  return w.sourceContribution;
}

function applyMatch(llm: ExtractedWall, cv: CvWall, pavimento: string): "matched" | "disagreed" {
  const contrib = ensureContribution(llm);
  const llmClasse = llm.classe;
  const cvClasse = cv.classe;
  if (llmClasse === cvClasse) {
    // CONCORDANCIA — boost de confidence + enrichment de confirmacao.
    if (typeof llm.confidence === "number") {
      llm.confidence = Math.min(0.99, llm.confidence + 0.1);
    } else {
      llm.confidence = 0.85;
    }
    contrib.enrichments.push({
      view: "cv_match",
      pageIndex: llm.page_index ?? 0,
      contributedField: "confirmation",
      reason: `CV concordou com LLM (classe=${cvClasse}, pavimento=${pavimento})`,
    });
    return "matched";
  }
  // DISCORDANCIA — marca needs_review SEM sobrescrever classe.
  llm.needs_review = true;
  llm.review_reason =
    (llm.review_reason ? llm.review_reason + " | " : "") +
    `LLM classificou ${llmClasse}, CV classificou ${cvClasse}`;
  contrib.enrichments.push({
    view: "cv_disagreement",
    pageIndex: llm.page_index ?? 0,
    contributedField: "classe",
    previousValue: llmClasse,
    newValue: cvClasse,
    reason: `LLM=${llmClasse} vs CV=${cvClasse} no pavimento ${pavimento}`,
  });
  return "disagreed";
}

// ============================================================
// API publica
// ============================================================

export function reconcileCvWithLlm(
  llmWalls: ExtractedWall[],
  cvResults: Array<{ pavimento: string; result: CvFullExtractionResult }>,
): CvReconciliationResult {
  let matched = 0;
  let disagreed = 0;
  let onlyLlmTotal = 0;
  let onlyCvTotal = 0;
  const alertNotes: AuditNote[] = [];

  // Agrupa por pavimento (LLM walls vs CV walls do mesmo pavimento).
  const byPavLlm = new Map<string, ExtractedWall[]>();
  for (const w of llmWalls) {
    const key = (w.nivel || "Terreo").toLowerCase();
    if (!byPavLlm.has(key)) byPavLlm.set(key, []);
    byPavLlm.get(key)!.push(w);
  }

  for (const { pavimento, result } of cvResults) {
    const status: string = result.status;
    if (status !== "ok" && status !== "degraded") continue;
    if (!result.walls || result.walls.length === 0) continue;
    const key = (pavimento || "Terreo").toLowerCase();
    const llmGroup = byPavLlm.get(key) || [];

    const match = matchByPavimento(llmGroup, result.walls);

    // Aplica matches.
    for (const pair of match.pairs) {
      const kind = applyMatch(pair.llm, pair.cv, pavimento);
      if (kind === "matched") matched++;
      else disagreed++;
    }

    onlyLlmTotal += match.onlyLlm.length;
    onlyCvTotal += match.onlyCv.length;

    // Pra cada CV-only, registra audit note (info, nao erro).
    for (const orphan of match.onlyCv) {
      // Computa midpoint normalizado pra mensagem.
      let midText = "";
      if (orphan.endpoints) {
        const mx = (orphan.endpoints.p1.x + orphan.endpoints.p2.x) / 2;
        const my = (orphan.endpoints.p1.y + orphan.endpoints.p2.y) / 2;
        midText = ` (midpoint ~ ${mx.toFixed(0)}, ${my.toFixed(0)})`;
      }
      alertNotes.push({
        severity: "info",
        code: "ONLY_IN_CV",
        message:
          `Pavimento "${pavimento}": CV detectou parede que o LLM nao viu${midText}. ` +
          `Pode ser omissao do LLM — revise visualmente.`,
        context: {
          pavimento,
          cv_id: orphan.id,
          cv_classe: orphan.classe,
          cv_confidence: orphan.confidence,
        },
      });
    }
  }

  console.log(
    `[CV-RECONCILE] matched=${matched} disagreed=${disagreed} ` +
    `only_llm=${onlyLlmTotal} only_cv=${onlyCvTotal} ` +
    `cv_pavimentos=${cvResults.length}`,
  );

  return {
    matched,
    disagreed,
    onlyLlm: onlyLlmTotal,
    onlyCv: onlyCvTotal,
    alertNotes,
  };
}
