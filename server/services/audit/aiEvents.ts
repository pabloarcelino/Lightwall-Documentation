/**
 * Event bus de chamadas IA + sub-etapas do pipeline por projeto.
 *
 * Eventos sao discriminados por `kind`:
 *  - "ai_call"        : chamadas Gemini/OpenAI (auditAiCall). Retro-compat
 *                       com a forma legada (sem kind explicito tambem aceita).
 *  - "stage"          : marcos de etapas do pipeline (0.5, 1, 1.5, 3, ...).
 *  - "pdf_split"      : conversao de cada pagina de PDF para PNG.
 *  - "image_render"   : geracao de imagens anotadas, uma por pavimento.
 *  - "cv_substep"     : sub-passos do cv-service (preprocess, ocr, etc).
 *  - "audit_finding"  : notas estruturadas do selfCheck/validators.
 *
 * Todos compartilham `projectId`, `phase` e `timestamp`. O front consome via
 * SSE em GET /api/projects/:id/ai-events e renderiza conforme o kind.
 *
 * Eventos vivem em memoria — efemeros pro modo ao-vivo. Persistencia
 * opcional via `storage.createPipelineEvent` (PR2-2), feita assincronamente
 * a partir do broadcast pra nao bloquear emissores.
 */

import type { Response } from "express";

export interface AiTokenUsage {
  input?: number;
  output?: number;
  thinking?: number;
  total?: number;
  /** Reservado: tokens lidos de cache (Gemini context cache, OpenAI). */
  cached?: number;
}

type Phase = "started" | "completed" | "failed";

// ============================================================
// Eventos "ai_call" — retro-compat com formato legado
// ============================================================

export interface AiEventBase {
  /** Identificador unico desta chamada (gerado no auditor). */
  callId: string;
  /** Projeto associado. */
  projectId: number;
  /** Pagina (quando aplicavel). */
  pageId?: number | null;
  /** Versao do prompt — "etapa1_classify", "etapa3_extract", "globalValidation", etc. */
  promptVersion: string;
  /** Nome do modelo. Pode vir prefixado: "openai:gpt-4o-mini" ou "gemini-2.5-pro". */
  model: string;
  /** Texto curto que descreve o input (ex.: "Pag 0 do projeto 12"). */
  inputSummary: string;
  /** Epoch ms. */
  timestamp: number;
  /** Discriminator. Opcional pra eventos legados — default "ai_call". */
  kind?: "ai_call";
}

export interface AiEventStarted extends AiEventBase { phase: "started"; }

export interface AiEventCompleted extends AiEventBase {
  phase: "completed";
  durationMs: number;
  usage?: AiTokenUsage;
  /** Custo estimado em USD baseado no modelo + tokens. Pode ser undefined. */
  costUsd?: number;
}

export interface AiEventFailed extends AiEventBase {
  phase: "failed";
  durationMs: number;
  errorMessage: string;
}

// ============================================================
// Eventos "stage" — marcos de etapas do pipeline
// ============================================================

export interface StageEvent {
  kind: "stage";
  projectId: number;
  /** Numero da etapa: "0.5", "1", "1.5", "3", "3.4", "3.5", ... */
  stage: string;
  /** Rotulo amigavel exibido na timeline ("Caracterizacao", "Inventario (endpoints)"). */
  label: string;
  phase: Phase;
  timestamp: number;
  detail?: string;
  errorMessage?: string;
}

// ============================================================
// Eventos "pdf_split" — conversao por pagina
// ============================================================

export interface PdfSplitEvent {
  kind: "pdf_split";
  projectId: number;
  fileId?: number | null;
  fileName?: string;
  pageIndex: number;
  totalPages?: number;
  phase: Phase;
  timestamp: number;
  errorMessage?: string;
}

// ============================================================
// Eventos "image_render" — anotacao por pavimento
// ============================================================

export interface ImageRenderEvent {
  kind: "image_render";
  projectId: number;
  pavimento: string;
  pageIndex: number;
  phase: Phase;
  timestamp: number;
  /** Quando completed e disponivel, URL ou data URL pra preview. */
  imageUrl?: string;
  /** Tamanho da imagem renderizada (bytes), quando aplicavel. */
  byteSize?: number;
  errorMessage?: string;
}

// ============================================================
// Eventos "cv_substep" — sub-passos do cv-service Python
// ============================================================

export type CvSubstep =
  | "preprocess"
  | "skeletonize"
  | "ocr"
  | "wall_detect"
  | "envelope"
  | "classify"
  | "other";

export interface CvSubstepEvent {
  kind: "cv_substep";
  projectId: number;
  pavimento?: string;
  substep: CvSubstep;
  phase: Phase;
  timestamp: number;
  /** Progresso 0..100 quando o CV reportar (opcional). */
  progressPct?: number;
  detail?: string;
  errorMessage?: string;
}

// ============================================================
// Eventos "audit_finding" — notas estruturadas
// ============================================================

export interface AuditFindingEvent {
  kind: "audit_finding";
  projectId: number;
  severity: "info" | "warning" | "error";
  /** Codigo estavel — "OPENING_OVER_WALL", "PE_DIREITO_ALTO", etc. */
  code: string;
  message: string;
  /** IDs de elementos relacionados (paredes, lajes) — opcional. */
  relatedIds?: string[];
  /** Etapa que gerou a nota (opcional). */
  stage?: string;
  timestamp: number;
  /** Phase fixa em "completed" — auditoria nao tem started/failed; mantido por uniformidade. */
  phase: "completed";
}

export type AiEvent =
  | AiEventStarted
  | AiEventCompleted
  | AiEventFailed
  | StageEvent
  | PdfSplitEvent
  | ImageRenderEvent
  | CvSubstepEvent
  | AuditFindingEvent;

const aiClients = new Map<number, Set<Response>>();

/** Adiciona um cliente SSE ao projeto. Retorna funcao de remocao. */
export function addAiEventClient(projectId: number, res: Response): () => void {
  let set = aiClients.get(projectId);
  if (!set) { set = new Set(); aiClients.set(projectId, set); }
  set.add(res);
  return () => {
    const s = aiClients.get(projectId);
    if (!s) return;
    s.delete(res);
    if (s.size === 0) aiClients.delete(projectId);
  };
}

/**
 * Hook opcional de persistencia. Quando definido (via setEventPersister em
 * PR2-2 storage.ts), cada evento broadcastado tambem e gravado em
 * `pipeline_events`. Mantemos como hook pra evitar dependencia circular do
 * aiEvents.ts importar storage.ts.
 */
type EventPersister = (event: AiEvent) => void;
let eventPersister: EventPersister | null = null;

export function setEventPersister(fn: EventPersister | null): void {
  eventPersister = fn;
}

function broadcast(projectId: number, event: AiEvent): void {
  // Persistencia best-effort: nunca bloqueia ou propaga erro pro emissor.
  if (eventPersister) {
    try { eventPersister(event); } catch (e) { /* swallow */ }
  }
  const set = aiClients.get(projectId);
  if (!set || set.size === 0) return;
  const data = `event: ${event.phase}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch { /* cliente desconectou — sera limpo via close */ }
  }
}

// ============================================================
// Emitters "ai_call"
// ============================================================

export function emitStarted(payload: Omit<AiEventStarted, "phase" | "timestamp">): void {
  broadcast(payload.projectId, { ...payload, phase: "started", timestamp: Date.now() });
}

export function emitCompleted(payload: Omit<AiEventCompleted, "phase" | "timestamp">): void {
  broadcast(payload.projectId, { ...payload, phase: "completed", timestamp: Date.now() });
}

export function emitFailed(payload: Omit<AiEventFailed, "phase" | "timestamp">): void {
  broadcast(payload.projectId, { ...payload, phase: "failed", timestamp: Date.now() });
}

// ============================================================
// Emitters "stage" / "pdf_split" / "image_render" / "cv_substep" / "audit_finding"
// ============================================================

export function emitStage(payload: Omit<StageEvent, "kind" | "timestamp">): void {
  broadcast(payload.projectId, { kind: "stage", ...payload, timestamp: Date.now() });
}

export function emitPdfSplit(payload: Omit<PdfSplitEvent, "kind" | "timestamp">): void {
  broadcast(payload.projectId, { kind: "pdf_split", ...payload, timestamp: Date.now() });
}

export function emitImageRender(payload: Omit<ImageRenderEvent, "kind" | "timestamp">): void {
  broadcast(payload.projectId, { kind: "image_render", ...payload, timestamp: Date.now() });
}

export function emitCvSubstep(payload: Omit<CvSubstepEvent, "kind" | "timestamp">): void {
  broadcast(payload.projectId, { kind: "cv_substep", ...payload, timestamp: Date.now() });
}

export function emitAuditFinding(
  payload: Omit<AuditFindingEvent, "kind" | "phase" | "timestamp">,
): void {
  broadcast(payload.projectId, {
    kind: "audit_finding",
    ...payload,
    phase: "completed",
    timestamp: Date.now(),
  });
}

// ============================================================
// Pricing — USD por 1 milhao de tokens
// ============================================================

interface ModelPricing {
  /** $/M tokens de input. */
  input: number;
  /** $/M tokens de output. */
  output: number;
  /** $/M tokens "thinking" — quando aplicavel (Gemini cobra como output). */
  thinking?: number;
}

/**
 * Tabela de preco aproximada. Atualizada periodicamente.
 * Quando o modelo nao for reconhecido, retornamos undefined e a UI mostra "—".
 */
const PRICING: Record<string, ModelPricing> = {
  // Gemini 2.5
  "gemini-2.5-pro":    { input: 1.25, output: 5.00, thinking: 5.00 },
  "gemini-2.5-flash":  { input: 0.075, output: 0.30, thinking: 3.50 },
  "gemini-2.5-flash-lite": { input: 0.075, output: 0.30 },
  // Gemini 2.0 (legado)
  "gemini-2.0-flash":     { input: 0.10, output: 0.40 },
  "gemini-2.0-flash-exp": { input: 0.10, output: 0.40 },

  // OpenAI gpt-4o family (USD por 1M tokens, 2026 ref)
  "gpt-4o":        { input: 2.50, output: 10.00 },
  "gpt-4o-mini":   { input: 0.15, output: 0.60 },
  "gpt-4.1":       { input: 2.00, output: 8.00 },
  "gpt-4.1-mini":  { input: 0.40, output: 1.60 },
  "gpt-4.1-nano":  { input: 0.10, output: 0.40 },
  "o4-mini":       { input: 1.10, output: 4.40 },
};

/** Remove prefixo de provider ("openai:gpt-4o" → "gpt-4o"). */
function normalizeModel(model: string): string {
  const colon = model.indexOf(":");
  return colon >= 0 ? model.slice(colon + 1) : model;
}

export function getPricing(model: string): ModelPricing | undefined {
  const key = normalizeModel(model);
  if (PRICING[key]) return PRICING[key];
  // Fallback heuristico para variantes datadas (ex: "gpt-4o-2024-08-06")
  for (const k of Object.keys(PRICING)) {
    if (key.startsWith(k)) return PRICING[k];
  }
  return undefined;
}

export function estimateCostUsd(model: string, usage: AiTokenUsage | undefined): number | undefined {
  if (!usage) return undefined;
  const p = getPricing(model);
  if (!p) return undefined;
  const inTok = usage.input ?? 0;
  const outTok = usage.output ?? 0;
  const thinkTok = usage.thinking ?? 0;
  const thinkRate = p.thinking ?? p.output;
  const usd =
    (inTok    * p.input)     / 1_000_000 +
    (outTok   * p.output)    / 1_000_000 +
    (thinkTok * thinkRate)   / 1_000_000;
  return usd;
}
