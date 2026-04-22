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

export class OpenAIProvider implements AIProvider {
  name = "gpt-4o";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
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

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content }],
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxOutputTokens ?? 8192,
    });

    return response.choices[0]?.message?.content ?? "";
  }
}

let openaiApiKey: string | null = null;

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

export function createOpenAIProvider(): OpenAIProvider | null {
  if (!openaiApiKey || openaiApiKey.length < 10) return null;
  return new OpenAIProvider(openaiApiKey);
}
