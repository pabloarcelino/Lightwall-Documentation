import { useCallback, useEffect, useReducer, useRef } from "react";
import { useSseWithRetry } from "@/hooks/useSseWithRetry";

// ============================================================
// Tipos espelhando server/services/audit/aiEvents.ts
// ============================================================

export type Phase = "started" | "completed" | "failed";

export interface TokenUsage {
  input?: number;
  output?: number;
  thinking?: number;
  total?: number;
  cached?: number;
}

export interface AiCallEvent {
  kind?: "ai_call";
  callId: string;
  projectId: number;
  pageId?: number | null;
  promptVersion: string;
  model: string;
  inputSummary: string;
  timestamp: number;
  phase: Phase;
  durationMs?: number;
  usage?: TokenUsage;
  costUsd?: number;
  errorMessage?: string;
}

export interface StageEvent {
  kind: "stage";
  projectId: number;
  stage: string;
  label: string;
  phase: Phase;
  timestamp: number;
  detail?: string;
  errorMessage?: string;
}

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

export interface ImageRenderEvent {
  kind: "image_render";
  projectId: number;
  pavimento: string;
  pageIndex: number;
  phase: Phase;
  timestamp: number;
  imageUrl?: string;
  byteSize?: number;
  errorMessage?: string;
}

export interface CvSubstepEvent {
  kind: "cv_substep";
  projectId: number;
  pavimento?: string;
  substep: string;
  phase: Phase;
  timestamp: number;
  progressPct?: number;
  detail?: string;
  errorMessage?: string;
}

export interface AuditFindingEvent {
  kind: "audit_finding";
  projectId: number;
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  relatedIds?: string[];
  stage?: string;
  timestamp: number;
  phase: "completed";
}

export type PipelineEvent =
  | AiCallEvent
  | StageEvent
  | PdfSplitEvent
  | ImageRenderEvent
  | CvSubstepEvent
  | AuditFindingEvent;

// ============================================================
// State agregado
// ============================================================

export interface StageState {
  stage: string;
  label: string;
  phase: Phase | "pending";
  detail?: string;
  errorMessage?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface AiCallState {
  callId: string;
  projectId: number;
  pageId?: number | null;
  promptVersion: string;
  model: string;
  inputSummary: string;
  timestamp: number;
  status: "running" | "completed" | "failed";
  durationMs?: number;
  usage?: TokenUsage;
  costUsd?: number;
  errorMessage?: string;
}

export interface RenderedImage {
  pavimento: string;
  pageIndex: number;
  imageUrl?: string;
  byteSize?: number;
  status: "rendering" | "ready" | "failed";
  errorMessage?: string;
  timestamp: number;
}

export interface PipelineErrorItem {
  kind: PipelineEvent["kind"] | "ai_call";
  stage?: string;
  message: string;
  when: number;
  meta?: Record<string, unknown>;
}

export interface ProcessingState {
  /** Eventos brutos em ordem cronologica (apos reducer) — pra timeline detalhada. */
  events: PipelineEvent[];
  /** Status agregado por etapa. */
  stages: Map<string, StageState>;
  /** Chamadas IA agregadas (started+completed/failed combinados por callId). */
  aiCalls: AiCallState[];
  /** Imagens renderizadas (started -> rendering, completed -> ready, failed). */
  renderedImages: RenderedImage[];
  /** Audit findings ordenados do mais recente. */
  auditFindings: AuditFindingEvent[];
  /** Erros + falhas em ordem cronologica reversa pra ErrorsPanel. */
  errors: PipelineErrorItem[];
  /** Custo total em USD (soma de ai_call.completed.costUsd). */
  totalCostUsd: number;
  /** Total de tokens (soma de ai_call.completed.usage.total). */
  totalTokens: number;
  /** Quando o primeiro evento foi visto. */
  startedAt: number | null;
  /** Quando o evento "Concluido" ou "Erro" terminal foi visto. */
  finishedAt: number | null;
}

const initialState: ProcessingState = {
  events: [],
  stages: new Map(),
  aiCalls: [],
  renderedImages: [],
  auditFindings: [],
  errors: [],
  totalCostUsd: 0,
  totalTokens: 0,
  startedAt: null,
  finishedAt: null,
};

// ============================================================
// Reducer
// ============================================================

type Action =
  | { type: "reset" }
  | { type: "hydrate"; events: PipelineEvent[] }
  | { type: "event"; event: PipelineEvent };

function eventKind(e: PipelineEvent): PipelineEvent["kind"] | "ai_call" {
  return (e.kind ?? "ai_call") as PipelineEvent["kind"] | "ai_call";
}

function reduceEvent(state: ProcessingState, e: PipelineEvent): ProcessingState {
  // dedupe simples: se ja temos um evento com o mesmo timestamp + kind + key
  // estavel, ignora. Pra ai_call usamos callId; pra outros, combinacao de
  // kind+stage+pageIndex+phase suffices.
  const kind = eventKind(e);
  const startedAt = state.startedAt ?? e.timestamp;
  let finishedAt = state.finishedAt;
  let totalCostUsd = state.totalCostUsd;
  let totalTokens = state.totalTokens;

  // -------- ai_call ----------
  if (kind === "ai_call") {
    const aev = e as AiCallEvent;
    const idx = state.aiCalls.findIndex(c => c.callId === aev.callId);
    let aiCalls = state.aiCalls;
    if (aev.phase === "started") {
      if (idx === -1) {
        aiCalls = [
          ...state.aiCalls,
          {
            callId: aev.callId,
            projectId: aev.projectId,
            pageId: aev.pageId,
            promptVersion: aev.promptVersion,
            model: aev.model,
            inputSummary: aev.inputSummary,
            timestamp: aev.timestamp,
            status: "running",
          },
        ];
      }
    } else {
      const base: AiCallState = idx >= 0
        ? { ...state.aiCalls[idx] }
        : {
            callId: aev.callId,
            projectId: aev.projectId,
            pageId: aev.pageId,
            promptVersion: aev.promptVersion,
            model: aev.model,
            inputSummary: aev.inputSummary,
            timestamp: aev.timestamp,
            status: "running",
          };
      if (aev.phase === "completed") {
        base.status = "completed";
        base.durationMs = aev.durationMs;
        base.usage = aev.usage;
        base.costUsd = aev.costUsd;
        totalCostUsd += aev.costUsd ?? 0;
        totalTokens += aev.usage?.total ?? ((aev.usage?.input ?? 0) + (aev.usage?.output ?? 0) + (aev.usage?.thinking ?? 0));
      } else if (aev.phase === "failed") {
        base.status = "failed";
        base.durationMs = aev.durationMs;
        base.errorMessage = aev.errorMessage;
      }
      if (idx >= 0) {
        aiCalls = state.aiCalls.slice();
        aiCalls[idx] = base;
      } else {
        aiCalls = [...state.aiCalls, base];
      }
    }
    const errors = aev.phase === "failed"
      ? [{ kind: "ai_call" as const, stage: aev.promptVersion, message: aev.errorMessage || "ai_call falhou", when: aev.timestamp, meta: { callId: aev.callId, model: aev.model } }, ...state.errors]
      : state.errors;
    return {
      ...state,
      aiCalls,
      events: [...state.events, e],
      startedAt,
      finishedAt,
      totalCostUsd,
      totalTokens,
      errors,
    };
  }

  // -------- stage ----------
  if (kind === "stage") {
    const sev = e as StageEvent;
    const stages = new Map(state.stages);
    const prev = stages.get(sev.stage);
    stages.set(sev.stage, {
      stage: sev.stage,
      label: sev.label,
      phase: sev.phase,
      detail: sev.detail,
      errorMessage: sev.errorMessage,
      startedAt: prev?.startedAt ?? (sev.phase === "started" || sev.phase === "completed" || sev.phase === "failed" ? sev.timestamp : undefined),
      completedAt: sev.phase === "completed" || sev.phase === "failed" ? sev.timestamp : prev?.completedAt,
    });
    // detectar conclusao do pipeline pela etapa especial "0" ou label Concluido/Erro
    if (sev.stage === "0" && (sev.label === "Concluido" || sev.label === "Erro")) {
      finishedAt = sev.timestamp;
    }
    const errors = sev.phase === "failed"
      ? [{ kind: "stage" as const, stage: sev.stage, message: sev.errorMessage || sev.detail || `Etapa ${sev.stage} (${sev.label}) falhou`, when: sev.timestamp }, ...state.errors]
      : state.errors;
    return { ...state, stages, events: [...state.events, e], startedAt, finishedAt, errors };
  }

  // -------- image_render ----------
  if (kind === "image_render") {
    const iev = e as ImageRenderEvent;
    const key = (img: RenderedImage) => `${img.pavimento}::${img.pageIndex}`;
    const targetKey = `${iev.pavimento}::${iev.pageIndex}`;
    const idx = state.renderedImages.findIndex(img => key(img) === targetKey);
    const next: RenderedImage = {
      pavimento: iev.pavimento,
      pageIndex: iev.pageIndex,
      imageUrl: iev.imageUrl ?? (idx >= 0 ? state.renderedImages[idx].imageUrl : undefined),
      byteSize: iev.byteSize ?? (idx >= 0 ? state.renderedImages[idx].byteSize : undefined),
      status: iev.phase === "completed" ? "ready" : iev.phase === "failed" ? "failed" : "rendering",
      errorMessage: iev.errorMessage,
      timestamp: iev.timestamp,
    };
    const renderedImages = idx >= 0
      ? state.renderedImages.map((img, i) => i === idx ? next : img)
      : [...state.renderedImages, next];
    const errors = iev.phase === "failed"
      ? [{ kind: "image_render" as const, stage: "7.5", message: iev.errorMessage || `Falha ao gerar imagem ${iev.pavimento} pg ${iev.pageIndex}`, when: iev.timestamp, meta: { pavimento: iev.pavimento, pageIndex: iev.pageIndex } }, ...state.errors]
      : state.errors;
    return { ...state, renderedImages, events: [...state.events, e], startedAt, finishedAt, errors };
  }

  // -------- audit_finding ----------
  if (kind === "audit_finding") {
    const fev = e as AuditFindingEvent;
    const auditFindings = [fev, ...state.auditFindings];
    const errors = (fev.severity === "warning" || fev.severity === "error")
      ? [{ kind: "audit_finding" as const, stage: fev.stage, message: `[${fev.code}] ${fev.message}`, when: fev.timestamp, meta: { severity: fev.severity, relatedIds: fev.relatedIds } }, ...state.errors]
      : state.errors;
    return { ...state, auditFindings, events: [...state.events, e], startedAt, finishedAt, errors };
  }

  // -------- pdf_split / cv_substep ----------
  // Mantemos apenas em events[] — o renderer (EventTimeline) ja consome direto.
  // cv_substep com phase=failed entra em errors.
  if (kind === "cv_substep") {
    const cev = e as CvSubstepEvent;
    const errors = cev.phase === "failed"
      ? [{ kind: "cv_substep" as const, stage: "3.4", message: cev.errorMessage || `Falha no substep CV ${cev.substep}`, when: cev.timestamp }, ...state.errors]
      : state.errors;
    return { ...state, events: [...state.events, e], startedAt, finishedAt, errors };
  }

  return { ...state, events: [...state.events, e], startedAt, finishedAt };
}

function reducer(state: ProcessingState, action: Action): ProcessingState {
  switch (action.type) {
    case "reset":
      return initialState;
    case "hydrate": {
      let s = initialState;
      for (const e of action.events) s = reduceEvent(s, e);
      return s;
    }
    case "event":
      return reduceEvent(state, action.event);
  }
}

// ============================================================
// Hook publico
// ============================================================

export interface UseProcessingEventsOptions {
  projectId: number | string;
  /** Quando false, fecha SSE e nao hidrata. Default true. */
  enabled?: boolean;
  /** Callback quando o stream desistir apos exaurir retries (toast com botao reconectar). */
  onSseExhausted?: () => void;
}

export interface UseProcessingEventsReturn {
  state: ProcessingState;
  connected: boolean;
  exhausted: boolean;
  reconnect: () => void;
  /** Limpa todo o estado — util para reiniciar processamento. */
  reset: () => void;
}

export function useProcessingEvents({
  projectId,
  enabled = true,
  onSseExhausted,
}: UseProcessingEventsOptions): UseProcessingEventsReturn {
  const [state, dispatch] = useReducer(reducer, initialState);
  const hydratedRef = useRef(false);

  // Hidratar do GET /pipeline-events
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    hydratedRef.current = false;
    fetch(`/api/projects/${projectId}/pipeline-events`)
      .then(r => r.ok ? r.json() : [])
      .then((events: unknown) => {
        if (cancelled) return;
        if (Array.isArray(events)) {
          dispatch({ type: "hydrate", events: events as PipelineEvent[] });
        }
        hydratedRef.current = true;
      })
      .catch(() => {
        if (cancelled) return;
        hydratedRef.current = true;
      });
    return () => { cancelled = true; };
  }, [projectId, enabled]);

  // Stream em tempo real
  const handleEvent = useCallback((_eventName: string, payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    dispatch({ type: "event", event: payload as PipelineEvent });
  }, []);

  const sse = useSseWithRetry({
    url: `/api/projects/${projectId}/ai-events`,
    events: ["started", "completed", "failed"],
    onEvent: handleEvent,
    onMaxRetriesExceeded: onSseExhausted,
    enabled,
  });

  const reset = useCallback(() => { dispatch({ type: "reset" }); }, []);

  return {
    state,
    connected: sse.connected,
    exhausted: sse.exhausted,
    reconnect: sse.reconnect,
    reset,
  };
}
