export interface AIProviderOptions {
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AIProvider {
  name: string;
  generateContent(
    prompt: string,
    images: Array<{ base64: string; mimeType: string }>,
    options?: AIProviderOptions,
  ): Promise<string>;
}

export class GeminiProvider implements AIProvider {
  name = "gemini-2.5-pro";
  private genAI: any;
  private modelName: string;

  constructor(genAI: any, modelName: string) {
    this.genAI = genAI;
    this.modelName = modelName;
  }

  async generateContent(
    prompt: string,
    images: Array<{ base64: string; mimeType: string }>,
    options?: AIProviderOptions,
  ): Promise<string> {
    const { withRetry } = await import("../gemini/client");
    const parts: any[] = images.map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.base64 },
    }));
    parts.push({ text: prompt });

    return withRetry(async () => {
      const response = await this.genAI.models.generateContent({
        model: this.modelName,
        contents: [{ role: "user", parts }],
        config: {
          temperature: options?.temperature ?? 0.1,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: options?.maxOutputTokens ?? 8192,
        },
      });
      return response.text ?? "";
    }, "GeminiProvider");
  }
}

// Default model when none configured. gpt-5-mini balances quality and cost
// for vision tasks; users can override via /api/settings/openai-model.
export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

export class OpenAIProvider implements AIProvider {
  name: string;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = DEFAULT_OPENAI_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
    this.name = model;
  }

  async generateContent(
    prompt: string,
    images: Array<{ base64: string; mimeType: string }>,
    options?: AIProviderOptions,
  ): Promise<string> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: this.apiKey });

    const content: any[] = images.map((img) => {
      if (img.mimeType === "application/pdf") {
        return {
          type: "file" as const,
          file: {
            filename: "page.pdf",
            file_data: `data:${img.mimeType};base64,${img.base64}`,
          },
        };
      }
      return {
        type: "image_url" as const,
        image_url: {
          url: `data:${img.mimeType};base64,${img.base64}`,
          detail: "high" as const,
        },
      };
    });
    content.push({ type: "text" as const, text: prompt });

    // Reasoning-style models (gpt-5*, o1*, o3*, o4*) use max_completion_tokens
    // and only accept temperature=1 (default). Classic chat models (gpt-4*,
    // gpt-4o*, gpt-3.5*) use max_tokens and arbitrary temperature.
    const isReasoning = /^(gpt-5|o[134])/i.test(this.model);
    const params: any = {
      model: this.model,
      messages: [{ role: "user", content }],
    };
    if (isReasoning) {
      params.max_completion_tokens = options?.maxOutputTokens ?? 8192;
      // Intentionally omit temperature — reasoning models reject anything other than 1.
    } else {
      params.max_tokens = options?.maxOutputTokens ?? 8192;
      params.temperature = options?.temperature ?? 0.1;
    }

    const response = await client.chat.completions.create(params);
    return response.choices[0]?.message?.content ?? "";
  }
}

let geminiUserApiKey: string | null = null;

export function setGeminiApiKey(key: string) {
  geminiUserApiKey = key;
}

export function clearGeminiApiKey() {
  geminiUserApiKey = null;
}

export function getGeminiApiKey(): string | null {
  return geminiUserApiKey || process.env.AI_INTEGRATIONS_GEMINI_API_KEY || null;
}

let openaiApiKey: string | null = null;
let openaiModelName: string = DEFAULT_OPENAI_MODEL;

export function setOpenAIApiKey(key: string) {
  openaiApiKey = key;
  console.log("[OpenAI] Chave de API do usuario configurada");
}

export function clearOpenAIApiKey() {
  openaiApiKey = null;
  console.log("[OpenAI] Chave de API removida");
}

export function getOpenAIApiKey(): string | null {
  return openaiApiKey;
}

export function hasOpenAIKey(): boolean {
  return !!openaiApiKey && openaiApiKey.length > 10;
}

export function setOpenAIModelName(model: string) {
  openaiModelName = model && model.trim() ? model.trim() : DEFAULT_OPENAI_MODEL;
  console.log(`[OpenAI] Modelo de visao definido para: ${openaiModelName}`);
}

export function getOpenAIModelName(): string {
  return openaiModelName;
}

export function createOpenAIProvider(modelOverride?: string): OpenAIProvider | null {
  if (!openaiApiKey || openaiApiKey.length < 10) return null;
  return new OpenAIProvider(openaiApiKey, modelOverride || openaiModelName);
}

// ===== Active provider context =====
// Per-pipeline preference. When set to "openai", AI calls in planAnalyzer route
// through OpenAIProvider instead of Gemini.
//
// IMPORTANT: We use AsyncLocalStorage so concurrent pipeline runs (e.g. two
// users processing different projects with different modes at the same time)
// do NOT clobber each other's provider selection. Each request runs inside
// `runWithProvider(p, fn)` which scopes the provider to that async context.
// Code outside any context falls back to the module-level default ("gemini").
import { AsyncLocalStorage } from "node:async_hooks";

type ProviderName = "gemini" | "openai";
const providerStorage = new AsyncLocalStorage<ProviderName>();
let defaultProvider: ProviderName = "gemini";

export function runWithProvider<T>(p: ProviderName, fn: () => T): T {
  console.log(`[AI] Iniciando contexto com provedor: ${p}`);
  return providerStorage.run(p, fn);
}

// Kept for backwards compatibility with any caller that still pokes at the
// global default. The pipeline now uses runWithProvider() instead.
export function setActiveProvider(p: ProviderName) {
  defaultProvider = p;
  console.log(`[AI] Provedor padrao definido: ${p}`);
}

export function getActiveProvider(): ProviderName {
  return providerStorage.getStore() ?? defaultProvider;
}
