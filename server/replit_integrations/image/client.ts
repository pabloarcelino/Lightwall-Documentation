import { GoogleGenAI, Modality } from "@google/genai";

// This is using Replit's AI Integrations service, which provides Gemini-compatible API access without requiring your own Gemini API key.
export const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "v1beta",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

/**
 * Generate an image and return as base64 data URL.
 * Uses gemini-2.5-flash-image model via Replit AI Integrations.
 */
export async function generateImage(prompt: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  const candidate = response.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData
  );

  if (!imagePart?.inlineData?.data) {
    throw new Error("No image data in response");
  }

  const mimeType = imagePart.inlineData.mimeType || "image/png";
  return `data:${mimeType};base64,${imagePart.inlineData.data}`;
}

/**
 * Generate an image conditioned on one or more input images plus a text prompt.
 * Returns a data URL with the generated image.
 * Uses direct fetch to avoid SDK routing issues with apiVersion.
 */
export async function editImage(
  prompt: string,
  inputImages: Array<{ data: string; mimeType: string }>,
): Promise<string> {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";

  const parts: Array<any> = [{ text: prompt }];
  for (const img of inputImages) {
    parts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
  }

  const response = await fetch(
    `${baseUrl}/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    // Detect well-known Gemini errors and surface a clean, actionable message.
    if (response.status === 400 && /API_KEY_INVALID|API key not valid/i.test(errText)) {
      throw new Error(
        "Chave Gemini invalida. Configure uma chave valida em Configuracoes (AI_INTEGRATIONS_GEMINI_API_KEY) ou use o modo OpenAI.",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Acesso negado pela API Gemini (chave ausente ou sem permissao). Verifique sua chave em Configuracoes.",
      );
    }
    if (response.status === 429) {
      throw new Error("Limite de uso da API Gemini atingido. Tente novamente em alguns instantes.");
    }
    throw new Error(`Gemini image API error ${response.status}: ${errText.substring(0, 300)}`);
  }

  const json: any = await response.json();
  const candidate = json.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData,
  );

  if (!imagePart?.inlineData?.data) {
    const textPart = candidate?.content?.parts?.find((p: any) => p.text);
    throw new Error(`No image data in response. Text: ${textPart?.text?.substring(0, 200) || "none"}`);
  }

  const mimeType = imagePart.inlineData.mimeType || "image/png";
  return `data:${mimeType};base64,${imagePart.inlineData.data}`;
}

