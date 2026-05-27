/**
 * Cliente HTTP do cv-service (Fase E).
 *
 * Encapsula chamadas ao microsservico Python (FastAPI) com:
 *  - URL configuravel via CV_SERVICE_URL.
 *  - Timeouts generosos (CV pode demorar 5-15s).
 *  - Erro tipado (CvServiceUnavailable) pra Node decidir fallback.
 *  - Detecta status="stub" e nao usa o resultado (Node faz fallback Gemini).
 *
 * Os endpoints retornam status estavel ("ok" | "stub" | "failed").
 * Quando "stub", caller DEVE rodar o pipeline Gemini (Fases A+B+D).
 */

const CV_SERVICE_URL =
  process.env.CV_SERVICE_URL || "http://localhost:8100";

const DEFAULT_TIMEOUT_MS = 30_000;

export class CvServiceUnavailable extends Error {
  constructor(cause: string) {
    super(`cv-service indisponivel: ${cause}`);
    this.name = "CvServiceUnavailable";
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Health
// ============================================================

export interface CvServiceHealth {
  reachable: boolean;
  url: string;
  version?: string;
  latencyMs?: number;
  error?: string;
}

export async function checkCvServiceHealth(): Promise<CvServiceHealth> {
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(`${CV_SERVICE_URL}/health`, {
      method: "GET",
      timeoutMs: 5_000,
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { reachable: false, url: CV_SERVICE_URL, latencyMs, error: `HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => ({}));
    return {
      reachable: true,
      url: CV_SERVICE_URL,
      latencyMs,
      version: body?.version,
    };
  } catch (err: any) {
    return {
      reachable: false,
      url: CV_SERVICE_URL,
      error: err?.message || String(err),
    };
  }
}

// ============================================================
// Tipos compartilhados com o cv-service (refletem Pydantic schemas)
// ============================================================

export interface CvPoint { x: number; y: number; }

export interface CvWall {
  id: string;
  classe: "externa" | "interna" | "muro";
  endpoints?: { p1: CvPoint; p2: CvPoint };
  bbox?: [number, number, number, number];
  thickness_norm: number;
  has_door: boolean;
  has_window: boolean;
  confidence: number;
}

export interface CvSlab {
  id: string;
  classe: "piso" | "coberta" | "radier";
  polygon: CvPoint[];
  area_norm: number;
  confidence: number;
}

export interface CvEnvelope {
  pavimento: string;
  polygon: CvPoint[];
  lot_polygon?: CvPoint[];
  confidence: number;
}

export interface CvRoom {
  label: string;
  type: "interno" | "externo_coberto" | "externo_descoberto" | "indeterminado";
  polygon: CvPoint[];
  confidence: number;
}

export interface CvCota {
  text: string;
  value_m: number;
  x: number;
  y: number;
  orientation: "horizontal" | "vertical" | "unknown";
  confidence: number;
}

export interface CvPageClassification {
  page_index: number;
  classe: string;
  confidence: number;
  pavimentos: Array<{ tileIndex: number; pavimento: string; bbox: [number, number, number, number] }>;
}

export interface CvFullExtractionResult {
  status: "ok" | "stub" | "failed";
  pixels_per_meter?: number;
  walls: CvWall[];
  slabs: CvSlab[];
  envelope?: CvEnvelope;
  rooms: CvRoom[];
  cotas: CvCota[];
  notes: string[];
  inference_ms: number;
}

// ============================================================
// Endpoints wrappers
// ============================================================

/**
 * POST /extraction/classify_pages — recebe PDF base64, retorna classificacao
 * por pagina + multi-tile detection (Fase E.0).
 *
 * Lanca CvServiceUnavailable se servico estiver fora; senao retorna array
 * (pode ser vazio se servico estiver no modo stub).
 */
export async function classifyPagesCV(pdfBase64: string, dpi = 300): Promise<CvPageClassification[]> {
  try {
    const res = await fetchWithTimeout(`${CV_SERVICE_URL}/extraction/classify_pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdf_base64: pdfBase64, dpi }),
      timeoutMs: 60_000,
    });
    if (!res.ok) throw new CvServiceUnavailable(`HTTP ${res.status}`);
    return (await res.json()) as CvPageClassification[];
  } catch (err: any) {
    if (err instanceof CvServiceUnavailable) throw err;
    throw new CvServiceUnavailable(err?.message || String(err));
  }
}

/**
 * POST /extraction/full_extraction — extracao completa de uma planta_baixa.
 *
 * Retorna { status: "stub" } se o cv-service ainda nao implementou (default
 * hoje); caller faz fallback automatico pro pipeline Gemini.
 */
export async function fullExtractionCV(opts: {
  imageBase64: string;
  mimeType: string;
  pavimento?: string;
  envelopeHint?: CvPoint[];
}): Promise<CvFullExtractionResult> {
  try {
    const res = await fetchWithTimeout(`${CV_SERVICE_URL}/extraction/full_extraction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: opts.imageBase64,
        mime_type: opts.mimeType,
        pavimento: opts.pavimento || "Terreo",
        envelope_hint: opts.envelopeHint,
      }),
      timeoutMs: 60_000,
    });
    if (!res.ok) throw new CvServiceUnavailable(`HTTP ${res.status}`);
    return (await res.json()) as CvFullExtractionResult;
  } catch (err: any) {
    if (err instanceof CvServiceUnavailable) throw err;
    throw new CvServiceUnavailable(err?.message || String(err));
  }
}

/**
 * Variante streaming de `fullExtractionCV`. Faz a mesma chamada mas via SSE,
 * permitindo reportar sub-etapas em tempo real ao caller. `onSubstep` e
 * invocado para cada evento "substep" do cv-service. O retorno final e
 * equivalente ao endpoint sincrono.
 *
 * Cai automaticamente no endpoint sincrono se o streaming nao for suportado
 * (cv-service antigo, status 404). Resilencia importante porque deploys do
 * cv-service podem rolar fora de fase com o Node.
 */
export interface CvSubstepProgress {
  substep: string;
  phase: "started" | "completed" | "failed";
  [k: string]: unknown;
}

export async function fullExtractionCVStreamed(
  opts: {
    imageBase64: string;
    mimeType: string;
    pavimento?: string;
    envelopeHint?: CvPoint[];
  },
  onSubstep: (p: CvSubstepProgress) => void,
): Promise<CvFullExtractionResult> {
  // Streaming pode demorar bem mais que /full_extraction sincrono.
  const STREAM_TIMEOUT_MS = 180_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${CV_SERVICE_URL}/extraction/full_extraction/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: opts.imageBase64,
        mime_type: opts.mimeType,
        pavimento: opts.pavimento || "Terreo",
        envelope_hint: opts.envelopeHint,
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === "AbortError") {
      throw new CvServiceUnavailable("streaming timeout");
    }
    throw new CvServiceUnavailable(err?.message || String(err));
  }

  if (res.status === 404) {
    clearTimeout(timer);
    // cv-service nao suporta streaming — cai pro sincrono
    return fullExtractionCV(opts);
  }
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    throw new CvServiceUnavailable(`HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: CvFullExtractionResult | null = null;
  let errorMsg: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames sao separados por \n\n
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        let eventName = "message";
        let dataLine = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event: ")) eventName = line.slice(7).trim();
          else if (line.startsWith("data: ")) dataLine += line.slice(6);
        }
        if (!dataLine) continue;
        let payload: any;
        try { payload = JSON.parse(dataLine); } catch { continue; }

        if (eventName === "substep") {
          try { onSubstep(payload as CvSubstepProgress); } catch { /* swallow */ }
        } else if (eventName === "result") {
          finalResult = payload as CvFullExtractionResult;
        } else if (eventName === "error") {
          errorMsg = payload?.error || "erro desconhecido";
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  if (errorMsg) throw new CvServiceUnavailable(errorMsg);
  if (!finalResult) throw new CvServiceUnavailable("stream encerrou sem result");
  return finalResult;
}

/**
 * Helper: testa se cv-service esta DISPONIVEL e COM IMPLEMENTACAO REAL
 * (nao apenas stub). Usado pelo pipeline para decidir entre Fase E (CV)
 * e fallback Gemini.
 */
export async function cvServiceCapability(): Promise<{ healthy: boolean; ready: boolean; }> {
  const h = await checkCvServiceHealth();
  if (!h.reachable) return { healthy: false, ready: false };
  // Sondamos o full_extraction com payload mock minimo pra ver se retorna stub.
  // (Endpoint stub responde rapido; nao da pra confundir com timeout.)
  try {
    const res = await fullExtractionCV({
      imageBase64: "",
      mimeType: "image/png",
      pavimento: "test",
    });
    return { healthy: true, ready: res.status === "ok" };
  } catch {
    return { healthy: true, ready: false };
  }
}
