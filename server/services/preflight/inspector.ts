import fs from "fs/promises";
import path from "path";
import { PDFDocument } from "pdf-lib";

export type RecommendedMode =
  | "ifc"
  | "pdf-vector-first"
  | "pdf-raster-ai"
  | "image-ai";

export interface PreflightResult {
  fileType: "pdf" | "image" | "ifc" | "unknown";
  fileSizeBytes: number;
  pageCount: number;
  isPdfVector: boolean;
  hasEmbeddedText: boolean;
  vectorPathCount: number;
  imageDimensions?: { width: number; height: number } | null;
  recommendedMode: RecommendedMode;
  notes: string[];
}

const VECTOR_PATH_THRESHOLD = 30;
const TEXT_LENGTH_THRESHOLD = 10;

function detectFileType(filePath: string, declared?: string): "pdf" | "image" | "ifc" | "unknown" {
  const ext = path.extname(filePath).toLowerCase();
  if (declared === "ifc" || ext === ".ifc") return "ifc";
  if (declared === "pdf" || ext === ".pdf") return "pdf";
  if (declared === "image" || [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) return "image";
  return "unknown";
}

async function inspectImage(filePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const buf = await fs.readFile(filePath);
    if (buf.length < 24) return null;
    if (buf.slice(0, 8).toString("hex") === "89504e470d0a1a0a") {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      return { width: w, height: h };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let off = 2;
      while (off < buf.length) {
        if (buf[off] !== 0xff) break;
        const marker = buf[off + 1];
        const segLen = buf.readUInt16BE(off + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const h = buf.readUInt16BE(off + 5);
          const w = buf.readUInt16BE(off + 7);
          return { width: w, height: h };
        }
        off += 2 + segLen;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function inspectPdf(filePath: string): Promise<{ pageCount: number; isVector: boolean; hasText: boolean; vectorPathCount: number; notes: string[] }> {
  const notes: string[] = [];
  let pageCount = 0;
  let isVector = false;
  let hasText = false;
  let vectorPathCount = 0;

  try {
    const bytes = await fs.readFile(filePath);
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    pageCount = pdfDoc.getPageCount();
  } catch (e: any) {
    notes.push(`pdf-lib falhou: ${e?.message || e}`);
  }

  // Use pdfjs-dist legacy build for content stream introspection
  try {
    const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const OPS = pdfjsLib.OPS || {};
    const PATH_DRAWING_OPS = new Set<number>([
      OPS.constructPath, OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill,
      OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke,
      OPS.rectangle, OPS.moveTo, OPS.lineTo, OPS.curveTo, OPS.curveTo2, OPS.curveTo3,
    ].filter((v) => typeof v === "number"));
    const data = new Uint8Array(await fs.readFile(filePath));
    const loadingTask = pdfjsLib.getDocument({ data, disableWorker: true, isEvalSupported: false });
    const doc = await loadingTask.promise;
    if (!pageCount) pageCount = doc.numPages;

    const pagesToSample = Math.min(doc.numPages, 3);
    let totalOps = 0;
    for (let i = 1; i <= pagesToSample; i++) {
      const page = await doc.getPage(i);
      const ops = await page.getOperatorList();
      const fns: number[] = ops?.fnArray ?? [];
      totalOps += fns.length;
      for (const fn of fns) if (PATH_DRAWING_OPS.has(fn)) vectorPathCount++;
      const txt = await page.getTextContent();
      const txtItems = (txt?.items ?? []).map((it: any) => it.str ?? "").join("");
      if (txtItems.trim().length >= TEXT_LENGTH_THRESHOLD) hasText = true;
    }

    // Require both: enough path-drawing ops AND that they form a meaningful share of all ops
    const pathRatio = totalOps > 0 ? vectorPathCount / totalOps : 0;
    isVector = vectorPathCount >= VECTOR_PATH_THRESHOLD && pathRatio >= 0.15;
    if (!isVector) notes.push(`PDF parece ser scan (paths=${vectorPathCount}/${totalOps}, ratio=${pathRatio.toFixed(2)})`);
    if (hasText) notes.push("PDF tem texto embutido (pode ter cotas/tabelas legíveis sem OCR)");

    await doc.destroy?.();
  } catch (e: any) {
    notes.push(`pdfjs-dist falhou: ${e?.message || e}`);
  }

  return { pageCount: pageCount || 1, isVector, hasText, vectorPathCount, notes };
}

export async function inspectFile(filePath: string, declaredType?: string): Promise<PreflightResult> {
  const fileType = detectFileType(filePath, declaredType);
  const stat = await fs.stat(filePath);

  const result: PreflightResult = {
    fileType,
    fileSizeBytes: stat.size,
    pageCount: 1,
    isPdfVector: false,
    hasEmbeddedText: false,
    vectorPathCount: 0,
    imageDimensions: null,
    recommendedMode: "image-ai",
    notes: [],
  };

  if (fileType === "ifc") {
    result.recommendedMode = "ifc";
    result.notes.push("IFC: usar parser nativo (top da hierarquia de evidência)");
    return result;
  }

  if (fileType === "image") {
    result.imageDimensions = await inspectImage(filePath);
    result.recommendedMode = "image-ai";
    if (result.imageDimensions) {
      result.notes.push(`Imagem ${result.imageDimensions.width}x${result.imageDimensions.height}`);
    }
    return result;
  }

  if (fileType === "pdf") {
    const info = await inspectPdf(filePath);
    result.pageCount = info.pageCount;
    result.isPdfVector = info.isVector;
    result.hasEmbeddedText = info.hasText;
    result.vectorPathCount = info.vectorPathCount;
    result.notes.push(...info.notes);
    result.recommendedMode = info.isVector ? "pdf-vector-first" : "pdf-raster-ai";
    return result;
  }

  result.notes.push(`Formato desconhecido (ext=${path.extname(filePath)})`);
  return result;
}

export function summarizePreflight(p: PreflightResult): string {
  const parts: string[] = [];
  parts.push(`tipo=${p.fileType}`);
  parts.push(`paginas=${p.pageCount}`);
  if (p.fileType === "pdf") {
    parts.push(`vetorial=${p.isPdfVector ? "sim" : "nao"}`);
    parts.push(`texto=${p.hasEmbeddedText ? "sim" : "nao"}`);
    parts.push(`paths=${p.vectorPathCount}`);
  }
  if (p.imageDimensions) parts.push(`dim=${p.imageDimensions.width}x${p.imageDimensions.height}`);
  parts.push(`modo_recomendado=${p.recommendedMode}`);
  return parts.join(" | ");
}
