import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env";

if (!env.AI_INTEGRATIONS_GEMINI_API_KEY) {
  console.warn("AI_INTEGRATIONS_GEMINI_API_KEY not set - falling back to user-configured key (Settings page)");
}

export const genAI = new GoogleGenAI({
  apiKey: env.AI_INTEGRATIONS_GEMINI_API_KEY || "",
  httpOptions: {
    apiVersion: "v1beta",
    baseUrl: env.AI_INTEGRATIONS_GEMINI_BASE_URL || undefined,
  },
});

export const MODEL_NAME = "gemini-2.5-pro";

export const defaultGenerationConfig = {
  temperature: 0.1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 16384,
};

export function createUserGenAI(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "v1beta" },
  });
}

export const USER_MODEL_NAME = "gemini-2.5-pro";

export interface VerificationMetrics {
  verificationModel: string;
  isCrossModel: boolean;
  hadCorrections: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

export interface ApiHealthMetrics {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalRetries: number;
  rateLimitHits: number;
  serverErrors: number;
  jsonParseRetries: number;
  failedPages: Array<{ fileId?: number; fileName?: string; pageIndex: number; reason: string }>;
  verification?: VerificationMetrics;
}

const metricsStore = new Map<number, ApiHealthMetrics>();
let activeProjectId: number | null = null;

export function createFreshMetrics(): ApiHealthMetrics {
  return {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    totalRetries: 0,
    rateLimitHits: 0,
    serverErrors: 0,
    jsonParseRetries: 0,
    failedPages: [],
  };
}

export function resetApiMetrics(projectId: number): void {
  metricsStore.set(projectId, createFreshMetrics());
  activeProjectId = projectId;
}

export function getCurrentMetrics(): ApiHealthMetrics {
  if (activeProjectId !== null) {
    const m = metricsStore.get(activeProjectId);
    if (m) return m;
  }
  const fallback = createFreshMetrics();
  return fallback;
}

export function getApiMetrics(projectId?: number): ApiHealthMetrics {
  const id = projectId ?? activeProjectId;
  if (id !== null) {
    const m = metricsStore.get(id!);
    if (m) return { ...m, failedPages: [...m.failedPages] };
  }
  return createFreshMetrics();
}

export function cleanupApiMetrics(projectId: number): void {
  metricsStore.delete(projectId);
  if (activeProjectId === projectId) activeProjectId = null;
}

export function recordJsonParseRetry(): void {
  getCurrentMetrics().jsonParseRetries++;
}

export function recordFailedPage(info: { fileId?: number; fileName?: string; pageIndex: number; reason: string }): void {
  getCurrentMetrics().failedPages.push(info);
}

export function computeReliabilityScore(metrics: ApiHealthMetrics): {
  score: number;
  level: "high" | "medium" | "low";
  factors: string[];
} {
  let score = 100;
  const factors: string[] = [];

  if (metrics.totalCalls === 0) return { score: 100, level: "high", factors: ["Nenhuma chamada realizada"] };

  const retryRate = metrics.totalRetries / metrics.totalCalls;
  if (retryRate > 0.5) {
    score -= 25;
    factors.push(`Alta taxa de retentativas (${metrics.totalRetries} retries em ${metrics.totalCalls} chamadas)`);
  } else if (retryRate > 0.2) {
    score -= 10;
    factors.push(`Retentativas moderadas (${metrics.totalRetries} retries em ${metrics.totalCalls} chamadas)`);
  }

  if (metrics.rateLimitHits > 0) {
    score -= Math.min(20, metrics.rateLimitHits * 5);
    factors.push(`API sobrecarregada: ${metrics.rateLimitHits} limite(s) de taxa atingido(s)`);
  }

  if (metrics.failedCalls > 0) {
    const failRate = metrics.failedCalls / metrics.totalCalls;
    score -= Math.min(30, Math.round(failRate * 60));
    factors.push(`${metrics.failedCalls} chamada(s) falharam completamente`);
  }

  if (metrics.jsonParseRetries > 0) {
    score -= Math.min(15, metrics.jsonParseRetries * 5);
    factors.push(`${metrics.jsonParseRetries} resposta(s) com JSON malformado necessitaram reprocessamento`);
  }

  if (metrics.failedPages.length > 0) {
    score -= Math.min(20, metrics.failedPages.length * 10);
    factors.push(`${metrics.failedPages.length} pagina(s) nao puderam ser analisadas`);
  }

  score = Math.max(0, score);
  const level = score >= 80 ? "high" : score >= 50 ? "medium" : "low";

  if (factors.length === 0) {
    factors.push("Todas as chamadas foram bem-sucedidas sem problemas");
  }

  return { score, level, factors };
}

const RETRYABLE_CODES = [503, 429, 500, 502, 504];
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1500;
const MAX_DELAY_MS = 12000;
const RATE_LIMIT_DELAY_MS = 15000;

export async function withRetry<T>(fn: () => Promise<T>, label = "Gemini"): Promise<T> {
  let lastError: any;
  const currentMetrics = getCurrentMetrics();
  currentMetrics.totalCalls++;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const result = await fn();
      currentMetrics.successfulCalls++;
      return result;
    } catch (err: any) {
      lastError = err;
      const code = err?.code ?? err?.status ?? err?.httpStatusCode ?? 0;
      const msg = String(err?.message ?? "");
      const isRateLimit = Number(code) === 429 || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");
      const isServerError = [500, 502, 503, 504].includes(Number(code)) || msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("INTERNAL");
      const isRetryable =
        isRateLimit ||
        isServerError ||
        msg.includes("high demand") ||
        msg.includes("overloaded");

      if (isRateLimit) currentMetrics.rateLimitHits++;
      if (isServerError) currentMetrics.serverErrors++;

      if (!isRetryable || attempt === MAX_ATTEMPTS - 1) {
        currentMetrics.failedCalls++;
        throw lastError;
      }

      currentMetrics.totalRetries++;
      const jitter = Math.random() * 1000;
      const baseDelay = isRateLimit
        ? RATE_LIMIT_DELAY_MS
        : Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
      const delay = baseDelay + jitter;
      console.log(`[${label}] Tentativa ${attempt + 1}/${MAX_ATTEMPTS} falhou (${code || msg.slice(0, 60)}). Retry em ${(delay / 1000).toFixed(1)}s...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  currentMetrics.failedCalls++;
  throw lastError;
}
