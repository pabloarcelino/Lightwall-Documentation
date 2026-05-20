/**
 * Event bus de chamadas IA por projeto.
 *
 * Cada chamada audit-ada (auditAiCall) emite "started" no inicio e
 * "completed" ou "failed" ao final. O front consome via SSE em
 * GET /api/projects/:id/ai-events e mostra timeline + custo acumulado.
 *
 * Mantemos isso em memoria — eventos sao efemeros (servem para a tela
 * de processamento ao vivo). A persistencia continua sendo a tabela
 * `ai_runs` via storage.createAiRun.
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

export type AiEvent = AiEventStarted | AiEventCompleted | AiEventFailed;

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

function broadcast(projectId: number, event: AiEvent): void {
  const set = aiClients.get(projectId);
  if (!set || set.size === 0) return;
  const data = `event: ${event.phase}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch { /* cliente desconectou — sera limpo via close */ }
  }
}

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
