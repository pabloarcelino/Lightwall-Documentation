import { storage } from "../../storage";
import type { InsertAiRun } from "@shared/schema";

export interface AuditedCallOpts {
  projectId: number;
  pageId?: number | null;
  promptVersion: string;
  model: string;
  inputSummary: string;
  inputFileId?: string | null;
}

const PROMPT_VERSION_DEFAULT = "lightwall_v1";

/**
 * Wrap an async AI call so it is persisted to ai_runs (success or failure).
 * Failures are re-thrown after persistence; the caller's flow is unchanged.
 */
export async function auditAiCall<T>(
  opts: AuditedCallOpts,
  fn: () => Promise<T>,
  serializeOutput?: (out: T) => unknown,
): Promise<T> {
  const start = Date.now();
  try {
    const out = await fn();
    const durationMs = Date.now() - start;
    const payload: InsertAiRun = {
      projectId: opts.projectId,
      pageId: opts.pageId ?? null,
      promptVersion: opts.promptVersion || PROMPT_VERSION_DEFAULT,
      model: opts.model,
      inputFileId: opts.inputFileId ?? null,
      inputSummary: opts.inputSummary,
      outputJson: serializeOutput ? (serializeOutput(out) as any) : null,
      tokenUsage: null,
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
      errorMessage: String(err?.message || err).slice(0, 1000),
    };
    try {
      await storage.createAiRun(payload);
    } catch (persistErr: any) {
      console.warn(`[ai_runs] falha ao persistir audit (error): ${persistErr?.message || persistErr}`);
    }
    throw err;
  }
}
