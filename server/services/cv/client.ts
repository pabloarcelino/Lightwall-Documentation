import type { GeometryResult, ExtractedWall, ExtractedSlab } from "../gemini/planAnalyzer";

const CV_SERVICE_URL = process.env.CV_SERVICE_URL || "http://localhost:8100";

export interface CvAnalyzeRequest {
  image_base64: string;
  mime_type: string;
  pavimento: string;
  building_type: string;
  gemini_api_key?: string;
  page_index: number;
}

export interface CvAnalyzeResponse {
  geometry: GeometryResult;
  annotated_image_base64: string;
  cv_metadata: Record<string, any>;
}

export async function cvAnalyze(request: CvAnalyzeRequest): Promise<CvAnalyzeResponse> {
  const response = await fetch(`${CV_SERVICE_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`CV service error ${response.status}: ${errText.substring(0, 300)}`);
  }
  return response.json() as Promise<CvAnalyzeResponse>;
}

export async function cvAnnotate(request: {
  image_base64: string;
  mime_type: string;
  walls: ExtractedWall[];
  slabs: ExtractedSlab[];
}): Promise<string> {
  const response = await fetch(`${CV_SERVICE_URL}/annotate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`CV annotate error ${response.status}`);
  }
  const data = await response.json() as { annotated_image_base64: string };
  return data.annotated_image_base64;
}

export async function isCvServiceAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${CV_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
