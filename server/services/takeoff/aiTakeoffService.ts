import { storage } from "../../storage";
import { getOpenAIApiKey, getOpenAIModelName, DEFAULT_OPENAI_MODEL } from "../ai/provider";
import {
  PROMPT_TAKEOFF_VERSION,
  TAKEOFF_RESPONSE_JSON_SCHEMA,
  TAKEOFF_SYSTEM_PROMPT,
  buildUserPrompt,
} from "./prompt";
import {
  TakeoffAiResponseSchema,
  type TakeoffAiResponse,
  type TakeoffAiSheet,
} from "@shared/schema";

export interface AnalyzeOptions {
  projectId: number;
  pageId: number | null;
  pageNumber: number;
  pageLabel?: string | null;
  pavimento?: string | null;
  scaleText?: string | null;
  pxPerMeter?: number | null;
  imageBase64: string;
  imageMimeType: string;
  imageWidthPx: number;
  imageHeightPx: number;
  modelOverride?: string;
}

export interface AnalyzeResult {
  data: TakeoffAiResponse;
  sheet: TakeoffAiSheet;
  runId: number;
  durationMs: number;
  tokenUsage: any;
}

/**
 * AiTakeoffService — encapsulates all OpenAI calls for the takeoff pipeline.
 * Uses the OpenAI Responses API with Structured Outputs (strict JSON schema).
 * Persists every run in `ai_runs` for audit and cost-control.
 */
export class AiTakeoffService {
  private model: string;

  constructor(modelOverride?: string) {
    this.model = modelOverride || getOpenAIModelName() || DEFAULT_OPENAI_MODEL;
  }

  /**
   * Run a single page through the model and return the validated structured response
   * for that page (the response always wraps a single sheet for now).
   */
  async analyzeSheetImage(opts: AnalyzeOptions): Promise<AnalyzeResult> {
    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
      throw new Error(
        "Chave OpenAI nao configurada. Configure em Configuracoes antes de usar o modo OpenAI Vision Takeoff.",
      );
    }
    const start = Date.now();
    const userPrompt = buildUserPrompt(opts);

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });

    let parsed: TakeoffAiResponse | null = null;
    let lastError: any = null;
    let tokenUsage: any = null;
    let rawJson: any = null;

    // Up to 2 attempts: first with default structured output, second with the
    // validation error fed back as a "please fix" message.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const messages: any[] = [
          { role: "system", content: TAKEOFF_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              this.buildImagePart(opts.imageBase64, opts.imageMimeType),
              { type: "text", text: attempt === 1 ? userPrompt : `${userPrompt}\n\nA tentativa anterior gerou JSON invalido: ${lastError}. Corrija e retorne JSON estritamente conforme o schema.` },
            ],
          },
        ];

        const response = await client.chat.completions.create({
          model: this.model,
          messages,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "TakeoffResponse",
              strict: true,
              schema: TAKEOFF_RESPONSE_JSON_SCHEMA as any,
            },
          },
          ...(this.isReasoningModel()
            ? { max_completion_tokens: 16384 }
            : { max_tokens: 16384, temperature: 0.1 }),
        });

        tokenUsage = response.usage ?? null;
        const text = response.choices[0]?.message?.content ?? "";
        if (!text) {
          lastError = "Resposta vazia do modelo";
          continue;
        }
        rawJson = JSON.parse(text);
        const validated = TakeoffAiResponseSchema.safeParse(rawJson);
        if (!validated.success) {
          lastError = JSON.stringify(validated.error.flatten()).slice(0, 500);
          continue;
        }
        parsed = validated.data;
        break;
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
    }

    const durationMs = Date.now() - start;

    // Always log the run (success or failure) for audit
    const run = await storage.createAiRun({
      projectId: opts.projectId,
      pageId: opts.pageId,
      promptVersion: PROMPT_TAKEOFF_VERSION,
      model: this.model,
      inputFileId: null,
      inputSummary: `page=${opts.pageNumber} ${opts.imageWidthPx}x${opts.imageHeightPx}`,
      outputJson: rawJson ?? null,
      tokenUsage: tokenUsage ?? null,
      durationMs,
      status: parsed ? "ok" : "error",
      errorMessage: parsed ? null : lastError ?? "Erro desconhecido",
    });

    if (!parsed) {
      throw new Error(`AiTakeoffService falhou: ${lastError ?? "JSON invalido"}`);
    }

    // Find the sheet for this page (model may return more than one if confused — pick first)
    const sheet =
      parsed.sheets.find((s) => Number(s.page_number) === Number(opts.pageNumber)) ||
      parsed.sheets[0];

    if (!sheet) {
      throw new Error("Resposta do modelo nao contem nenhum sheet");
    }

    return { data: parsed, sheet, runId: run.id, durationMs, tokenUsage };
  }

  private buildImagePart(base64: string, mimeType: string): any {
    if (mimeType === "application/pdf") {
      return {
        type: "file",
        file: {
          filename: "page.pdf",
          file_data: `data:${mimeType};base64,${base64}`,
        },
      };
    }
    return {
      type: "image_url",
      image_url: { url: `data:${mimeType};base64,${base64}`, detail: "high" },
    };
  }

  private isReasoningModel(): boolean {
    return /^(gpt-5|o[134])/i.test(this.model);
  }
}
