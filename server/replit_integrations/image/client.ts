import { GoogleGenAI, Modality } from "@google/genai";
import { getActiveProvider, getOpenAIApiKey, getGeminiApiKey } from "../../services/ai/provider";

export const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "v1beta",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

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

export async function editImage(
  prompt: string,
  inputImages: Array<{ data: string; mimeType: string }>,
): Promise<string> {
  const provider = getActiveProvider();
  const geminiKey = getGeminiApiKey();
  const openaiKey = getOpenAIApiKey();

  if (provider === "openai" && openaiKey) {
    return editImageOpenAI(prompt, inputImages, openaiKey);
  }

  if (geminiKey) {
    return editImageGemini(prompt, inputImages, geminiKey);
  }

  if (openaiKey) {
    console.log("[IMAGE] Gemini indisponivel, usando OpenAI como fallback para edicao de imagem");
    return editImageOpenAI(prompt, inputImages, openaiKey);
  }

  throw new Error(
    "Nenhuma chave de API configurada para edicao de imagem. Configure Gemini ou OpenAI em Configuracoes.",
  );
}

async function editImageGemini(
  prompt: string,
  inputImages: Array<{ data: string; mimeType: string }>,
  apiKey: string,
): Promise<string> {
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

async function pdfBufferToPng(pdfBuffer: Buffer): Promise<Buffer> {
  const fs = await import("fs/promises");
  const os = await import("os");
  const path = await import("path");
  const { execSync } = await import("child_process");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf2png-"));
  const pdfPath = path.join(tmpDir, "input.pdf");
  const outPrefix = path.join(tmpDir, "out");

  try {
    await fs.writeFile(pdfPath, pdfBuffer);
    execSync(
      `pdftoppm -png -r 200 -singlefile "${pdfPath}" "${outPrefix}"`,
      { timeout: 30000 },
    );
    const pngPath = outPrefix + ".png";
    return await fs.readFile(pngPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function editImageOpenAI(
  prompt: string,
  inputImages: Array<{ data: string; mimeType: string }>,
  apiKey: string,
): Promise<string> {
  const imgData = inputImages[0];
  let imageBuffer = Buffer.from(imgData.data, "base64");

  if (imgData.mimeType === "application/pdf") {
    console.log(`[IMAGE-OPENAI] Convertendo PDF para PNG via pdftoppm...`);
    imageBuffer = await pdfBufferToPng(imageBuffer);
  }

  const sharp = (await import("sharp")).default;
  const pngBuffer = await sharp(imageBuffer)
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .png()
    .toBuffer();

  const blob = new Blob([pngBuffer], { type: "image/png" });

  console.log(`[IMAGE-OPENAI] Enviando imagem para edicao (${Math.round(pngBuffer.length / 1024)}KB)...`);

  const models = ["gpt-image-1", "dall-e-2"];
  let lastError: Error | null = null;

  for (const model of models) {
    let effectivePrompt = prompt;
    if (model === "dall-e-2" && prompt.length > 950) {
      effectivePrompt = prompt.substring(0, 900) + "\n\n[Lista de paredes resumida por limite de caracteres]";
    }

    const formData = new FormData();
    formData.append("model", model);
    formData.append("image", blob, "floor_plan.png");
    formData.append("prompt", effectivePrompt);
    formData.append("response_format", "b64_json");
    if (model === "gpt-image-1") {
      formData.append("size", "1536x1024");
    } else {
      formData.append("size", "1024x1024");
    }

    console.log(`[IMAGE-OPENAI] Tentando modelo ${model}...`);

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (response.ok) {
      const json: any = await response.json();
      const b64 = json.data?.[0]?.b64_json;
      if (b64) {
        console.log(`[IMAGE-OPENAI] Imagem gerada com ${model} (${Math.round(b64.length / 1024)}KB base64)`);
        return `data:image/png;base64,${b64}`;
      }
      const url = json.data?.[0]?.url;
      if (url) {
        const imgRes = await fetch(url);
        const imgBuf = Buffer.from(await imgRes.arrayBuffer());
        console.log(`[IMAGE-OPENAI] Imagem baixada de ${model} (${Math.round(imgBuf.length / 1024)}KB)`);
        return `data:image/png;base64,${imgBuf.toString("base64")}`;
      }
      lastError = new Error(`Modelo ${model}: nenhum dado de imagem na resposta`);
      continue;
    }

    const errText = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error("Acesso negado pela API OpenAI. Verifique sua chave em Configuracoes.");
    }
    if (response.status === 429) {
      throw new Error("Limite de uso da API OpenAI atingido. Tente novamente em alguns instantes.");
    }
    if (model !== models[models.length - 1]) {
      console.log(`[IMAGE-OPENAI] Modelo ${model} falhou (${response.status}), tentando proximo...`);
      lastError = new Error(`Modelo ${model} falhou: ${errText.substring(0, 200)}`);
      continue;
    }
    lastError = new Error(`OpenAI image edit error ${response.status} (${model}): ${errText.substring(0, 300)}`);
  }

  throw lastError || new Error("Nenhum modelo OpenAI disponivel para edicao de imagem");
}
