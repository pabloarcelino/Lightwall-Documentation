import { AsyncLocalStorage } from "node:async_hooks";
import { storage } from "../../storage";
import type { InsertAiRun } from "@shared/schema";
import {
  emitStarted,
  emitCompleted,
  emitFailed,
  estimateCostUsd,
  type AiTokenUsage,
} from "./aiEvents";

interface AuditCtx { usage?: AiTokenUsage; }
const ctxStore = new AsyncLocalStorage<AuditCtx>();

function mergeUsage(a: AiTokenUsage | undefined, b: AiTokenUsage | undefined): AiTokenUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    input:    sumOpt(a.input,    b.input),
    output:   sumOpt(a.output,   b.output),
    thinking: sumOpt(a.thinking, b.thinking),
    total:    sumOpt(a.total,    b.total),
    cached:   sumOpt(a.cached,   b.cached),
  };
}
function sumOpt(a?: number, b?: number): number | undefined {
  if (a == null && b == null) return undefined;
  return (a ?? 0) + (b ?? 0);
}

/**
 * Chamado pelos wrappers de SDK (Gemini/OpenAI) para reportar tokens da chamada
 * atual. Os tokens sao acumulados no contexto async do auditAiCall que esta
 * envolvendo essa operacao — se nao houver auditor ativo, vira no-op.
 */
export function recordAiUsage(usage: AiTokenUsage | undefined): void {
  if (!usage) return;
  const ctx = ctxStore.getStore();
  if (!ctx) return;
  ctx.usage = mergeUsage(ctx.usage, usage);
}

/** Extrai usage de uma resposta tipica de SDK Gemini. */
export function geminiUsageFromResponse(response: any): AiTokenUsage | undefined {
  const um = response?.usageMetadata ?? response?.usage_metadata;
  if (!um) return undefined;
  const input    = num(um.promptTokenCount     ?? um.prompt_token_count);
  const output   = num(um.candidatesTokenCount ?? um.candidates_token_count);
  const thinking = num(um.thoughtsTokenCount   ?? um.thoughts_token_count);
  const total    = num(um.totalTokenCount      ?? um.total_token_count);
  const cached   = num(um.cachedContentTokenCount ?? um.cached_content_token_count);
  if (!input && !output && !thinking && !total) return undefined;
  return { input, output, thinking, total, cached };
}

/** Extrai usage de uma resposta tipica de SDK OpenAI. */
export function openAiUsageFromResponse(response: any): AiTokenUsage | undefined {
  const u = response?.usage;
  if (!u) return undefined;
  const input  = num(u.prompt_tokens ?? u.input_tokens);
  const output = num(u.completion_tokens ?? u.output_tokens);
  const total  = num(u.total_tokens);
  if (!input && !output && !total) return undefined;
  return { input, output, total };
}

export interface AuditedCallOpts {
  projectId: number;
  pageId?: number | null;
  promptVersion: string;
  model: string;
  inputSummary: string;
  inputFileId?: string | null;
}

const PROMPT_VERSION_DEFAULT = "lightwall_v1";

let callCounter = 0;
function makeCallId(): string {
  callCounter = (callCounter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${callCounter.toString(36)}`;
}

/**
 * Tenta extrair token usage de uma resposta tipica de SDK.
 * Aceita varios formatos:
 *  - Gemini 2.5: `usageMetadata.{promptTokenCount,candidatesTokenCount,thoughtsTokenCount,totalTokenCount}`
 *  - OpenAI:     `usage.{prompt_tokens,completion_tokens,total_tokens}`
 *  - Custom:     `{ input, output, thinking, total }` (passado pelo serializeOutput)
 */
function extractUsageFromAny(out: unknown): AiTokenUsage | undefined {
  if (!out || typeof out !== "object") return undefined;
  const o = out as any;

  // Gemini SDK
  const um = o.usageMetadata ?? o.usage_metadata;
  if (um && typeof um === "object") {
    const input    = num(um.promptTokenCount     ?? um.prompt_token_count);
    const output   = num(um.candidatesTokenCount ?? um.candidates_token_count);
    const thinking = num(um.thoughtsTokenCount   ?? um.thoughts_token_count);
    const total    = num(um.totalTokenCount      ?? um.total_token_count);
    const cached   = num(um.cachedContentTokenCount ?? um.cached_content_token_count);
    if (input || output || thinking || total) {
      return { input, output, thinking, total, cached };
    }
  }

  // OpenAI SDK
  const u = o.usage;
  if (u && typeof u === "object") {
    const input  = num(u.prompt_tokens ?? u.input_tokens);
    const output = num(u.completion_tokens ?? u.output_tokens);
    const total  = num(u.total_tokens);
    if (input || output || total) return { input, output, total };
  }

  // Quando o caller ja informou tokens explicitos via campo dedicado
  if (typeof o.input === "number" || typeof o.output === "number") {
    return {
      input:    num(o.input),
      output:   num(o.output),
      thinking: num(o.thinking),
      total:    num(o.total),
    };
  }

  return undefined;
}

function num(v: any): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

/**
 * Wrap an async AI call so it is persisted to ai_runs (success or failure).
 * Failures are re-thrown after persistence; the caller's flow is unchanged.
 *
 * Tambem emite eventos via `aiEvents` para clientes SSE acompanharem em tempo
 * real: phase "started" no inicio, "completed" ou "failed" ao terminar.
 */
export async function auditAiCall<T>(
  opts: AuditedCallOpts,
  fn: () => Promise<T>,
  serializeOutput?: (out: T) => unknown,
): Promise<T> {
  const callId = makeCallId();
  const start = Date.now();

  emitStarted({
    callId,
    projectId: opts.projectId,
    pageId: opts.pageId ?? null,
    promptVersion: opts.promptVersion || PROMPT_VERSION_DEFAULT,
    model: opts.model,
    inputSummary: opts.inputSummary,
  });

  const ctx: AuditCtx = { usage: undefined };

  try {
    const out = await ctxStore.run(ctx, fn);
    const durationMs = Date.now() - start;

    // Combina tokens reportados pelos wrappers de SDK com qualquer info que o
    // proprio serializeOutput tenha entregue (ex.: chamadas legadas).
    const serialized = serializeOutput ? serializeOutput(out) : undefined;
    const fromOutput = extractUsageFromAny(out);
    const fromSerialized = extractUsageFromAny(serialized);
    const usage =
      mergeUsage(mergeUsage(ctx.usage, fromOutput), fromSerialized) ?? ctx.usage;
    const costUsd = estimateCostUsd(opts.model, usage);

    emitCompleted({
      callId,
      projectId: opts.projectId,
      pageId: opts.pageId ?? null,
      promptVersion: opts.promptVersion || PROMPT_VERSION_DEFAULT,
      model: opts.model,
      inputSummary: opts.inputSummary,
      durationMs,
      usage,
      costUsd,
    });

    const payload: InsertAiRun = {
      projectId: opts.projectId,
      pageId: opts.pageId ?? null,
      promptVersion: opts.promptVersion || PROMPT_VERSION_DEFAULT,
      model: opts.model,
      inputFileId: opts.inputFileId ?? null,
      inputSummary: opts.inputSummary,
      outputJson: (serialized as any) ?? null,
      tokenUsage: (usage as any) ?? null,
      durationMs,
      status: "success",
      errorMessage: null,
    };
    try {
      await storage.createAiRun(payload);
    } catch (persistErr: any) {
      console.warn(`[ai_runs] falha ao persistir audit (success): ${persistErr?.message || persistErr}`);
    }
    return out;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const errorMessage = String(err?.message || err).slice(0, 1000);

    emitFailed({
      callId,
      projectId: opts.projectId,
      pageId: opts.pageId ?? null,
      promptVersion: opts.promptVersion || PROMPT_VERSION_DEFAULT,
      model: opts.model,
      inputSummary: opts.inputSummary,
      durationMs,
      errorMessage,
    });

    const payload: InsertAiRun = {
      projectId: opts.projectId,
      pageId: opts.pageId ?? null,
      promptVersion: opts.promptVersion || PROMPT_VERSION_DEFAULT,
      model: opts.model,
      inputFileId: opts.inputFileId ?? null,
      inputSummary: opts.inputSummary,
      outputJson: null,
      tokenUsage: null,
      durationMs,
      status: "error",
      errorMessage,
    };
    try {
      await storage.createAiRun(payload);
    } catch (persistErr: any) {
      console.warn(`[ai_runs] falha ao persistir audit (error): ${persistErr?.message || persistErr}`);
    }
    throw err;
  }
}
