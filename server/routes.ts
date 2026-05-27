import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { env } from "./config/env";
import { storage } from "./storage";
import type { InsertExtractedData, InsertWallFeedback } from "@shared/schema";
import { z } from "zod";
import {
  classifyAndExtractTables,
  extractGeometryParallel,
  extractSectionInfo,
  describeProject,
  setUserApiKey,
  clearUserApiKey,
  splitPdfPages,
  clearSplitCache,
  getFilePages,
  type PageClassification,
  type GeometryResult,
  type TableData,
} from "./services/gemini/planAnalyzer";
import {
  resetApiMetrics,
  getApiMetrics,
  cleanupApiMetrics,
  recordFailedPage,
  computeReliabilityScore,
} from "./services/gemini/client";
import {
  setOpenAIApiKey,
  clearOpenAIApiKey,
  hasOpenAIKey,
  setOpenAIModelName,
  getOpenAIModelName,
  runWithProvider,
  DEFAULT_OPENAI_MODEL,
  setGeminiApiKey,
  clearGeminiApiKey,
} from "./services/ai/provider";
import {
  fusionMultiView,
  applySectionData,
  calculateBudget,
  budgetToLegacy,
  inconsistenciasToAlerts,
  applySideHintsOverride,
} from "./services/calculation/engine";
import { validateGeometry, summarizeValidation } from "./services/calculation/geometryValidator";
import { inspectFile, summarizePreflight } from "./services/preflight/inspector";
import { extractFromVectorPdf } from "./services/preflight/pdfVectorExtractor";
import { auditAiCall } from "./services/audit/aiAuditor";
import {
  addAiEventClient,
  setEventPersister,
  emitStage,
  emitImageRender,
  emitPdfSplit,
  emitAuditFinding,
  emitCvSubstep,
  type AiEvent,
} from "./services/audit/aiEvents";
import { resolveProjectFilePath } from "./utils/filePaths";
import { runGlobalCrossValidation } from "./services/gemini/globalValidator";
import type { ExtractedWall, ExtractedSlab, ExtractedCorner } from "./services/gemini/planAnalyzer";
import {
  exportToExcel,
  exportToPDF,
  exportToJSON,
} from "./services/export/exportService";

import type { Response } from "express";
import { requireAuth, requireAdmin } from "./auth";
import bcrypt from "bcryptjs";
// editImage (Gemini/OpenAI image edit) era usado para anotar plantas, mas foi
// substituido por server/services/annotation/renderer.ts (sharp + SVG). O arquivo
// continua exportando a funcao caso seja util em outro fluxo no futuro.
import { renderAnnotatedImage } from "./services/annotation/renderer";
import { extractEnvelopes, type EnvelopePolygon } from "./services/extraction/envelopeExtractor";
import { characterizeProject, type ProjectCharacterization } from "./services/extraction/projectCharacterization";
import { classifyWallsByTopology } from "./services/extraction/topology";
import { inventoryWalls, mergeEndpointsIntoWalls } from "./services/extraction/wallInventory";
import { readCotas, mergeCotasIntoWalls } from "./services/extraction/cotaReader";
import { linkEsquadriasWithTable } from "./services/extraction/esquadriasLinker";
import { derivePisoSlabsFromEnvelopes, mergeSlabPolygons } from "./services/extraction/slabRefiner";
import { runSelfCheck } from "./services/extraction/selfCheck";
import { reconcileCvWithLlm } from "./services/extraction/cvReconciliation";
import {
  checkCvServiceHealth,
  cvServiceCapability,
  fullExtractionCV,
  fullExtractionCVStreamed,
} from "./services/cv-service/client";
import { buildConsolidatedAnnotation, type AnnotatedTile } from "./services/render/consolidatedAnnotation";
import { parseIfcFile } from "./services/ifc/ifcAnalyzer";
import { AiTakeoffService } from "./services/takeoff/aiTakeoffService";

const progressClients = new Map<number, Response[]>();

const PANEL_AREA_M2 = 1.83;

/**
 * Aplica os precos do perfil ao catalogo de produtos.
 * Cria copia dos produtos sobrescrevendo `unitPrice` quando o SKU
 * tem entrada em `profile_prices`. Produtos sem override mantem o
 * preco do catalogo (fallback).
 */
async function applyProfilePrices<T extends { sku: string; unitPrice: string }>(
  products: T[],
  profileId: number | null | undefined,
): Promise<T[]> {
  if (!profileId) return products;
  try {
    const overrides = await storage.getProfilePrices(profileId);
    if (overrides.length === 0) return products;
    const map = new Map(overrides.map(o => [o.sku, o.unitPrice]));
    return products.map(p => map.has(p.sku) ? { ...p, unitPrice: map.get(p.sku)! } : p);
  } catch (e) {
    console.warn("[PROFILE_PRICES] Falha ao aplicar perfil", profileId, e);
    return products;
  }
}

function computeTotaisPorSku(itens: Array<{ discriminacao: string; sku?: string; qtd_un: number; qtd_m2: number; preco_total: number }>) {
  const map = new Map<string, { sku: string; nome: string; qtd_m2: number; preco_total: number }>();
  for (const item of itens) {
    const key = item.discriminacao;
    const existing = map.get(key);
    if (existing) {
      existing.qtd_m2 += item.qtd_m2;
      existing.preco_total += item.preco_total;
    } else {
      map.set(key, { sku: item.sku || "", nome: item.discriminacao, qtd_m2: item.qtd_m2, preco_total: item.preco_total });
    }
  }
  return Array.from(map.values()).map(v => ({
    ...v,
    qtd_m2: Math.round(v.qtd_m2 * 1000) / 1000,
    qtd_un: Math.round(v.qtd_m2 / PANEL_AREA_M2),
    preco_total: Math.round(v.preco_total * 100) / 100,
  }));
}

/**
 * Obtém TODAS as fontes de imagem para anotação (uma por pavimento/planta_baixa).
 * Prioridade: imagem PNG/JPG > páginas planta_baixa do PDF > primeira página do PDF.
 */
async function getAnnotationImageSources(
  files: any[],
  classifications?: PageClassification[],
  projectId?: number,
): Promise<Array<{ pageIndex: number; pavimento: string; base64: string; mimeType: string }>> {
  // 1. Prefer real image files (PNG/JPG/WebP) — single entry, pavimento="all"
  const imageFile = files.find((f: any) => f.fileType === "image" || /\.(png|jpe?g|webp)$/i.test(f.originalName || ""));
  if (imageFile) {
    const imagePath = resolveProjectFilePath(imageFile.filePath);
    if (!imagePath) return [];
    const buf = await fs.readFile(imagePath);
    const ext = path.extname(imageFile.originalName || imageFile.filePath).toLowerCase();
    const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
    return [{ pageIndex: 0, pavimento: "all", base64: buf.toString("base64"), mimeType }];
  }

  // 2. Fall back to PDF — extract ALL planta_baixa pages
  const pdfFile = files.find((f: any) => f.fileType === "pdf" || /\.pdf$/i.test(f.originalName || ""));
  if (!pdfFile) return [];

  const pdfPath = resolveProjectFilePath(pdfFile.filePath);
  if (!pdfPath) return [];
  const pages = await splitPdfPages(pdfPath, {
    projectId,
    fileId: pdfFile.id,
    fileName: pdfFile.originalName,
  });
  if (pages.length === 0) return [];

  // Find all planta_baixa pages with their pavimento
  const plantaPages: Array<{ pageIndex: number; pavimento: string }> = [];
  if (classifications && classifications.length > 0) {
    for (const c of classifications) {
      if (c.classificacao === "planta_baixa") {
        plantaPages.push({ pageIndex: c.page_index, pavimento: c.pavimento || "Terreo" });
      }
    }
  }

  // If no planta_baixa classified, fall back to page 0
  if (plantaPages.length === 0) {
    plantaPages.push({ pageIndex: 0, pavimento: "all" });
  }

  return plantaPages
    .map(pp => {
      const page = pages.find(p => p.pageIndex === pp.pageIndex);
      if (!page) return null;
      return { pageIndex: pp.pageIndex, pavimento: pp.pavimento, base64: page.base64, mimeType: "application/pdf" as const };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// ===== Reference page sources =====
// Extracts NON-planta_baixa pages (cortes, fachadas, planta_cobertura,
// detalhe_construtivo, quadros) so the UI can show them alongside the
// annotated floor plans as "outras vistas" reference images. These pages are
// NOT sent through the AI annotator — they are kept as the original page so
// the user can see them faithfully without distortion.
const REFERENCE_PAGE_TYPES = new Set([
  "planta_cobertura",
  "corte",
  "fachada",
  "vista_3d",
  "detalhe_construtivo",
  "quadro_esquadrias",
  "tabela_quantitativo",
]);

function pageTypeLabel(pageType: string): string {
  switch (pageType) {
    case "planta_cobertura": return "Planta de Cobertura";
    case "corte": return "Corte";
    case "fachada": return "Fachada";
    case "vista_3d": return "Vista 3D";
    case "detalhe_construtivo": return "Detalhe Construtivo";
    case "quadro_esquadrias": return "Quadro de Esquadrias";
    case "tabela_quantitativo": return "Tabela / Quantitativo";
    case "planta_baixa": return "Planta Baixa";
    default: return pageType.replace(/_/g, " ");
  }
}

async function getReferencePageSources(
  files: any[],
  classifications?: PageClassification[],
): Promise<Array<{ pageIndex: number; pageType: string; pavimento?: string; base64: string; mimeType: string }>> {
  if (!classifications || classifications.length === 0) return [];

  const pdfFile = files.find((f: any) => f.fileType === "pdf" || /\.pdf$/i.test(f.originalName || ""));
  if (!pdfFile) return [];

  const refClassifications = classifications.filter(c => REFERENCE_PAGE_TYPES.has(c.classificacao));
  if (refClassifications.length === 0) return [];

  const pdfPath = resolveProjectFilePath(pdfFile.filePath);
  if (!pdfPath) return [];
  const pages = await splitPdfPages(pdfPath);
  if (pages.length === 0) return [];

  return refClassifications
    .map(c => {
      const page = pages.find(p => p.pageIndex === c.page_index);
      if (!page) return null;
      return {
        pageIndex: c.page_index,
        pageType: c.classificacao,
        pavimento: c.pavimento,
        base64: page.base64,
        mimeType: "application/pdf" as const,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/**
 * Assigns sequential, stable W##/M##/L## labels per pavimento.
 * Mutates each item by adding `displayLabel` (does NOT touch internal `id`).
 * Order: walls first by classe (externa→interna), then muros, then slabs.
 * The new labels match the visual style of professional takeoff overlays
 * (W01..Wnn for walls, M01..Mnn for muros, L01..Lnn for slabs).
 */
/**
 * Atribui rotulos de exibicao GLOBAIS no projeto inteiro (W001..Wn / M001..Mn /
 * L001..Ln). A numeracao por pavimento que vigorava antes gerava duplicatas
 * quando a imagem anotada incluia mais de um pavimento — W01 do Terreo e
 * W01 do Superior apareciam juntos com valores diferentes.
 *
 * Ordem de numeracao (deterministica):
 *   1. Pavimento (Terreo → Superior → Subsolo → Coberta → demais alfabetico).
 *   2. Classe (para walls: externa antes de interna).
 *   3. Tamanho descendente (comprimento_m para walls/muros; area_m2 para slabs).
 *
 * Tres digitos por padrao para acomodar projetos grandes sem reformatar
 * (W001..W999); usuarios pequenos veem apenas o prefixo zerado, que e claro
 * e consistente.
 */
function assignDisplayLabels(walls: any[], slabs: any[]): void {
  const pavRank = (pav: string): number => {
    const p = (pav || "Terreo").toLowerCase();
    if (p.includes("terreo") || p.includes("térreo")) return 0;
    if (p.includes("superior") || p.includes("1") || p.includes("primeiro")) return 1;
    if (p.includes("subsolo")) return 2;
    if (p.includes("coberta") || p.includes("cobertura")) return 3;
    return 100; // outros pavimentos vem depois, ordenados alfabeticamente
  };
  const pavCompare = (a: string, b: string): number => {
    const ra = pavRank(a);
    const rb = pavRank(b);
    if (ra !== rb) return ra - rb;
    return (a || "").localeCompare(b || "");
  };

  // ----- Walls (externa + interna) -----
  const wallsNonMuro = walls.filter((w: any) => w.classe !== "muro");
  wallsNonMuro.sort((a: any, b: any) => {
    const pc = pavCompare(a.nivel, b.nivel);
    if (pc !== 0) return pc;
    if (a.classe !== b.classe) return a.classe === "externa" ? -1 : 1;
    return (b.comprimento_m || 0) - (a.comprimento_m || 0);
  });
  wallsNonMuro.forEach((w: any, i: number) => {
    w.displayLabel = `W${String(i + 1).padStart(3, "0")}`;
  });

  // ----- Muros -----
  const muros = walls.filter((w: any) => w.classe === "muro");
  muros.sort((a: any, b: any) => {
    const pc = pavCompare(a.nivel, b.nivel);
    if (pc !== 0) return pc;
    return (b.comprimento_m || 0) - (a.comprimento_m || 0);
  });
  muros.forEach((m: any, i: number) => {
    m.displayLabel = `M${String(i + 1).padStart(3, "0")}`;
  });

  // ----- Slabs -----
  const slabRank = (c: string) => (c === "coberta" ? 0 : c === "piso" ? 1 : 2);
  const slabsCopy = [...slabs];
  slabsCopy.sort((a: any, b: any) => {
    const pc = pavCompare(a.nivel, b.nivel);
    if (pc !== 0) return pc;
    const r = slabRank(a.classe) - slabRank(b.classe);
    if (r !== 0) return r;
    return (b.area_m2 || 0) - (a.area_m2 || 0);
  });
  slabsCopy.forEach((s: any, i: number) => {
    s.displayLabel = `L${String(i + 1).padStart(3, "0")}`;
  });
}

/**
 * @deprecated Substituida por renderAnnotatedImage() em
 * server/services/annotation/renderer.ts. Mantida temporariamente caso seja
 * util resgatar texto/regras de classes/cores, mas nao tem mais chamadores
 * ativos. Pode ser removida em uma proxima limpeza.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildAnnotationPrompt(walls: any[], slabs: any[]): string {
  const enabledWalls = walls.filter((w: any) => w.enabled !== false);
  const externas = enabledWalls.filter((w: any) => w.classe === "externa");
  const internas = enabledWalls.filter((w: any) => w.classe === "interna");
  const murosArr = enabledWalls.filter((w: any) => w.classe === "muro");
  const enabledSlabs = slabs.filter((s: any) => s.enabled !== false);
  const slabPiso = enabledSlabs.filter((s: any) => s.classe === "piso" || s.classe === "radier");
  const slabCoberta = enabledSlabs.filter((s: any) => s.classe === "coberta");

  // Assign W##/M##/L## sequential labels per pavimento (mutates items in place).
  assignDisplayLabels(enabledWalls, enabledSlabs);

  const fmt = (n: number) => Number(n || 0).toFixed(2).replace(".", ",");
  // Include bbox coordinates when available so Gemini paints at the right locations
  const wallLine = (w: any) => {
    const bbox = w.bbox || w.box_2d;
    const bboxStr = bbox ? ` [bbox: y${bbox[0]}-${bbox[2]}, x${bbox[1]}-${bbox[3]}]` : "";
    return `${w.displayLabel || w.id}: ${fmt(w.comprimento_m)} m${bboxStr}`;
  };
  const slabLine = (s: any) => `${s.displayLabel || s.id}: ${fmt(s.area_m2)} m²`;

  const hasBbox = enabledWalls.some((w: any) => w.bbox || w.box_2d);

  return `Pinte marcacoes coloridas sobre esta planta arquitetonica para identificar elementos Lightwall, no estilo de uma prancha de quantitativo profissional.

REGRAS (CRITICAS — siga sem desvio):
- NAO altere o desenho tecnico por baixo. Apenas sobreponha as marcacoes.
- A planta original deve continuar perfeitamente legivel.
${hasBbox ? `- Cada parede inclui coordenadas [bbox: ymin-ymax, xmin-xmax] normalizadas 0-1000. Use estas coordenadas para localizar EXATAMENTE cada parede na imagem.` : ""}
- PAREDES: Desenhe UMA UNICA LINHA COLORIDA GROSSA (8-12px) sobreposta exatamente ao EIXO DA PAREDE, percorrendo o comprimento dela. NAO desenhe contorno de retangulo, NAO desenhe duas linhas paralelas, NAO use fill semi-transparente. Apenas UM TRACO solido por parede. Pense em destacar com um marcador de texto grosso sobre o desenho original.
- LAJES: Para lajes (piso/coberta), use um leve fill colorido semi-transparente (10-15%) sobre toda a area da laje — laje e elemento de area, parede e elemento linear.
- REGRA DE COR POR CLASSIFICACAO: cada parede tem UMA cor obrigatoria conforme sua classe (lista abaixo). NAO use a mesma cor para classes diferentes; se na duvida sobre a classe, use exatamente a cor que esta nesta instrucao para aquela classe especifica.
- REGRA ANTI-SOBREPOSICAO: Se uma parede EXTERNA e uma INTERNA compartilham uma borda, pinte SOMENTE a cor EXTERNA (vermelha). Externas tem precedencia visual.
- TAGS OBRIGATORIAS: Em CADA parede e laje desenhe uma TAG pequena no formato:
    W01
    9,20 m
  (duas linhas: codigo na primeira, comprimento/area na segunda).
  Use fundo branco com borda colorida (cor do elemento) e texto preto, posicionada PERTO do traco sem cobri-lo (acima de paredes horizontais, ao lado de paredes verticais).
- LEGENDA OBRIGATORIA no rodape da imagem (caixa branca com 3 linhas):
    Vermelho = paredes externas
    Verde = paredes internas
    Azul = muros
  Use bolinhas coloridas + texto preto.

CORES POR CLASSE (use EXATAMENTE a cor listada — NAO pinte todas as paredes da mesma cor):
- Paredes EXTERNAS → VERMELHO (#dc2626) — traco unico grosso
- Paredes INTERNAS → VERDE (#16a34a) — traco unico grosso
- MUROS → AZUL (#1d4ed8) — traco unico grosso
- LAJE PISO → VERDE-AGUA (#10b981) — fill 10-15% sobre a area
- LAJE COBERTA → LARANJA (#f97316) — fill 10-15% sobre a area

PAREDES EXTERNAS (${externas.length}):
${externas.map(wallLine).join("\n") || "(nenhuma)"}

PAREDES INTERNAS (${internas.length}):
${internas.map(wallLine).join("\n") || "(nenhuma)"}

MUROS (${murosArr.length}):
${murosArr.map(wallLine).join("\n") || "(nenhum)"}

LAJE DE PISO (${slabPiso.length}):
${slabPiso.map(slabLine).join("\n") || "(nenhuma)"}

LAJE COBERTA (${slabCoberta.length}):
${slabCoberta.map(slabLine).join("\n") || "(nenhuma)"}

Resultado: planta original visivel com paredes contornadas em VERMELHO (externas) / VERDE (internas) / AZUL (muros), tags W01/W02/M01... com comprimento em metros, e legenda de cores no rodape.`;
}

const pipelineStartTimes = new Map<number, number>();

function buildIfcDeterministicDescription(
  fileCount: number,
  budget: any,
  geometry: { wallCount: number; slabCount: number; cornerCount: number; floors: string[] },
  totalCost: number,
): string {
  const pavLines: string[] = [];
  for (const pav of budget.pavimentos || []) {
    const pe = pav.paredes_externas || {};
    const pi = pav.paredes_internas || {};
    const lp = pav.laje_piso || {};
    const lc = pav.laje_coberta || {};
    const totalPaineis = (pe.quantidade_paineis || 0) + (pi.quantidade_paineis || 0) + (lp.quantidade_paineis || 0) + (lc.quantidade_paineis || 0);
    pavLines.push(`- ${pav.nome}: ${totalPaineis} paineis (ext=${pe.comprimento_total_m?.toFixed(1) || 0}m / int=${pi.comprimento_total_m?.toFixed(1) || 0}m / piso=${lp.area_m2?.toFixed(1) || 0}m2 / coberta=${lc.area_m2?.toFixed(1) || 0}m2)`);
  }
  return `## Identificacao do Projeto
- Origem: modelo BIM (IFC) - extracao deterministica sem IA
- Arquivos IFC processados: ${fileCount}
- Numero de pavimentos: ${geometry.floors.length} (${geometry.floors.join(", ") || "-"})

## Quantitativos Identificados
- Paredes: ${geometry.wallCount} elementos extraidos do modelo
- Lajes: ${geometry.slabCount} elementos extraidos do modelo
- Cantos/encontros: ${geometry.cornerCount}

## Distribuicao por Pavimento
${pavLines.join("\n") || "- (sem pavimentos)"}

## Observacoes para Orcamento
- Quantitativos derivados diretamente da geometria do modelo BIM (alta confiabilidade).
- Quando o IFC nao traz Pset/Qto, dimensoes sao inferidas pela bounding box dos solidos.
- Elementos NAO cobertos pelo Lightwall (fundacao, cobertura, acabamentos) devem ser orcados separadamente.

## Resumo dos Dados Extraidos
- Geometria extraida: ${geometry.wallCount} paredes, ${geometry.slabCount} lajes, ${geometry.cornerCount} cantos
- Pavimentos: ${geometry.floors.join(", ") || "-"}
- Orcamento calculado: ${budget.resumo?.total_geral_paineis || 0} paineis, R$ ${totalCost.toFixed(2)}

## Alertas e Ressalvas
- Verifique se todos os pavimentos relevantes foram modelados no IFC.
- Conferir classificacao externa/interna das paredes (Pset_WallCommon.IsExternal).
- Esquadrias muito pequenas ou ausentes no modelo nao reduzem a area das paredes.`;
}

function sendProgress(projectId: number, step: number, label: string, status: "running" | "done" | "error", detail?: string) {
  const clients = progressClients.get(projectId) || [];
  const now = Date.now();
  const startTime = pipelineStartTimes.get(projectId) || now;
  const elapsed = now - startTime;
  const data = JSON.stringify({ step, label, status, detail, timestamp: now, elapsed });
  for (const client of clients) {
    try { client.write(`data: ${data}\n\n`); } catch {}
  }
  // Espelha como evento "stage" no canal SSE unificado pra timeline ao-vivo.
  // Mapeia status -> phase: "running"=started, "done"=completed, "error"=failed.
  const phase = status === "running" ? "started" : status === "done" ? "completed" : "failed";
  emitStage({
    projectId,
    stage: String(step),
    label,
    phase,
    detail: phase !== "failed" ? detail : undefined,
    errorMessage: phase === "failed" ? detail : undefined,
  });
}

const upload = multer({
  dest: "server/uploads/projects/",
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
      "image/bmp",
      "image/tiff",
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".ifc"];

    // IFC: browsers usually send application/octet-stream; accept by extension.
    if (ext === ".ifc") {
      cb(null, true);
      return;
    }
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      const err: any = new Error(
        `Formato não suportado: "${file.originalname}" (${file.mimetype}). Use PDF, PNG, JPG, WEBP, BMP, TIFF ou IFC.`,
      );
      err.status = 400;
      cb(err);
    }
  },
});

const DEFAULT_MAX_WALL_THICKNESS_M = 0.12;

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/auth/")) return next();
    return requireAuth(req, res, next);
  });

  // Registra o persister de eventos: cada broadcast tambem grava em
  // pipeline_events quando for um evento "importante" (stage, audit_finding,
  // image_render, ai_call terminal). pdf_split e cv_substep ficam so em
  // memoria — sao verbosos demais pra valer a pena persistir.
  setEventPersister((event: AiEvent) => {
    const k = event.kind ?? "ai_call";
    if (k === "pdf_split" || k === "cv_substep") return;
    if (k === "ai_call" && event.phase === "started") return; // so persiste terminais
    storage
      .createPipelineEvent({
        projectId: event.projectId,
        kind: k,
        stage: k === "stage" ? (event as any).stage : (event as any).stage ?? null,
        phase: event.phase,
        payload: event as any,
      })
      .catch((err) => console.warn("[PIPELINE_EVENTS] Persist falhou:", err?.message || err));
  });

  // Resolucao de keys: env tem prioridade absoluta. Quando ausente,
  // cai no fallback de chaves persistidas no banco (configuradas via UI).
  // Em producao, recomenda-se sempre usar env vars — backup do BD nao
  // expoe secrets, e a UI fica read-only sinalizando "managed by env".
  const geminiKeyFromEnv = env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (geminiKeyFromEnv) {
    setUserApiKey(geminiKeyFromEnv);
    setGeminiApiKey(geminiKeyFromEnv);
    console.log("[Gemini] Chave carregada via env var (UI bloqueada para escrita)");
  } else {
    const savedGeminiKey = await storage.getSetting("gemini_api_key");
    if (savedGeminiKey && savedGeminiKey.length > 0) {
      setUserApiKey(savedGeminiKey);
      setGeminiApiKey(savedGeminiKey);
    }
  }

  const openaiKeyFromEnv = env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (openaiKeyFromEnv) {
    setOpenAIApiKey(openaiKeyFromEnv);
    console.log("[OpenAI] Chave carregada via env var (UI bloqueada para escrita)");
  } else {
    const savedOpenAIKey = await storage.getSetting("openai_api_key");
    if (savedOpenAIKey && savedOpenAIKey.length > 0) {
      setOpenAIApiKey(savedOpenAIKey);
    }
  }

  const openaiModelFromEnv = env.AI_INTEGRATIONS_OPENAI_MODEL;
  if (openaiModelFromEnv) {
    setOpenAIModelName(openaiModelFromEnv);
  } else {
    const savedOpenAIModel = await storage.getSetting("openai_model");
    if (savedOpenAIModel && savedOpenAIModel.length > 0) {
      setOpenAIModelName(savedOpenAIModel);
    }
  }

  app.get("/api/settings/gemini-key", async (_req, res) => {
    try {
      if (geminiKeyFromEnv) {
        return res.json({
          hasKey: true,
          managedBy: "env",
          maskedKey: `${geminiKeyFromEnv.substring(0, 6)}...${geminiKeyFromEnv.substring(geminiKeyFromEnv.length - 4)}`,
        });
      }
      const apiKey = await storage.getSetting("gemini_api_key");
      res.json({
        hasKey: !!apiKey,
        managedBy: "user",
        maskedKey: apiKey ? `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}` : null,
      });
    } catch (error) {
      console.error("Erro ao buscar configuracao:", error);
      res.status(500).json({ message: "Erro ao buscar configuracao" });
    }
  });

  app.post("/api/settings/gemini-key", async (req, res) => {
    try {
      if (geminiKeyFromEnv) {
        return res.status(403).json({
          message: "Chave Gemini definida via variavel de ambiente (AI_INTEGRATIONS_GEMINI_API_KEY). Edicao bloqueada — altere no deploy.",
        });
      }
      const { apiKey } = req.body;
      if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
        return res.status(400).json({ message: "Chave de API invalida" });
      }
      await storage.setSetting("gemini_api_key", apiKey.trim());
      setUserApiKey(apiKey.trim());
      setGeminiApiKey(apiKey.trim());
      res.json({ success: true, message: "Chave de API salva com sucesso" });
    } catch (error) {
      console.error("Erro ao salvar chave:", error);
      res.status(500).json({ message: "Erro ao salvar chave de API" });
    }
  });

  app.delete("/api/settings/gemini-key", async (_req, res) => {
    try {
      if (geminiKeyFromEnv) {
        return res.status(403).json({
          message: "Chave Gemini definida via variavel de ambiente. Remocao bloqueada — altere no deploy.",
        });
      }
      await storage.setSetting("gemini_api_key", "");
      clearUserApiKey();
      clearGeminiApiKey();
      res.json({ success: true, message: "Chave de API removida" });
    } catch (error) {
      console.error("Erro ao remover chave:", error);
      res.status(500).json({ message: "Erro ao remover chave de API" });
    }
  });

  app.post("/api/settings/test-gemini", async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey) {
        return res.status(400).json({ message: "Chave de API necessaria" });
      }
      const { GoogleGenAI } = await import("@google/genai");
      const { withRetry } = await import("./services/gemini/client");
      const testAI = new GoogleGenAI({ apiKey });
      const text = await withRetry(async () => {
        const response = await testAI.models.generateContent({
          model: "gemini-2.5-pro",
          contents: "Responda apenas: OK",
          config: { maxOutputTokens: 10 },
        });
        return response.text ?? "";
      }, "testGemini");
      if (text.toLowerCase().includes("ok")) {
        res.json({ success: true, message: "Conexao com Gemini OK" });
      } else {
        res.json({ success: true, message: `Gemini respondeu: ${text.substring(0, 50)}` });
      }
    } catch (error: any) {
      console.error("Erro ao testar Gemini:", error);
      res.status(400).json({ success: false, message: `Erro: ${error.message || "Falha na conexao"}` });
    }
  });

  app.get("/api/settings/openai-key", async (_req, res) => {
    try {
      if (openaiKeyFromEnv) {
        return res.json({
          hasKey: true,
          managedBy: "env",
          maskedKey: `sk-...${openaiKeyFromEnv.substring(openaiKeyFromEnv.length - 4)}`,
        });
      }
      const apiKey = await storage.getSetting("openai_api_key");
      res.json({
        hasKey: !!apiKey,
        managedBy: "user",
        maskedKey: apiKey ? `sk-...${apiKey.substring(apiKey.length - 4)}` : null,
      });
    } catch (error) {
      console.error("Erro ao buscar config OpenAI:", error);
      res.status(500).json({ message: "Erro ao buscar configuracao" });
    }
  });

  app.post("/api/settings/openai-key", async (req, res) => {
    try {
      if (openaiKeyFromEnv) {
        return res.status(403).json({
          message: "Chave OpenAI definida via variavel de ambiente (AI_INTEGRATIONS_OPENAI_API_KEY). Edicao bloqueada — altere no deploy.",
        });
      }
      const { apiKey } = req.body;
      if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
        return res.status(400).json({ message: "Chave de API invalida" });
      }
      await storage.setSetting("openai_api_key", apiKey.trim());
      setOpenAIApiKey(apiKey.trim());
      res.json({ success: true, message: "Chave OpenAI salva com sucesso" });
    } catch (error) {
      console.error("Erro ao salvar chave OpenAI:", error);
      res.status(500).json({ message: "Erro ao salvar chave de API" });
    }
  });

  app.delete("/api/settings/openai-key", async (_req, res) => {
    try {
      if (openaiKeyFromEnv) {
        return res.status(403).json({
          message: "Chave OpenAI definida via variavel de ambiente. Remocao bloqueada — altere no deploy.",
        });
      }
      await storage.setSetting("openai_api_key", "");
      clearOpenAIApiKey();
      res.json({ success: true, message: "Chave OpenAI removida" });
    } catch (error) {
      console.error("Erro ao remover chave OpenAI:", error);
      res.status(500).json({ message: "Erro ao remover chave de API" });
    }
  });

  app.post("/api/settings/test-openai", async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey) {
        return res.status(400).json({ message: "Chave de API necessaria" });
      }
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Responda apenas: OK" }],
        max_tokens: 10,
      });
      const text = response.choices[0]?.message?.content ?? "";
      if (text.toLowerCase().includes("ok")) {
        res.json({ success: true, message: "Conexao com OpenAI GPT-4o OK" });
      } else {
        res.json({ success: true, message: `OpenAI respondeu: ${text.substring(0, 50)}` });
      }
    } catch (error: any) {
      console.error("Erro ao testar OpenAI:", error);
      res.status(400).json({ success: false, message: `Erro: ${error.message || "Falha na conexao"}` });
    }
  });

  app.get("/api/settings/openai-model", async (_req, res) => {
    try {
      const model = await storage.getSetting("openai_model");
      res.json({ model: (model && model.trim()) || DEFAULT_OPENAI_MODEL, defaultModel: DEFAULT_OPENAI_MODEL });
    } catch (error) {
      console.error("Erro ao buscar modelo OpenAI:", error);
      res.status(500).json({ message: "Erro ao buscar configuracao" });
    }
  });

  app.post("/api/settings/openai-model", async (req, res) => {
    try {
      const { model } = req.body;
      if (!model || typeof model !== "string" || model.trim().length < 2) {
        return res.status(400).json({ message: "Modelo invalido" });
      }
      await storage.setSetting("openai_model", model.trim());
      setOpenAIModelName(model.trim());
      res.json({ success: true, model: model.trim() });
    } catch (error) {
      console.error("Erro ao salvar modelo OpenAI:", error);
      res.status(500).json({ message: "Erro ao salvar modelo" });
    }
  });

  app.get("/api/settings/wall-thickness-max", async (_req, res) => {
    try {
      const raw = await storage.getSetting("wall_thickness_max_m");
      const value = raw ? parseFloat(raw) : DEFAULT_MAX_WALL_THICKNESS_M;
      const effective = Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_WALL_THICKNESS_M;
      res.json({ valueM: effective, defaultM: DEFAULT_MAX_WALL_THICKNESS_M });
    } catch (error) {
      console.error("Erro ao buscar espessura maxima:", error);
      res.status(500).json({ message: "Erro ao buscar configuracao" });
    }
  });

  app.post("/api/settings/wall-thickness-max", async (req, res) => {
    try {
      const { valueM } = req.body;
      const n = typeof valueM === "number" ? valueM : parseFloat(valueM);
      if (!Number.isFinite(n) || n <= 0 || n > 2) {
        return res.status(400).json({ message: "Valor invalido (use metros, ex: 0.12 para 120mm; max 2m)" });
      }
      await storage.setSetting("wall_thickness_max_m", String(n));
      res.json({ success: true, valueM: n });
    } catch (error) {
      console.error("Erro ao salvar espessura maxima:", error);
      res.status(500).json({ message: "Erro ao salvar configuracao" });
    }
  });

  app.get("/api/products", async (_req, res) => {
    try {
      const allProducts = await storage.getProducts();
      res.json(allProducts);
    } catch (error) {
      console.error("Erro ao buscar produtos:", error);
      res.status(500).json({ message: "Erro ao buscar produtos" });
    }
  });

  app.post("/api/products", async (req, res) => {
    try {
      const { name, panelType, unitPrice, category, thickness, unit, description } = req.body;
      if (!name || !unitPrice) {
        return res.status(400).json({ message: "Nome e preco sao obrigatorios" });
      }
      const sku = `LW-${(panelType || "2P").toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      const product = await storage.createProduct({
        sku,
        name,
        category: category || "painel",
        panelType: panelType || null,
        thickness: thickness || 0,
        unitPrice: String(unitPrice),
        unit: unit || "m²",
        description: description || null,
      });
      res.json(product);
    } catch (error: any) {
      console.error("Erro ao criar produto:", error);
      res.status(500).json({ message: "Erro ao criar produto" });
    }
  });

  app.put("/api/products/:id", async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const { name, panelType, unitPrice, category, thickness, unit, description } = req.body;
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (panelType !== undefined) updateData.panelType = panelType;
      if (unitPrice !== undefined) updateData.unitPrice = String(unitPrice);
      if (category !== undefined) updateData.category = category;
      if (thickness !== undefined) updateData.thickness = thickness;
      if (unit !== undefined) updateData.unit = unit;
      if (description !== undefined) updateData.description = description;
      const product = await storage.updateProduct(id, updateData);
      if (!product) return res.status(404).json({ message: "Produto nao encontrado" });
      res.json(product);
    } catch (error: any) {
      console.error("Erro ao atualizar produto:", error);
      res.status(500).json({ message: "Erro ao atualizar produto" });
    }
  });

  app.delete("/api/products/:id", async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      await storage.deleteProduct(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Erro ao excluir produto:", error);
      res.status(500).json({ message: "Erro ao excluir produto" });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const { name, clientName, clientEmail, description, buildingType, pricingProfileId } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Nome do projeto é obrigatório" });
      }
      const validTypes = ["residencial", "comercial", "institucional", "industrial", "outro"];

      // Resolução de perfil: usuário → default. Apenas admin pode forçar via body.
      let resolvedProfileId: number | null = null;
      if (req.user?.id) {
        const u = await storage.getUser(req.user.id);
        resolvedProfileId = u?.pricingProfileId ?? null;
      }
      if (typeof pricingProfileId === "number" && req.user?.role === "admin") {
        resolvedProfileId = pricingProfileId;
      }
      if (resolvedProfileId === null) {
        const def = await storage.getDefaultPricingProfile();
        resolvedProfileId = def?.id ?? null;
      }

      const project = await storage.createProject({
        name,
        clientName: clientName || null,
        clientEmail: clientEmail?.trim().toLowerCase() || null,
        description: description || null,
        buildingType: buildingType && validTypes.includes(buildingType) ? buildingType : null,
        status: "draft",
        pricingProfileId: resolvedProfileId,
      });
      res.json(project);
    } catch (error) {
      console.error("Erro ao criar projeto:", error);
      res.status(500).json({ message: "Erro ao criar projeto" });
    }
  });

  // ===== Pricing Profiles (admin only — pricing tables are sensitive) =====
  app.get("/api/pricing-profiles", requireAdmin, async (_req, res) => {
    try {
      const list = await storage.getPricingProfiles();
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Erro ao listar perfis" });
    }
  });

  app.post("/api/pricing-profiles", requireAdmin, async (req, res) => {
    try {
      const { code, label, region, isDefault, active } = req.body;
      if (!code || !label) return res.status(400).json({ message: "Code e label sao obrigatorios" });
      const created = await storage.createPricingProfile({
        code: String(code).trim().toUpperCase(),
        label: String(label).trim(),
        region: region ? String(region).trim() : null,
        isDefault: isDefault ? 1 : 0,
        active: active === 0 ? 0 : 1,
      });
      res.status(201).json(created);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Erro ao criar perfil" });
    }
  });

  app.put("/api/pricing-profiles/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const { code, label, region, isDefault, active } = req.body;
      const data: any = {};
      if (code !== undefined) data.code = String(code).trim().toUpperCase();
      if (label !== undefined) data.label = String(label).trim();
      if (region !== undefined) data.region = region ? String(region).trim() : null;
      if (isDefault !== undefined) data.isDefault = isDefault ? 1 : 0;
      if (active !== undefined) data.active = active ? 1 : 0;
      const updated = await storage.updatePricingProfile(id, data);
      if (!updated) return res.status(404).json({ message: "Perfil nao encontrado" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Erro ao atualizar perfil" });
    }
  });

  app.delete("/api/pricing-profiles/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      await storage.deletePricingProfile(id);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Erro ao remover perfil" });
    }
  });

  app.get("/api/pricing-profiles/:id/prices", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const prices = await storage.getProfilePrices(id);
      res.json(prices);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Erro ao listar precos" });
    }
  });

  app.put("/api/pricing-profiles/:id/prices/:sku", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const sku = String(req.params.sku);
      const { unitPrice } = req.body;
      const n = typeof unitPrice === "number" ? unitPrice : parseFloat(unitPrice);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ message: "Preco invalido" });
      const saved = await storage.upsertProfilePrice(id, sku, String(n.toFixed(2)));
      res.json(saved);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Erro ao salvar preco" });
    }
  });

  app.delete("/api/pricing-profiles/:id/prices/:sku", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const sku = String(req.params.sku);
      await storage.deleteProfilePrice(id, sku);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Erro ao remover preco" });
    }
  });

  app.get("/api/projects", async (req, res) => {
    try {
      const projects = await storage.getProjects();
      const isAdmin = req.user?.role === "admin";
      const projectsWithBudget = await Promise.all(
        projects.map(async (p) => {
          const budget = await storage.getBudget(p.id);
          const { clientEmail, fileFingerprint, ...publicFields } = p;
          return {
            ...(isAdmin ? p : publicFields),
            budgetTotalCost: budget?.totalCost ? parseFloat(budget.totalCost) : null,
          };
        })
      );
      res.json(projectsWithBudget);
    } catch (error) {
      console.error("Erro ao listar projetos:", error);
      res.status(500).json({ message: "Erro ao listar projetos" });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const project = await storage.getProject(id);
      if (!project) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const isAdmin = req.user?.role === "admin";
      const files = await storage.getProjectFiles(id);
      const extracted = await storage.getExtractedData(id);
      const budget = await storage.getBudget(id);
      const { clientEmail, fileFingerprint, ...publicFields } = project;
      res.json({
        project: { ...(isAdmin ? project : publicFields), budgetTotalCost: budget?.totalCost ?? null },
        files,
        extractedData: extracted,
        budget: budget ? budget.budgetData : null,
      });
    } catch (error) {
      console.error("Erro ao buscar projeto:", error);
      res.status(500).json({ message: "Erro ao buscar projeto" });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const project = await storage.getProject(id);
      if (!project) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      await storage.deleteProject(id);
      res.json({ message: "Projeto excluido com sucesso" });
    } catch (error) {
      console.error("Erro ao excluir projeto:", error);
      res.status(500).json({ message: "Erro ao excluir projeto" });
    }
  });

  app.get("/api/files/:fileId/content", async (req, res) => {
    try {
      const fileId = parseInt(String(req.params.fileId));
      const targetFile = await storage.getProjectFile(fileId);
      if (!targetFile) {
        return res.status(404).json({ message: "Arquivo nao encontrado" });
      }
      const filePath = path.resolve(targetFile.filePath);
      await fs.access(filePath);
      const mimeTypes: Record<string, string> = {
        pdf: "application/pdf",
        image: "image/png",
        ifc: "application/octet-stream",
      };
      const ext = targetFile.originalName?.split(".").pop()?.toLowerCase();
      let contentType = mimeTypes[targetFile.fileType] || "application/octet-stream";
      if (ext === "jpg" || ext === "jpeg") contentType = "image/jpeg";
      else if (ext === "png") contentType = "image/png";
      else if (ext === "webp") contentType = "image/webp";
      else if (ext === "bmp") contentType = "image/bmp";
      else if (ext === "tif" || ext === "tiff") contentType = "image/tiff";
      else if (ext === "ifc") contentType = "application/octet-stream";

      const stat = await fs.stat(filePath);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(targetFile.originalName || 'arquivo')}"`);
      res.setHeader("Content-Length", String(stat.size));
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("ETag", `"${targetFile.id}-${stat.size}-${stat.mtimeMs}"`);
      const data = await fs.readFile(filePath);
      res.send(data);
    } catch (error) {
      console.error("Erro ao servir arquivo:", error);
      res.status(500).json({ message: "Erro ao servir arquivo" });
    }
  });

  app.delete("/api/files/:fileId", async (req, res) => {
    try {
      const fileId = parseInt(String(req.params.fileId));
      const targetFile = await storage.getProjectFile(fileId);
      if (!targetFile) {
        return res.status(404).json({ message: "Arquivo nao encontrado" });
      }
      try {
        const filePath = path.resolve(targetFile.filePath);
        await fs.unlink(filePath);
      } catch {}
      await storage.deleteProjectFile(fileId);
      res.json({ message: "Arquivo excluido com sucesso" });
    } catch (error) {
      console.error("Erro ao excluir arquivo:", error);
      res.status(500).json({ message: "Erro ao excluir arquivo" });
    }
  });

  app.get("/api/projects/:id/progress", (req, res) => {
    const projectId = parseInt(String(req.params.id));
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    // Initial comment so the client EventSource opens immediately and any
    // intermediary proxy starts forwarding bytes.
    try { res.write(": connected\n\n"); } catch {}

    const clients = progressClients.get(projectId) || [];
    clients.push(res);
    progressClients.set(projectId, clients);

    // Heartbeat: SSE comment line every 15s. Long pipeline steps (e.g.
    // ETAPA 3 OpenAI extraction) can be silent for minutes; without a
    // heartbeat the Replit/CDN proxy closes the idle connection and the
    // browser stops receiving any further progress events even though the
    // backend is still processing.
    const heartbeat = setInterval(() => {
      try { res.write(`: ping ${Date.now()}\n\n`); } catch {}
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      const remaining = (progressClients.get(projectId) || []).filter(c => c !== res);
      if (remaining.length === 0) progressClients.delete(projectId);
      else progressClients.set(projectId, remaining);
    });
  });

  // SSE: timeline ao vivo de chamadas IA (started/completed/failed) com tokens
  // e custo estimado. Funciona para Gemini e OpenAI — o auditor emite eventos
  // independentemente do provider que de fato executou.
  // Fase E: health do cv-service Python. UI pode mostrar status na aba
  // de processamento e o pipeline decide entre rota CV (Fase E) vs Gemini
  // (Fases A+B+D) baseado na capability.
  app.get("/api/cv-service/health", async (_req, res) => {
    try {
      const health = await checkCvServiceHealth();
      if (!health.reachable) {
        return res.json({ ...health, ready: false });
      }
      const cap = await cvServiceCapability();
      return res.json({ ...health, ready: cap.ready });
    } catch (err: any) {
      return res.status(500).json({ reachable: false, error: err?.message || String(err) });
    }
  });

  // Historico de eventos do pipeline — entrega persistente pra a UI
  // reconstruir a timeline ao abrir um projeto depois do processamento.
  // Combina com /ai-events (SSE) que streama os eventos novos.
  app.get("/api/projects/:id/pipeline-events", async (req, res) => {
    try {
      const projectId = parseInt(String(req.params.id));
      if (!Number.isFinite(projectId)) {
        return res.status(400).json({ message: "ID invalido" });
      }
      const events = await storage.getPipelineEvents(projectId);
      // Devolve apenas o payload — o resto e metadado de tabela.
      res.json(events.map(e => e.payload));
    } catch (err: any) {
      console.error("Erro ao buscar pipeline events:", err);
      res.status(500).json({ message: "Erro ao buscar eventos" });
    }
  });

  app.get("/api/projects/:id/ai-events", (req, res) => {
    const projectId = parseInt(String(req.params.id));
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    try { res.write(": connected\n\n"); } catch {}

    const remove = addAiEventClient(projectId, res);
    const heartbeat = setInterval(() => {
      try { res.write(`: ping ${Date.now()}\n\n`); } catch {}
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      remove();
    });
  });

  app.post(
    "/api/projects/:id/upload",
    upload.array("files", 20),
    async (req, res) => {
      try {
        const projectId = parseInt(String(req.params.id));
        const project = await storage.getProject(projectId);
        if (!project) {
          return res.status(404).json({ message: "Projeto não encontrado" });
        }

        const uploadedFiles = req.files as Express.Multer.File[];
        if (!uploadedFiles || uploadedFiles.length === 0) {
          return res.status(400).json({ message: "Nenhum arquivo enviado" });
        }

        const savedFiles = [];
        for (const file of uploadedFiles) {
          const ext = path.extname(file.originalname).toLowerCase();
          const fileType = ext === ".pdf" ? "pdf" : ext === ".ifc" ? "ifc" : "image";

          // Salva caminho ABSOLUTO no DB. O `file.path` do multer e relativo
          // ao cwd no momento da escrita — se o cwd mudar em um restart
          // futuro (deploy, container Docker novo, etc.) o reprocess nao
          // consegue mais localizar o arquivo. Resolver no momento do upload
          // garante imunidade a essa variacao.
          const saved = await storage.addProjectFile({
            projectId,
            originalName: file.originalname,
            filePath: path.resolve(file.path),
            fileType,
            fileSize: file.size,
            pageType: null,
          });
          savedFiles.push(saved);
        }

        const crypto = await import("crypto");
        const hash = crypto.createHash("sha256");
        for (const file of [...uploadedFiles].sort((a, b) => a.originalname.localeCompare(b.originalname))) {
          const content = await fs.readFile(file.path);
          hash.update(content);
        }
        const fingerprint = hash.digest("hex").substring(0, 64);
        await storage.updateProject(projectId, { fileFingerprint: fingerprint });

        res.json({ files: savedFiles, fingerprint });
      } catch (error) {
        console.error("Erro no upload:", error);
        res.status(500).json({ message: "Erro no upload de arquivos" });
      }
    },
  );

  app.post("/api/projects/:id/process", async (req, res) => {
    const projectId = parseInt(String(req.params.id));
    const selectedProductIdExt = req.body?.productIdExt ? parseInt(req.body.productIdExt) : (req.body?.productId ? parseInt(req.body.productId) : null);
    const selectedProductIdInt = req.body?.productIdInt ? parseInt(req.body.productIdInt) : null;
    const selectedProductIdMuros = req.body?.productIdMuros ? parseInt(req.body.productIdMuros) : null;
    const selectedProductIdPiso = req.body?.productIdPiso ? parseInt(req.body.productIdPiso) : null;
    const selectedProductIdCoberta = req.body?.productIdCoberta ? parseInt(req.body.productIdCoberta) : null;
    const scopeRaw = req.body?.scope || {};
    const scope = {
      paredesExternas: scopeRaw.paredesExternas === true || scopeRaw.paredesExternas === undefined,
      paredesInternas: scopeRaw.paredesInternas === true || scopeRaw.paredesInternas === undefined,
      muros: scopeRaw.muros === true || scopeRaw.muros === undefined,
      lajePiso: scopeRaw.lajePiso === true || scopeRaw.lajePiso === undefined,
      lajeCoberta: scopeRaw.lajeCoberta === true || scopeRaw.lajeCoberta === undefined,
      cantos: scopeRaw.cantos === true || scopeRaw.cantos === undefined,
    };
    const analysisMode: string = req.body?.analysisMode || "gemini-only";
    const peDireito: number = parseFloat(req.body?.peDireito) || 3.0;
    console.log(`[PIPELINE] Escopo selecionado: ext=${scope.paredesExternas} int=${scope.paredesInternas} piso=${scope.lajePiso} coberta=${scope.lajeCoberta} cantos=${scope.cantos}`);
    console.log(`[PIPELINE] Modo de analise: ${analysisMode} | Pe-direito: ${peDireito}m`);

    // Pre-validate OpenAI key for OpenAI-based modes before entering the run context.
    if ((analysisMode === "openai-only" || analysisMode === "openai-vision-takeoff") && !hasOpenAIKey()) {
      return res.status(400).json({
        message: "Modo OpenAI selecionado mas nenhuma chave OpenAI esta configurada. Adicione a chave em Configuracoes.",
      });
    }
    const providerForRun: "gemini" | "openai" =
      analysisMode === "openai-only" || analysisMode === "openai-vision-takeoff" ? "openai" : "gemini";
    if (providerForRun === "openai") {
      console.log(`[PIPELINE] Roteando para OpenAI (modelo: ${getOpenAIModelName()})`);
    }

    // Wrap the entire pipeline body in an AsyncLocalStorage context so any
    // concurrent run (e.g. another user simultaneously processing in gemini-only
    // mode) sees its own provider value via getActiveProvider().
    await runWithProvider(providerForRun, async () => {
    try {
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }

      if (project.fileFingerprint) {
        const allProjects = await storage.getProjects();
        const duplicate = allProjects.find(
          (p) =>
            p.id !== projectId &&
            p.fileFingerprint === project.fileFingerprint &&
            p.status === "completed" &&
            (!project.clientEmail || !p.clientEmail || p.clientEmail === project.clientEmail)
        );
        if (duplicate) {
          console.log(`[PIPELINE] Projeto duplicado detectado: projeto ${projectId} tem mesma impressao digital que projeto ${duplicate.id}`);
          return res.status(409).json({
            message: "Projeto com arquivos identicos ja foi processado anteriormente.",
            duplicateProjectId: duplicate.id,
            duplicateProjectName: duplicate.name,
            duplicateClientName: duplicate.clientName,
          });
        }
      }

      await storage.updateProjectStatus(projectId, "processing");

      const files = await storage.getProjectFiles(projectId);
      if (files.length === 0) {
        await storage.updateProjectStatus(projectId, "error");
        return res.status(400).json({ message: "Nenhum arquivo para processar" });
      }

      await storage.clearExtractedData(projectId);
      await storage.deleteBudget(projectId);
      resetApiMetrics(projectId);
      clearSplitCache();
      pipelineStartTimes.set(projectId, Date.now());

      const allClassifications: PageClassification[] = [];
      // Task #9: rastreia qual arquivo é dono de cada (page_index) — necessário
      // para a etapa de validação por cortes, que precisa ler a página do PDF
      // correto. Chave: `${fileId}:${pageIndex}` -> file.
      const classificationsByFile = new Map<string, PageClassification[]>();
      const allGeometries: GeometryResult[] = [];
      let mergedTableData: TableData = { paredes_de_tabela: [], esquadrias_de_tabela: [], areas_de_tabela: [] };
      const pipelineFailedPages: Array<{ fileId: number; fileName: string; pageIndex: number }> = [];
      if (analysisMode === "gemini-only") console.log("[PIPELINE] Modo Gemini-only selecionado");
      else if (analysisMode === "openai-only") console.log("[PIPELINE] Modo OpenAI-only selecionado");
      else if (analysisMode === "openai-vision-takeoff") console.log("[PIPELINE] Modo OpenAI Vision Takeoff selecionado");
      const userBuildingType = project.buildingType || undefined;
      let detectedBuildingType: string | undefined;
      const effectiveBuildingType = (): string | undefined => userBuildingType || detectedBuildingType;

      for (const file of files) {
        try {
          // Resolve o caminho do arquivo em disco. Projetos antigos podem ter
          // salvo path relativo; em deploys com cwd diferente isso quebrava.
          // O helper tenta varios formatos (absoluto, relativo ao cwd,
          // UPLOADS_DIR/basename) e retorna null se o arquivo realmente sumiu.
          const filePath = resolveProjectFilePath(file.filePath);
          if (!filePath) {
            const msg = `Arquivo "${file.originalName}" nao foi encontrado em disco. ` +
              `Provavelmente foi removido apos o upload. Exclua-o do projeto e faca upload novamente.`;
            console.error(`[PIPELINE] ${msg} (filePath salvo: "${file.filePath}")`);
            sendProgress(projectId, 0.5, "Pre-flight", "error", msg);
            pipelineFailedPages.push({ fileId: file.id, fileName: file.originalName, pageIndex: -1 });
            continue;
          }

          // ===== Pre-flight inspection: detect file type, vector vs raster, recommend mode =====
          let preflight: Awaited<ReturnType<typeof inspectFile>> | null = null;
          try {
            sendProgress(projectId, 0.5, "Pre-flight", "running", `Inspecionando ${file.originalName}...`);
            preflight = await inspectFile(filePath, file.fileType);
            const summary = summarizePreflight(preflight);
            console.log(`[PREFLIGHT] ${file.originalName}: ${summary}`);
            for (const n of preflight.notes) console.log(`[PREFLIGHT]   - ${n}`);
            sendProgress(projectId, 0.5, "Pre-flight", "done", `${file.originalName}: ${summary}`);
          } catch (preErr: any) {
            console.warn(`[PREFLIGHT] Falha ao inspecionar ${file.originalName}:`, preErr?.message || preErr);
            sendProgress(projectId, 0.5, "Pre-flight", "done", `Inspeção pulada (${preErr?.message || "erro"})`);
          }

          // ===== IFC pipeline: skip Gemini entirely, parse structured data directly =====
          if (file.fileType === "ifc") {
            sendProgress(projectId, 1, "Leitura IFC", "running", `Lendo modelo BIM ${file.originalName}...`);
            try {
              const ifcResult = await parseIfcFile(filePath, peDireito);
              const summary = `${ifcResult.wallCount} paredes, ${ifcResult.slabCount} lajes, ${ifcResult.doorCount} portas, ${ifcResult.windowCount} janelas (${ifcResult.storeyCount} pavimento(s))`;
              sendProgress(projectId, 1, "Leitura IFC", "done", summary);

              await storage.updateFilePageType(file.id, "ifc_model");

              for (const wall of ifcResult.walls) {
                await storage.addExtractedData({ projectId, fileId: file.id, elementType: "parede", data: wall, hasAssumption: 0 });
              }
              for (const slab of ifcResult.slabs) {
                await storage.addExtractedData({ projectId, fileId: file.id, elementType: "laje", data: slab, hasAssumption: 0 });
              }

              allGeometries.push({ walls: ifcResult.walls, slabs: ifcResult.slabs, corners: ifcResult.corners });

              if (ifcResult.warnings.length > 0) {
                console.log(`[IFC] ${ifcResult.warnings.length} avisos para ${file.originalName}:`);
                for (const w of ifcResult.warnings.slice(0, 5)) console.log(`  - ${w}`);
              }
            } catch (ifcError: any) {
              console.error(`[IFC] Falha ao ler ${file.originalName}:`, ifcError);
              sendProgress(projectId, 1, "Leitura IFC", "error", `Falha ao ler ${file.originalName}: ${ifcError.message || "erro desconhecido"}`);
            }
            continue;
          }

          sendProgress(projectId, 1, "Classificacao + Tabelas", "running", `Classificando e extraindo tabelas de ${file.originalName} (chamada unificada, paginas em paralelo)...`);
          const ctModel = providerForRun === "openai" ? `openai:${getOpenAIModelName()}` : "gemini-2.5-pro";
          const ctResult = await auditAiCall(
            {
              projectId,
              promptVersion: "classifyAndExtractTables_v1",
              model: ctModel,
              inputSummary: `file=${file.originalName} type=${file.fileType} maxPages=3 userBuildingType=${!!userBuildingType}`,
              inputFileId: String(file.id),
            },
            () => classifyAndExtractTables(filePath, file.fileType, 3, !!userBuildingType),
            (out: any) => ({
              classCount: out?.classifications?.length ?? 0,
              tableWalls: out?.tableData?.paredes_de_tabela?.length ?? 0,
              tableWindows: out?.tableData?.esquadrias_de_tabela?.length ?? 0,
              tableAreas: out?.tableData?.areas_de_tabela?.length ?? 0,
              detectedBuildingType: out?.detectedBuildingType ?? null,
              failedPages: out?.failedPages ?? [],
            }),
          );
          const { classifications, tableData, failedPages: ctFailed, detectedBuildingType: fileBuildingType } = ctResult;

          if (fileBuildingType && !detectedBuildingType) {
            detectedBuildingType = fileBuildingType;
            console.log(`[PIPELINE] Tipo edificacao detectado: ${detectedBuildingType}`);
          }

          const classDetail = classifications.map(c => `Pag ${c.page_index}: ${c.classificacao} (${c.pavimento})`).join(" | ");
          const tablesSummary = `${tableData.paredes_de_tabela.length} paredes, ${tableData.esquadrias_de_tabela.length} esquadrias, ${tableData.areas_de_tabela.length} areas`;
          const failedMsg = ctFailed.length > 0 ? ` | ${ctFailed.length} pag(s) falharam` : "";
          sendProgress(projectId, 1, "Classificacao + Tabelas", "done", `${classifications.length} pagina(s): ${classDetail} | Tabelas: ${tablesSummary}${failedMsg}`);

          allClassifications.push(...classifications);
          classificationsByFile.set(String(file.id), classifications);
          for (const p of ctFailed) {
            pipelineFailedPages.push({ fileId: file.id, fileName: file.originalName, pageIndex: p });
            recordFailedPage({ fileId: file.id, fileName: file.originalName, pageIndex: p, reason: "Falha na classificacao/tabelas" });
          }

          const mainClass = classifications[0]?.classificacao || "planta_baixa";
          await storage.updateFilePageType(file.id, mainClass);

          mergedTableData.paredes_de_tabela.push(...tableData.paredes_de_tabela);
          mergedTableData.esquadrias_de_tabela.push(...tableData.esquadrias_de_tabela);
          mergedTableData.areas_de_tabela.push(...tableData.areas_de_tabela);

          for (const tw of tableData.paredes_de_tabela) {
            await storage.addExtractedData({ projectId, fileId: file.id, elementType: "parede_tabela", data: tw, hasAssumption: 0 });
          }
          for (const te of tableData.esquadrias_de_tabela) {
            await storage.addExtractedData({ projectId, fileId: file.id, elementType: "esquadria_tabela", data: te, hasAssumption: 0 });
          }

          const hasGeometryPages = classifications.some(c =>
            c.classificacao === "planta_baixa" ||
            c.classificacao === "planta_cobertura" ||
            c.classificacao === "corte" ||
            c.classificacao === "fachada" ||
            c.classificacao === "detalhe_construtivo"
          );
          const vista3dCount = classifications.filter(c => c.classificacao === "vista_3d").length;
          if (vista3dCount > 0) {
            console.log(`[ETAPA1] ${vista3dCount} pagina(s) classificada(s) como vista_3d — excluida(s) da extracao de paredes para evitar duplicacao com plantas baixas.`);
          }

          if (hasGeometryPages || classifications.every(c => c.classificacao !== "irrelevante")) {
            const plantaPages = classifications.filter(c => c.classificacao === "planta_baixa");

            // Helper: run Gemini-only pipeline (Flash extraction + Flash per-floor verification, all parallel)
            const runGeminiPipeline = async (): Promise<GeometryResult> => {
              const geoModel = providerForRun === "openai" ? `openai:${getOpenAIModelName()}` : "gemini-2.5-flash";
              const geoResult = await auditAiCall(
                {
                  projectId,
                  promptVersion: "extractGeometryParallel_v1",
                  model: geoModel,
                  inputSummary: `file=${file.originalName} type=${file.fileType} pages=${classifications.length} buildingType=${effectiveBuildingType() || "n/a"} peDireito=${peDireito}`,
                  inputFileId: String(file.id),
                },
                () => extractGeometryParallel(filePath, file.fileType, classifications, 3, effectiveBuildingType(), peDireito),
                (out: any) => ({
                  walls: out?.walls?.length ?? 0,
                  slabs: out?.slabs?.length ?? 0,
                  corners: out?.corners?.length ?? 0,
                  failedPages: out?.failedPages ?? [],
                }),
              );
              for (const p of geoResult.failedPages) {
                pipelineFailedPages.push({ fileId: file.id, fileName: file.originalName, pageIndex: p });
                recordFailedPage({ fileId: file.id, fileName: file.originalName, pageIndex: p, reason: "Falha na extracao geometrica" });
              }
              const geometry: GeometryResult = { walls: geoResult.walls, slabs: geoResult.slabs, corners: geoResult.corners };
              // Per-floor verification already done inside extractGeometryParallel
              sendProgress(projectId, 3.5, "Verificacao IA", "done", `${geometry.walls.length} paredes, ${geometry.slabs.length} lajes (verificacao per-floor integrada)`);
              return geometry;
            };

            // Helper: run OpenAI Vision Takeoff pipeline (per planta_baixa page, structured-output JSON)
            const runOpenAiVisionPipeline = async (): Promise<GeometryResult> => {
              const geo: GeometryResult = { walls: [], slabs: [], corners: [] };
              if (plantaPages.length === 0) return geo;
              const service = new AiTakeoffService();
              // Supports both PDF (multi-page) and single-page images
              const pages = await getFilePages(filePath, file.fileType);
              for (const pc of plantaPages) {
                const page = pages.find(p => p.pageIndex === pc.page_index);
                if (!page) continue;
                const raw64 = page.base64.includes(",") ? page.base64.split(",", 2)[1] : page.base64;
                const pavimento = pc.pavimento || "Terreo";
                try {
                  const result = await service.analyzeSheetImage({
                    projectId,
                    pageId: null,
                    pageNumber: pc.page_index + 1,
                    pageLabel: `Pag ${pc.page_index + 1}`,
                    pavimento,
                    imageBase64: raw64,
                    imageMimeType: page.mimeType,
                    imageWidthPx: 2480,
                    imageHeightPx: 3508,
                    buildingType: effectiveBuildingType() || undefined,
                  });
                  let segCount = 0;
                  let slabCount = 0;
                  for (const seg of result.sheet.segments) {
                    const len = seg.length_m_ai ?? seg.length_m_calculated ?? 0;
                    if (!len || len <= 0) continue;
                    const classe: "externa" | "interna" | "muro" =
                      seg.category === "parede_externa" ? "externa" :
                      seg.category === "parede_interna" ? "interna" : "muro";
                    geo.walls.push({
                      id: `${file.id}-${pc.page_index}-${seg.id}`,
                      nivel: pavimento,
                      classe,
                      comprimento_m: len,
                      altura_m: seg.height_m ?? peDireito,
                      espessura_m: 0.10,
                      measurement_source: "ai_vision_takeoff",
                      confidence: seg.confidence ?? 0.75,
                      has_door: false,
                      has_window: false,
                      opening_area_m2: 0,
                      esquadrias: [],
                      page_index: pc.page_index,
                    });
                    segCount++;
                  }
                  for (const sl of result.sheet.slabs) {
                    const area = sl.area_m2_declared ?? sl.area_m2_ai ?? sl.area_m2_calculated ?? 0;
                    if (!area || area <= 0) continue;
                    const classe: "piso" | "coberta" =
                      sl.category === "laje_piso" ? "piso" : "coberta";
                    geo.slabs.push({
                      id: `${file.id}-${pc.page_index}-${sl.id}`,
                      nivel: pavimento,
                      classe,
                      area_m2: area,
                      measurement_source: "ai_vision_takeoff",
                      confidence: sl.confidence ?? 0.75,
                    });
                    slabCount++;
                  }
                  console.log(`[ETAPA 3 OPENAI-VISION] Pav ${pavimento} pg ${pc.page_index}: ${segCount} paredes, ${slabCount} lajes`);
                } catch (err: any) {
                  console.error(`[ETAPA 3 OPENAI-VISION] Falha pg ${pc.page_index}:`, err?.message || err);
                  pipelineFailedPages.push({ fileId: file.id, fileName: file.originalName, pageIndex: pc.page_index });
                  recordFailedPage({ fileId: file.id, fileName: file.originalName, pageIndex: pc.page_index, reason: `OpenAI Vision: ${err?.message || "erro desconhecido"}` });
                }
              }
              return geo;
            };

            // Helper: store geometry in DB.
            // Falhas transitorias do Postgres (Neon 57P01: "terminating connection
            // due to administrator command") nao podem invalidar a etapa, pois a
            // geometria ja esta em memoria em allGeometries e sera usada pela
            // fusao multivista mais adiante. Se a persistencia falhar de vez,
            // logamos e seguimos — o orcamento e calculado mesmo assim.
            const storeGeometry = async (geometry: GeometryResult) => {
              const items: InsertExtractedData[] = [];
              for (const wall of geometry.walls) items.push({ projectId, fileId: file.id, elementType: "parede", data: wall, hasAssumption: 0 });
              for (const slab of geometry.slabs) items.push({ projectId, fileId: file.id, elementType: "laje", data: slab, hasAssumption: 0 });
              for (const corner of geometry.corners) items.push({ projectId, fileId: file.id, elementType: "canto", data: corner, hasAssumption: 0 });
              try {
                await storage.addExtractedDataBatch(items);
              } catch (storeErr: any) {
                console.warn(`[STORE] Falha ao persistir geometria de ${file.originalName} (${items.length} itens): ${storeErr?.message || storeErr}. Pipeline continua com dados em memoria.`);
              }
            };

            // ===== Native PDF vector extraction (additional source for vector PDFs) =====
            if (preflight?.isPdfVector && file.fileType === "pdf" && plantaPages.length > 0) {
              try {
                sendProgress(projectId, 2.5, "Extracao Vetorial Nativa", "running", `Lendo geometria nativa do PDF ${file.originalName}...`);
                // Restrict to planta_baixa pages only (avoid facades/cortes/details)
                const pavMap = new Map<number, string>();
                for (const pc of plantaPages) pavMap.set(pc.page_index, pc.pavimento || "Terreo");
                const vec = await extractFromVectorPdf(filePath, pavMap, peDireito);
                // GATE: quando a escala e fallback (cotas com alta dispersao ou
                // sem cotas confiaveis), os comprimentos reais das paredes sao
                // palpite e o vetorizador inunda o orcamento com paredes
                // fantasmas (incluindo moveis e hatches). Nesses casos
                // descartamos a geometria vetorial e confiamos so na IA.
                const scaleIsReliable = vec.scale.source === "cota";
                if (!scaleIsReliable && vec.geometry.walls.length > 0) {
                  console.warn(`[PDF-VECTOR] ${file.originalName}: escala nao confiavel (${vec.scale.source}/${vec.scale.detail}) — descartando ${vec.geometry.walls.length} paredes vetoriais para evitar superestimacao`);
                }
                if (scaleIsReliable && (vec.geometry.walls.length > 0 || vec.geometry.slabs.length > 0)) {
                  allGeometries.push(vec.geometry);
                  await storeGeometry(vec.geometry);
                }
                const scaleNote = scaleIsReliable ? "" : " — escala nao confiavel, paredes descartadas";
                sendProgress(projectId, 2.5, "Extracao Vetorial Nativa", "done",
                  `${vec.candidateWallCount} paredes em ${vec.pagesProcessed} plantas (${vec.segmentCount} segmentos, escala: ${vec.scale.detail})${scaleNote}`);
                console.log(`[PDF-VECTOR] ${file.originalName}: ${vec.candidateWallCount} paredes (escala ${vec.scale.source})`);
                for (const n of vec.notes.slice(0, 5)) console.log(`[PDF-VECTOR]   - ${n}`);
              } catch (vErr: any) {
                console.warn(`[PDF-VECTOR] Falha em ${file.originalName}:`, vErr?.message || vErr);
                sendProgress(projectId, 2.5, "Extracao Vetorial Nativa", "done", `Pulado (${vErr?.message || "erro"})`);
              }
            }

            // ===== Execute based on analysisMode =====
            if (analysisMode === "openai-vision-takeoff") {
              sendProgress(projectId, 3, "Extracao Geometrica (OpenAI Vision)", "running", `Analisando ${file.originalName} via OpenAI Vision Takeoff...`);
              const geometry = await runOpenAiVisionPipeline();
              allGeometries.push(geometry);
              await storeGeometry(geometry);
              sendProgress(projectId, 3, "Extracao Geometrica (OpenAI Vision)", "done", `${geometry.walls.length} paredes, ${geometry.slabs.length} lajes (OpenAI Vision)`);

            } else {
              // GEMINI-ONLY or OPENAI-ONLY
              const providerLabel = providerForRun === "openai" ? "OpenAI" : "Gemini";
              sendProgress(projectId, 3, "Extracao Geometrica", "running", `Analisando geometria de ${file.originalName} (${providerLabel})...`);
              sendProgress(projectId, 3.5, "Verificacao IA", "running", `Verificando extracao de ${file.originalName}...`);
              const geometry = await runGeminiPipeline();
              allGeometries.push(geometry);
              await storeGeometry(geometry);
              const geoFailedMsg = pipelineFailedPages.length > 0 ? ` | paginas falharam` : "";
              sendProgress(projectId, 3, "Extracao Geometrica", "done", `${geometry.walls.length} paredes, ${geometry.slabs.length} lajes, ${geometry.corners.length} cantos${geoFailedMsg}`);
            }
          }
        } catch (fileError) {
          console.error(`Erro ao processar arquivo ${file.id}:`, fileError);
          sendProgress(projectId, 3, "Extracao Geometrica", "error", `Erro ao processar ${file.originalName} - continuando com outros arquivos`);
        }
      }

      if (allGeometries.length === 0 && mergedTableData.paredes_de_tabela.length === 0) {
        await storage.updateProjectStatus(projectId, "error");
        cleanupApiMetrics(projectId);
        sendProgress(projectId, 0, "Erro", "error", "Nenhum dado geometrico ou tabular foi extraido dos arquivos. Verifique se os arquivos sao plantas arquitetonicas validas.");
        return res.status(400).json({ message: "Nenhum dado extraido dos arquivos. Verifique se os arquivos sao plantas arquitetonicas validas." });
      }

      // ===== Etapa 1.5 — Caracterizacao do projeto =====
      // Roda DEPOIS da Etapa 1 (classificacao + tabelas) e ANTES das etapas
      // 3.5+ (inventory, envelope, selfCheck, describe). Produz JSON estruturado
      // com tipologia, padrao, programa de ambientes e ranges esperados.
      // O resultado alimenta as etapas subsequentes (ranges dinamicos em
      // selfCheck, sanity check de count em wallInventory, hint de forma no
      // envelopeExtractor, input rico para describeProject).
      // Custo: 1 chamada Gemini (~$0.003). Falha = continua sem ranges
      // refinados, fallback para buildingTypePrompts hardcoded.
      let characterization: ProjectCharacterization | null = null;
      try {
        sendProgress(projectId, 1.5, "Caracterizacao", "running", "Identificando tipologia, programa e padrao construtivo...");
        const charSources = await getAnnotationImageSources(files, allClassifications, projectId);
        if (charSources.length > 0) {
          characterization = await characterizeProject({
            projectId,
            pages: charSources.map(s => ({
              pageIndex: s.pageIndex,
              pavimento: s.pavimento,
              base64: s.base64,
              mimeType: s.mimeType,
            })),
            buildingTypeHint: effectiveBuildingType() as any,
          });
        }
        if (characterization) {
          await storage.addExtractedData({
            projectId,
            elementType: "etapa1_5_characterization",
            data: characterization as any,
            hasAssumption: 0,
          });
          sendProgress(
            projectId, 1.5, "Caracterizacao", "done",
            `${characterization.typology} ${characterization.padrao} | ${characterization.pavimentos.join(", ")} | ` +
            `paredes esperadas ${characterization.estimativas.paredeCountRange.join("-")} | conf=${characterization.confidence}`,
          );
        } else {
          sendProgress(projectId, 1.5, "Caracterizacao", "done", "nao foi possivel caracterizar — usando defaults por buildingType");
        }
      } catch (charErr: any) {
        console.warn(`[CARACTERIZACAO] Pulada por erro: ${charErr?.message || charErr}`);
        sendProgress(projectId, 1.5, "Caracterizacao", "done", `pulada (erro: ${charErr?.message || "desconhecido"})`);
      }

      // ===== Etapa 3.4 — CV Pipeline (Fase E) =====
      // Roda o pipeline OpenCV/Shapely do cv-service em PARALELO com o pipeline
      // Gemini ja executado. Se cv-service esta ready e retorna status="ok":
      //   - sobrescreve endpoints das paredes com os do CV (mais precisos).
      //   - usa envelope CV como ground truth pra topologia (Etapa 3.7).
      //   - usa rooms CV pra classificacao topologica determinística.
      // Se cv-service esta em stub OU falha: ignora, segue com Gemini.
      // Resultado persistido em extracted_data como "cv_extraction" pra
      // A/B comparison na UI.
      try {
        const cvCap = await cvServiceCapability();
        if (cvCap.healthy && cvCap.ready) {
          sendProgress(projectId, 3.4, "CV Pipeline (Fase E)", "running", "cv-service detectado pronto — extracao paralela...");
          const cvSources = await getAnnotationImageSources(files, allClassifications);
          const cvResults: Array<{ pavimento: string; result: any }> = [];
          for (const src of cvSources) {
            try {
              // Usa streaming pra emitir cv_substep por etapa interna
              // (preprocess, envelope, ocr, wall_detect, classify). Em caso de
              // 404/erro, fullExtractionCVStreamed automaticamente cai pro
              // endpoint sincrono — compat total.
              const cvResult = await fullExtractionCVStreamed(
                {
                  imageBase64: src.base64,
                  mimeType: src.mimeType,
                  pavimento: src.pavimento,
                },
                (p) => {
                  emitCvSubstep({
                    projectId,
                    pavimento: src.pavimento,
                    substep: (p.substep as any) || "other",
                    phase: p.phase,
                    detail: typeof p.error === "string" ? p.error : undefined,
                    errorMessage: p.phase === "failed" && typeof p.error === "string" ? p.error : undefined,
                  });
                },
              );
              cvResults.push({ pavimento: src.pavimento, result: cvResult });
              console.log(
                `[CV] Pav "${src.pavimento}": status=${cvResult.status} ` +
                `walls=${cvResult.walls.length} envelope=${cvResult.envelope ? "sim" : "nao"} ` +
                `rooms=${cvResult.rooms.length} cotas=${cvResult.cotas.length} ` +
                `inference_ms=${cvResult.inference_ms}`,
              );
            } catch (e: any) {
              console.warn(`[CV] Falha em "${src.pavimento}": ${e?.message || e}`);
            }
          }
          // Persiste pra A/B comparison na UI.
          if (cvResults.length > 0) {
            await storage.addExtractedData({
              projectId,
              elementType: "cv_extraction",
              data: { results: cvResults },
              hasAssumption: 0,
            });
            sendProgress(
              projectId, 3.4, "CV Pipeline (Fase E)", "done",
              `${cvResults.length} pavimento(s) processados via cv-service`,
            );
          } else {
            sendProgress(projectId, 3.4, "CV Pipeline (Fase E)", "done", "sem resultados utilizaveis");
          }
        } else if (cvCap.healthy && !cvCap.ready) {
          sendProgress(projectId, 3.4, "CV Pipeline (Fase E)", "done", "cv-service em modo stub — pulando");
        } else {
          sendProgress(projectId, 3.4, "CV Pipeline (Fase E)", "done", "cv-service offline — pulando (pipeline Gemini segue normal)");
        }
      } catch (cvErr: any) {
        console.warn(`[CV] Pipeline pulado por erro: ${cvErr?.message || cvErr}`);
        sendProgress(projectId, 3.4, "CV Pipeline (Fase E)", "done", `pulado (erro: ${cvErr?.message || "desconhecido"})`);
      }

      // ===== Etapa 3.5 — Inventario de paredes com endpoints (Fase B / S4) =====
      // Roda APOS a Etapa 3 monolitica e enriquece cada parede ja extraida
      // com endpoints (p1, p2) — o EIXO real do segmento da parede. Isso
      // permite (a) o renderer desenhar uma linha sobre a parede em vez
      // de retangulo, e (b) a topologia em S5 usar o midpoint REAL do
      // segmento e a direcao para derivar os pontos de teste ortogonais.
      // Falha aqui NAO impede o resto do pipeline (graceful degrade).
      try {
        const wallsForInventory = allGeometries.flatMap(g => g.walls);
        if (wallsForInventory.length > 0) {
          sendProgress(projectId, 3.5, "Inventario (endpoints)", "running", "Detectando eixos das paredes...");
          const invSources = await getAnnotationImageSources(files, allClassifications);
          if (invSources.length > 0) {
            const inv = await inventoryWalls({
              projectId,
              pages: invSources.map(s => ({
                pageIndex: s.pageIndex,
                pavimento: s.pavimento,
                base64: s.base64,
                mimeType: s.mimeType,
              })),
            });
            if (inv.segments.length > 0) {
              const enrichedCount = mergeEndpointsIntoWalls(wallsForInventory, inv.segments);
              sendProgress(
                projectId, 3.5, "Inventario (endpoints)", "done",
                `${enrichedCount} de ${wallsForInventory.length} paredes ganharam endpoints (de ${inv.segments.length} segmentos detectados)`,
              );
              console.log(`[INVENTARIO] Match: ${enrichedCount}/${wallsForInventory.length} paredes; ${inv.segments.length} segmentos detectados.`);
            } else {
              sendProgress(projectId, 3.5, "Inventario (endpoints)", "done", "Inventario nao retornou segmentos");
            }
          }
        }
      } catch (invErr: any) {
        console.warn(`[INVENTARIO] Pulado por erro: ${invErr?.message || invErr}`);
        sendProgress(projectId, 3.5, "Inventario (endpoints)", "done", `pulado (erro: ${invErr?.message || "desconhecido"})`);
      }

      // ===== Etapa 3.6 — Leitura focada de cotas (Fase B / S7) =====
      // Pede ao Gemini APENAS para listar todas as cotas anotadas na planta
      // (texto numerico + posicao). Depois codigo deterministico associa cada
      // cota a parede compativel pela direcao + proximidade. Quando casa,
      // sobrescreve comprimento_m com measurement_source="cota_text_focused".
      try {
        const wallsForCotas = allGeometries.flatMap(g => g.walls);
        if (wallsForCotas.length > 0) {
          sendProgress(projectId, 3.6, "Cotas (focado)", "running", "Lendo cotas dimensionais da planta...");
          const cotaSources = await getAnnotationImageSources(files, allClassifications);
          if (cotaSources.length > 0) {
            const cotas = await readCotas({
              projectId,
              pages: cotaSources.map(s => ({
                pageIndex: s.pageIndex,
                pavimento: s.pavimento,
                base64: s.base64,
                mimeType: s.mimeType,
              })),
            });
            const totalCotas = Array.from(cotas.byPavimento.values()).reduce((s, arr) => s + arr.length, 0);
            if (totalCotas > 0) {
              const match = mergeCotasIntoWalls(wallsForCotas, cotas.byPavimento);
              sendProgress(
                projectId, 3.6, "Cotas (focado)", "done",
                `${totalCotas} cota(s) lidas; ${match.matched} parede(s) atualizadas; ${match.unmatched} sem match`,
              );
              console.log(`[COTAS] ${match.matched}/${wallsForCotas.length} paredes atualizadas com cotas focadas.`);
            } else {
              sendProgress(projectId, 3.6, "Cotas (focado)", "done", "Nenhuma cota detectada");
            }
          }
        }
      } catch (cotaErr: any) {
        console.warn(`[COTAS] Pulado por erro: ${cotaErr?.message || cotaErr}`);
        sendProgress(projectId, 3.6, "Cotas (focado)", "done", `pulado (erro: ${cotaErr?.message || "desconhecido"})`);
      }

      // ===== Etapa 3.7 — Topologia (envelope + classificacao deterministica) =====
      // Metodologia passo-a-passo, Fase A:
      // (S2) Pede ao Gemini APENAS o poligono da edificacao coberta — sem mistura
      //      com classificacao/cotas/etc. Prompt curto + thinking budget alto.
      // (S5) Classifica cada parede por point-in-polygon contra o envelope.
      //      Determinıstico, sem IA — verdade topologica, nao "achismo" do LLM.
      // (S6) floorSideHints humanos podem corrigir antes de aplicar.
      // Pulado silenciosamente quando nao ha plantas baixas (ex: so IFC).
      let envelopes: EnvelopePolygon[] = [];
      try {
        const wallsPreTopology = allGeometries.flatMap(g => g.walls);
        if (wallsPreTopology.length > 0) {
          sendProgress(projectId, 3.7, "Topologia", "running", "Extraindo envelope da edificacao por pavimento...");
          // Reusa o mesmo extrator de fontes que a renderizacao usa — entrega
          // 1 imagem por pavimento (planta_baixa) ja na resolucao certa.
          const envelopeSources = await getAnnotationImageSources(files, allClassifications);
          if (envelopeSources.length > 0) {
            envelopes = await extractEnvelopes({
              projectId,
              pages: envelopeSources.map(s => ({
                pageIndex: s.pageIndex,
                pavimento: s.pavimento,
                base64: s.base64,
                mimeType: s.mimeType,
              })),
              formaHint: characterization?.caracteristicas.formaEnvelopePrincipal,
            });
          }

          if (envelopes.length === 0) {
            sendProgress(projectId, 3.7, "Topologia", "done", "Nenhum envelope detectado — pulando reclassificacao topologica");
          } else {
            sendProgress(
              projectId, 3.7, "Topologia", "running",
              `${envelopes.length} envelope(s) detectado(s). Reclassificando paredes por point-in-polygon...`,
            );
            const topo = classifyWallsByTopology(wallsPreTopology, envelopes);
            const wallById = new Map(wallsPreTopology.map(w => [w.id, w]));
            for (const c of topo.classifications) {
              const w = wallById.get(c.wallId);
              if (!w) continue;
              if (w.classe !== c.classe) {
                w.aiClasse = w.classe;
              }
              w.classe = c.classe;
              w.topologyReason = c.reason;
              if (c.needsReview) {
                w.needs_review = true;
                w.review_reason = `topologia: ${c.reason}`;
              }
            }
            // Persistir envelopes para a UI poder mostrar e o usuario auditar.
            await storage.addExtractedData({
              projectId,
              elementType: "envelopes",
              data: { envelopes },
              hasAssumption: 0,
            });
            sendProgress(
              projectId, 3.7, "Topologia", "done",
              `${topo.classifications.length} paredes classificadas, ${topo.reclassified} reclassificadas, ${topo.skipped} sem envelope/bbox`,
            );
            console.log(
              `[TOPOLOGIA] ${envelopes.length} envelope(s); ${topo.classifications.length} paredes processadas; ` +
              `${topo.reclassified} mudaram de classe; ${topo.skipped} sem dado para classificar.`,
            );
          }
        }
      } catch (envErr: any) {
        // Falha aqui NAO derruba a pipeline — apenas mantemos a classe da IA.
        console.warn(`[TOPOLOGIA] Pulada por erro: ${envErr?.message || envErr}`);
        sendProgress(projectId, 3.7, "Topologia", "done", `pulada (erro: ${envErr?.message || "desconhecido"})`);
      }

      // ===== Etapa 3.8 — Refino de lajes (Fase B / S10) =====
      // Usa o poligono do envelope como poligono da laje piso (e da coberta
      // em casas terreas). Quando bem-sucedido, marca measurement_source=
      // "polygon_focused" nas lajes correspondentes. Sem chamada Gemini extra.
      try {
        if (envelopes.length > 0) {
          sendProgress(projectId, 3.8, "Lajes (polygon)", "running", "Refinando lajes pelo envelope...");
          const pisoSlabs = derivePisoSlabsFromEnvelopes(envelopes);
          const slabsForRefine = allGeometries.flatMap(g => g.slabs);
          if (pisoSlabs.length > 0 && slabsForRefine.length > 0) {
            const r = mergeSlabPolygons(slabsForRefine, pisoSlabs);
            sendProgress(
              projectId, 3.8, "Lajes (polygon)", "done",
              `${r.refined} de ${slabsForRefine.length} lajes refinadas com poligono do envelope`,
            );
          } else {
            sendProgress(projectId, 3.8, "Lajes (polygon)", "done", "sem dados para refinar");
          }
        }
      } catch (slabErr: any) {
        console.warn(`[LAJES] Refino pulado por erro: ${slabErr?.message || slabErr}`);
        sendProgress(projectId, 3.8, "Lajes (polygon)", "done", `pulado (erro: ${slabErr?.message || "desconhecido"})`);
      }

      sendProgress(projectId, 4, "Fusao Multivista", "running", "Cruzando dados de todas as paginas...");
      const hasTableData = mergedTableData.paredes_de_tabela.length > 0 || mergedTableData.esquadrias_de_tabela.length > 0;
      // Carrega feedbacks humanos ativos com clientName do projeto que originou cada feedback.
      // O engine fara escopo por cliente atual (anti-poisoning cross-tenant): exemplares
      // curados por admin valem global; correcoes/not_wall so valem dentro do mesmo cliente.
      let wallFeedbacksForFusion: any[] = [];
      let currentProjectClient: string | null = null;
      try {
        const curProject = await storage.getProject(projectId);
        currentProjectClient = curProject?.clientName ?? null;
        const fbRows = await storage.getActiveWallFeedbackWithClient();
        wallFeedbacksForFusion = fbRows.map(r => ({
          espessuraBucketCm: r.espessuraBucketCm,
          comprimentoBucketDm: r.comprimentoBucketDm,
          hasWindow: r.hasWindow,
          hasDoor: r.hasDoor,
          originalClasse: r.originalClasse,
          correctedClasse: r.correctedClasse,
          action: r.action,
          isExemplar: r.isExemplar,
          clientName: r.clientName,
          userId: r.userId,
        }));
        if (wallFeedbacksForFusion.length > 0) {
          console.log(`[FEEDBACK] Carregados ${wallFeedbacksForFusion.length} feedback(s) ativo(s); escopo cliente=${currentProjectClient ?? "(nenhum)"}`);
        }
      } catch (fbErr) {
        console.warn("[FEEDBACK] Falha ao carregar feedbacks:", fbErr);
      }
      // Carrega side hints humanos pra este projeto (marcadores de lado exterior/interior).
      let sideHintsForFusion: any[] = [];
      try {
        const sh = await storage.getFloorSideHints(projectId);
        sideHintsForFusion = sh.map(h => ({
          pavimento: h.pavimento,
          xNorm: h.xNorm,
          yNorm: h.yNorm,
          side: h.side as "exterior" | "interior",
        }));
        if (sideHintsForFusion.length > 0) {
          console.log(`[SIDE_HINTS] Carregados ${sideHintsForFusion.length} marcador(es) pra este projeto`);
        }
      } catch (shErr) {
        console.warn("[SIDE_HINTS] Falha ao carregar marcadores:", shErr);
      }
      const fused = fusionMultiView(allGeometries, hasTableData ? mergedTableData : null, effectiveBuildingType(), wallFeedbacksForFusion, currentProjectClient, sideHintsForFusion);
      sendProgress(projectId, 4, "Fusao Multivista", "done", `${fused.walls.length} paredes, ${fused.slabs.length} lajes, ${fused.corners.length} cantos (apos deduplicacao)`);

      const maxThickRaw = await storage.getSetting("wall_thickness_max_m");
      const maxThickParsed = maxThickRaw ? parseFloat(maxThickRaw) : DEFAULT_MAX_WALL_THICKNESS_M;
      const maxThickness = Number.isFinite(maxThickParsed) && maxThickParsed > 0 ? maxThickParsed : DEFAULT_MAX_WALL_THICKNESS_M;
      const beforeCount = fused.walls.length;
      const removedThick = fused.walls.filter(w => (w.espessura_m || 0) > maxThickness);
      fused.walls = fused.walls.filter(w => (w.espessura_m || 0) <= maxThickness);
      if (removedThick.length > 0) {
        const thickMm = Math.round(maxThickness * 1000);
        const sample = removedThick.slice(0, 5).map(w => `${Math.round((w.espessura_m || 0) * 1000)}mm`).join(", ");
        console.log(`[WALL_FILTER] Removidas ${removedThick.length}/${beforeCount} paredes acima de ${thickMm}mm (provavel mobiliario/hatch). Amostra: ${sample}`);
        sendProgress(projectId, 4, "Fusao Multivista", "done", `${fused.walls.length} paredes apos filtro de espessura (${removedThick.length} acima de ${thickMm}mm removidas como mobiliario), ${fused.slabs.length} lajes`);
      }

      // ===== Geometric validators (plausibility filters) =====
      sendProgress(projectId, 4.5, "Validacao Geometrica", "running", "Removendo geometria implausivel...");
      const validated = validateGeometry(fused.walls, fused.slabs, fused.corners, { defaultPeDireitoM: peDireito });
      fused.walls = validated.walls;
      fused.slabs = validated.slabs;
      fused.corners = validated.corners;
      const valSummary = summarizeValidation(validated.stats);
      console.log(`[VALIDATOR] ${valSummary}`);
      for (const n of validated.stats.notes) console.log(`[VALIDATOR]   - ${n}`);
      sendProgress(projectId, 4.5, "Validacao Geometrica", "done", valSummary);

      // ===== Etapa 4.55 — Link esquadrias com quadro (Fase B / S8) =====
      // Cruza quadro_esquadrias com aberturas detectadas nas paredes:
      //  - Atualiza dimensoes de portas/janelas para os valores do quadro
      //    (ground truth, mais preciso que leitura visual).
      //  - Recalcula opening_area_m2 por parede.
      //  - Sinaliza needs_review quando ha porta/janela visual sem codigo
      //    OU quando aberturas excedem a area da parede.
      try {
        sendProgress(projectId, 4.55, "Esquadrias (linker)", "running", "Cruzando quadro de esquadrias com paredes...");
        const linkResult = linkEsquadriasWithTable(
          fused.walls,
          mergedTableData.esquadrias_de_tabela?.map(e => ({
            codigo: e.codigo,
            tipo: e.tipo,
            largura_m: e.largura_m,
            altura_m: e.altura_m,
            quantidade: e.quantidade,
          })),
        );
        sendProgress(
          projectId, 4.55, "Esquadrias (linker)", "done",
          `${linkResult.updated} parede(s) com dimensoes atualizadas; ${linkResult.unresolved} sem codigo; ${linkResult.conflicts} conflitos`,
        );
        console.log(`[ESQUADRIAS] updated=${linkResult.updated} unresolved=${linkResult.unresolved} conflicts=${linkResult.conflicts}`);
      } catch (esqErr: any) {
        console.warn(`[ESQUADRIAS] Linker pulado por erro: ${esqErr?.message || esqErr}`);
        sendProgress(projectId, 4.55, "Esquadrias (linker)", "done", `pulado (erro: ${esqErr?.message || "desconhecido"})`);
      }

      // ===== Etapa 4.65 — Reconciliacao CV ↔ LLM (Fase E.6) =====
      // Le cv_extraction (persistido pela Etapa 3.4) e reconcilia com as
      // paredes do LLM seguindo politica CONSERVADORA:
      //   - Match + mesma classe → confidence boost (+0.1).
      //   - Match + classe diferente → needs_review (sem sobrescrever).
      //   - CV detectou parede que LLM nao viu → audit_note ONLY_IN_CV (info).
      // LLM continua sendo source-of-truth do orcamento. Falha aqui NAO derruba.
      try {
        const extractedSoFar = await storage.getExtractedData(projectId);
        const cvExtractionRow = extractedSoFar.find((d: any) => d.elementType === "cv_extraction");
        const cvResults = (cvExtractionRow?.data as any)?.results;
        if (Array.isArray(cvResults) && cvResults.length > 0) {
          sendProgress(projectId, 4.65, "Reconciliacao CV-LLM", "running", "Cruzando paredes CV vs LLM...");
          const recon = reconcileCvWithLlm(fused.walls as any, cvResults);

          // Anexa alertNotes ao audit_notes ja existente (ou cria).
          if (recon.alertNotes.length > 0) {
            const existing = extractedSoFar.find((d: any) => d.elementType === "audit_notes");
            const prevNotes: any[] = (existing?.data as any)?.notes || [];
            const allNotes = [...prevNotes, ...recon.alertNotes];
            await storage.addExtractedData({
              projectId,
              elementType: "audit_notes",
              data: {
                notes: allNotes,
                summary: {
                  total: allNotes.length,
                  info: allNotes.filter((n: any) => n.severity === "info").length,
                  warning: allNotes.filter((n: any) => n.severity === "warning").length,
                  error: allNotes.filter((n: any) => n.severity === "error").length,
                },
              },
              hasAssumption: 0,
            });
          }

          sendProgress(
            projectId, 4.65, "Reconciliacao CV-LLM", "done",
            `${recon.matched} concordancias, ${recon.disagreed} divergencias, ` +
            `${recon.onlyLlm} so LLM, ${recon.onlyCv} so CV`,
          );
        } else {
          sendProgress(projectId, 4.65, "Reconciliacao CV-LLM", "done", "sem cv_extraction (cv-service offline) — pulando");
        }
      } catch (rcErr: any) {
        console.warn(`[CV-RECONCILE] Pulada por erro: ${rcErr?.message || rcErr}`);
        sendProgress(projectId, 4.65, "Reconciliacao CV-LLM", "done", `pulada (erro: ${rcErr?.message || "desconhecido"})`);
      }

      // ===== Global cross-validation pass (Etapa 4.6) — opt-in =====
      // Sends ALL planta_baixa pages + the fused JSON to the AI in a single
      // conversational call. Catches duplicates / missing walls / unit errors
      // that per-page extraction misses. Conservative: corrections only applied
      // when AI confidence >= 0.7. Disabled by default; enable via
      // project.settings.useGlobalValidation = true OR ?globalValidation=1.
      const globalValidationFlag = (project as any).settings?.useGlobalValidation === true
        || req.query.globalValidation === "1";
      if (globalValidationFlag) {
        try {
          sendProgress(projectId, 4.6, "Validacao Global IA", "running", "Cross-validando com IA contra todas as plantas...");
          const sources = await getAnnotationImageSources(files, allClassifications);
          const plantaImages = sources.map(s => ({ base64: s.base64, mimeType: s.mimeType }));
          const gvResult = await runGlobalCrossValidation(fused.walls, fused.slabs, plantaImages, { projectId });
          // CRITICAL: re-run validateGeometry after AI corrections so any
          // edge case (e.g., a corrected length crossing a different rule like
          // floating walls / slab loops) is still caught by the same plausibility
          // ruleset that protects the rest of the pipeline. AI is an assistant,
          // not the final authority.
          if (gvResult.applied.walls + gvResult.applied.slabs + gvResult.applied.removedWalls + gvResult.applied.removedSlabs > 0) {
            const reval = validateGeometry(fused.walls, fused.slabs, fused.corners, { defaultPeDireitoM: peDireito });
            fused.walls = reval.walls;
            fused.slabs = reval.slabs;
            fused.corners = reval.corners;
            const revalSummary = summarizeValidation(reval.stats);
            console.log(`[GLOBAL-VALIDATOR] Re-validacao apos correcoes IA: ${revalSummary}`);
          }
          const gvDetail = gvResult.confidence > 0
            ? `conf ${gvResult.confidence.toFixed(2)}: +${gvResult.applied.walls} paredes, +${gvResult.applied.slabs} lajes, -${gvResult.applied.removedWalls + gvResult.applied.removedSlabs} removidos | ${gvResult.summary}`
            : gvResult.summary;
          sendProgress(projectId, 4.6, "Validacao Global IA", "done", gvDetail);
        } catch (gvErr: any) {
          console.warn(`[GLOBAL-VALIDATOR] Pulando (erro): ${gvErr?.message || gvErr}`);
          sendProgress(projectId, 4.6, "Validacao Global IA", "done", `pulado (erro: ${gvErr?.message || "desconhecido"})`);
        }
      }

      // ===== Task #9: Validacao por cortes (Etapa 4.7) =====
      // Le paginas classificadas como "corte" e extrai pe-direito por pavimento.
      // Aplica como ground-truth de altura nas paredes do pavimento correspondente,
      // marca confirmed_by_section=true, e marca pavimentos multi-andar SEM corte
      // como needs_section_confirmation. Pulado silenciosamente se nao houver corte.
      try {
        // Task #9: aceita "corte" e "fachada" (elevacao) como fontes verticais
        // para extrair pe-direito. Ambas mostram alturas anotadas, embora cortes
        // sejam mais ricos por mostrarem multiplos pavimentos empilhados.
        const isVerticalView = (c: PageClassification) => c.classificacao === "corte" || c.classificacao === "fachada";
        const hasVertical = allClassifications.some(isVerticalView);
        if (hasVertical) {
          sendProgress(projectId, 4.7, "Validacao por Cortes", "running", "Extraindo alturas dos cortes/fachadas...");
          const allSections: import("./services/gemini/planAnalyzer").SectionInfo[] = [];
          for (const file of files) {
            const fileClassifications = classificationsByFile.get(String(file.id)) || [];
            if (fileClassifications.length === 0) continue;
            if (!fileClassifications.some(isVerticalView)) continue;
            const sectionFilePath = resolveProjectFilePath(file.filePath);
            if (!sectionFilePath) {
              console.warn(`[CORTE] Pulando ${file.originalName}: arquivo nao encontrado em disco`);
              continue;
            }
            const sections = await extractSectionInfo(sectionFilePath, file.fileType, fileClassifications);
            allSections.push(...sections);
          }
          const sectionResult = applySectionData(fused.walls, allSections);
          const detail = `${allSections.length} corte(s); ${sectionResult.heightsApplied} parede(s) c/ altura do corte; ${sectionResult.pavimentosConfirmed} pavimento(s) confirmado(s); ${sectionResult.pavimentosPending} pendente(s)`;
          console.log(`[CORTE] ${detail}`);
          sendProgress(projectId, 4.7, "Validacao por Cortes", "done", detail);
        }
      } catch (secErr: any) {
        console.warn(`[CORTE] Pulando validacao por cortes (erro): ${secErr?.message || secErr}`);
        sendProgress(projectId, 4.7, "Validacao por Cortes", "done", `pulado (erro: ${secErr?.message || "desconhecido"})`);
      }

      const scopedWalls = fused.walls.filter(w => {
        if (w.classe === "externa" && !scope.paredesExternas) return false;
        if (w.classe === "interna" && !scope.paredesInternas) return false;
        if (w.classe === "muro" && !scope.muros) return false;
        return true;
      });
      const scopedSlabs = fused.slabs.filter(s => {
        if ((s.classe === "piso" || s.classe === "radier") && !scope.lajePiso) return false;
        if (s.classe === "coberta" && !scope.lajeCoberta) return false;
        return true;
      });
      const scopedCorners = scope.cantos ? fused.corners : [];

      const scopeFiltered = [];
      if (!scope.paredesExternas) scopeFiltered.push("ext");
      if (!scope.paredesInternas) scopeFiltered.push("int");
      if (!scope.muros) scopeFiltered.push("muros");
      if (!scope.lajePiso) scopeFiltered.push("piso");
      if (!scope.lajeCoberta) scopeFiltered.push("coberta");
      if (!scope.cantos) scopeFiltered.push("cantos");
      if (scopeFiltered.length > 0) {
        console.log(`[PIPELINE] Escopo: filtradas categorias: ${scopeFiltered.join(", ")}`);
        sendProgress(projectId, 4, "Fusao Multivista", "done", `${fused.walls.length} paredes, ${fused.slabs.length} lajes → escopo: ${scopedWalls.length} paredes, ${scopedSlabs.length} lajes, ${scopedCorners.length} cantos`);
      }

      // Apply user pe-direito to walls without explicit height
      if (peDireito !== 3.0) {
        for (const w of scopedWalls) {
          if (!w.altura_m || w.altura_m <= 0) w.altura_m = peDireito;
        }
      }

      // ===== Etapa 4.9 — SelfCheck deterministico (Fase D / S12) =====
      // Rodada de validacoes cruzadas em codigo puro:
      //  - area de aberturas vs area da parede;
      //  - pe-direito plausivel; espessura razoavel;
      //  - razao externas:internas; envelope com vertices suficientes;
      //  - lajes piso vs coberta. Cada violacao vira audit_note persistida
      //  em extracted_data e mostrada na UI.
      try {
        const selfCheckResult = runSelfCheck({
          walls: fused.walls,
          slabs: fused.slabs,
          envelopes,
          buildingType: effectiveBuildingType(),
          characterization,
        });
        if (selfCheckResult.notes.length > 0) {
          await storage.addExtractedData({
            projectId,
            elementType: "audit_notes",
            data: { notes: selfCheckResult.notes, summary: selfCheckResult.summary },
            hasAssumption: 0,
          });
          // Emite cada nota como evento — UI mostra cards expansiveis na timeline.
          for (const note of selfCheckResult.notes) {
            emitAuditFinding({
              projectId,
              severity: note.severity,
              code: note.code,
              message: note.message,
              relatedIds: note.relatedIds,
              stage: "4.9",
            });
          }
        }
        const s = selfCheckResult.summary;
        console.log(`[SELFCHECK] ${s.total} notas (${s.error} erros, ${s.warning} avisos, ${s.info} info)`);
        sendProgress(
          projectId, 4.9, "SelfCheck", "done",
          `${s.total} nota(s): ${s.error} erro(s), ${s.warning} aviso(s), ${s.info} info`,
        );
      } catch (scErr: any) {
        console.warn(`[SELFCHECK] Pulado por erro: ${scErr?.message || scErr}`);
        sendProgress(projectId, 4.9, "SelfCheck", "done", `pulado (erro: ${scErr?.message || "desconhecido"})`);
      }

      sendProgress(projectId, 5, "Calculo de Quantitativos", "running", "Calculando paineis por pavimento...");
      const budget = calculateBudget(scopedWalls, scopedSlabs, scopedCorners);
      const pavNames = budget.pavimentos.map(p => p.nome).join(", ");
      sendProgress(projectId, 5, "Calculo de Quantitativos", "done", `${budget.resumo.total_geral_paineis} paineis total | Pavimentos: ${pavNames} | 2P=${budget.consolidado_por_tipo[0]?.quantidade_total_paineis}`);

      sendProgress(projectId, 6, "Integracao com Catalogo", "running", "Calculando custos no formato de proposta Lightwall...");
      const projectForPricing = await storage.getProject(projectId);
      const rawProducts = await storage.getProducts();
      const allProducts = await applyProfilePrices(rawProducts, projectForPricing?.pricingProfileId);
      if (projectForPricing?.pricingProfileId) {
        console.log(`[ETAPA6] Aplicando perfil de preco id=${projectForPricing.pricingProfileId}`);
      }
      const findPanel = (id: number | null) => id ? allProducts.find((p) => p.id === id && p.category === "painel") : null;
      const default2P = allProducts.find((p) => p.sku === "LW-2P-090") || null;
      const defaultSP = allProducts.find((p) => p.sku === "LW-SP-090") || default2P;

      const productExt = findPanel(selectedProductIdExt) || default2P;
      const productInt = findPanel(selectedProductIdInt) || defaultSP;
      const productMuros = findPanel(selectedProductIdMuros) || defaultSP || default2P;
      const productPiso = findPanel(selectedProductIdPiso) || default2P;
      const productCoberta = findPanel(selectedProductIdCoberta) || default2P;

      const pagProduct = allProducts.find((p) => p.sku === "PROJ-PAG");

      const AREA_PAINEL = 1.83;
      const PRECO_PAGINACAO_M2_PADRAO = 11;
      const priceOf = (p: any, fallback: number) => p ? parseFloat(p.unitPrice) : fallback;
      const nameOf = (p: any, fallback: string) => p?.name || fallback;

      const PRECO_M2_EXT = priceOf(productExt, 275);
      const PRECO_M2_INT = priceOf(productInt, 180);
      const PRECO_M2_MUROS = priceOf(productMuros, 180);
      const PRECO_M2_PISO = priceOf(productPiso, 275);
      const PRECO_M2_COBERTA = priceOf(productCoberta, 275);
      const PRECO_PAGINACAO_M2 = pagProduct ? parseFloat(pagProduct.unitPrice) : PRECO_PAGINACAO_M2_PADRAO;
      const PRODUCT_NAME_EXT = nameOf(productExt, "PAINEL DE CONCRETO LEVE 3000X610X90MM 2P");
      const PRODUCT_NAME_INT = nameOf(productInt, "PAINEL DE CONCRETO LEVE 3000X610X90MM SP");
      const PRODUCT_NAME_MUROS = nameOf(productMuros, "PAINEL DE CONCRETO LEVE 3000X610X90MM SP");
      const PRODUCT_NAME_PISO = nameOf(productPiso, "PAINEL DE CONCRETO LEVE 3000X610X90MM 2P");
      const PRODUCT_NAME_COBERTA = nameOf(productCoberta, "PAINEL DE CONCRETO LEVE 3000X610X90MM 2P");
      if (!pagProduct) console.warn("[ETAPA6] Produto PROJ-PAG nao encontrado, usando preco padrao R$ 11/m2");
      console.log(`[ETAPA6] Paineis: ext=${PRODUCT_NAME_EXT}@R$${PRECO_M2_EXT} | int=${PRODUCT_NAME_INT}@R$${PRECO_M2_INT} | muros=${PRODUCT_NAME_MUROS}@R$${PRECO_M2_MUROS} | piso=${PRODUCT_NAME_PISO}@R$${PRECO_M2_PISO} | coberta=${PRODUCT_NAME_COBERTA}@R$${PRECO_M2_COBERTA}`);

      const legacy = budgetToLegacy(budget);
      const extPanels = budget.resumo.paredes_externas.quantidade_paineis;
      const intPanels = budget.resumo.paredes_internas.quantidade_paineis;
      const murosPanels = budget.resumo.muros?.quantidade_paineis ?? 0;
      const pisoPanels = budget.resumo.laje_piso.quantidade_paineis;
      const cobertaPanels = budget.resumo.laje_coberta.quantidade_paineis;

      const extArea = Math.round(extPanels * AREA_PAINEL * 1000) / 1000;
      const intArea = Math.round(intPanels * AREA_PAINEL * 1000) / 1000;
      const murosArea = Math.round(murosPanels * AREA_PAINEL * 1000) / 1000;
      const pisoArea = Math.round(pisoPanels * AREA_PAINEL * 1000) / 1000;
      const cobertaArea = Math.round(cobertaPanels * AREA_PAINEL * 1000) / 1000;
      const totalAreaM2 = extArea + intArea + murosArea + pisoArea + cobertaArea;

      const extCost = Math.round(extArea * PRECO_M2_EXT * 100) / 100;
      const intCost = Math.round(intArea * PRECO_M2_INT * 100) / 100;
      const murosCost = Math.round(murosArea * PRECO_M2_MUROS * 100) / 100;
      const pisoCost = Math.round(pisoArea * PRECO_M2_PISO * 100) / 100;
      const cobertaCost = Math.round(cobertaArea * PRECO_M2_COBERTA * 100) / 100;
      const totalPanelCost = extCost + intCost + murosCost + pisoCost + cobertaCost;

      const paginacaoCost = Math.round(totalAreaM2 * PRECO_PAGINACAO_M2 * 100) / 100;
      const totalCost = totalPanelCost + paginacaoCost;

      const skuOf = (p: any, fallback: string) => p?.sku || fallback;
      const SKU_EXT = skuOf(productExt, "LW-2P-090");
      const SKU_INT = skuOf(productInt, "LW-SP-090");
      const SKU_MUROS = skuOf(productMuros, "LW-SP-090");
      const SKU_PISO = skuOf(productPiso, "LW-2P-090");
      const SKU_COBERTA = skuOf(productCoberta, "LW-2P-090");

      const propostaItens: Array<{ item: number; local: string; discriminacao: string; sku: string; qtd_un: number; qtd_m2: number; preco_m2: number; preco_total: number }> = [];
      let lineNo = 1;
      propostaItens.push({ item: lineNo++, local: "PAREDES EXTERNAS", discriminacao: PRODUCT_NAME_EXT, sku: SKU_EXT, qtd_un: extPanels, qtd_m2: extArea, preco_m2: PRECO_M2_EXT, preco_total: extCost });
      propostaItens.push({ item: lineNo++, local: "PAREDES INTERNAS", discriminacao: PRODUCT_NAME_INT, sku: SKU_INT, qtd_un: intPanels, qtd_m2: intArea, preco_m2: PRECO_M2_INT, preco_total: intCost });
      if (murosPanels > 0) {
        propostaItens.push({ item: lineNo++, local: "MUROS (DIVISA)", discriminacao: PRODUCT_NAME_MUROS, sku: SKU_MUROS, qtd_un: murosPanels, qtd_m2: murosArea, preco_m2: PRECO_M2_MUROS, preco_total: murosCost });
      }
      propostaItens.push({ item: lineNo++, local: "LAJE DE PISO", discriminacao: PRODUCT_NAME_PISO, sku: SKU_PISO, qtd_un: pisoPanels, qtd_m2: pisoArea, preco_m2: PRECO_M2_PISO, preco_total: pisoCost });
      propostaItens.push({ item: lineNo++, local: "LAJE COBERTA", discriminacao: PRODUCT_NAME_COBERTA, sku: SKU_COBERTA, qtd_un: cobertaPanels, qtd_m2: cobertaArea, preco_m2: PRECO_M2_COBERTA, preco_total: cobertaCost });
      const propostaPaginacao = { item: 1, discriminacao: "Projeto de Paginação", qtd_un: budget.resumo.total_geral_paineis, qtd_m2: totalAreaM2, preco_m2: PRECO_PAGINACAO_M2, preco_total: paginacaoCost };

      sendProgress(projectId, 6, "Integracao com Catalogo", "done", `5 categorias precificadas | Total: R$ ${totalCost.toFixed(2)}`);

      const connQty = Math.ceil(legacy.totals.totalPanels * 4);
      const screwQty = Math.ceil(legacy.totals.totalPanels * 8);
      const connector = allProducts.find((p) => p.sku === "CONN-001");
      const screw = allProducts.find((p) => p.sku === "PARA-001");
      const connectorCost = connQty * parseFloat(connector?.unitPrice ?? "12.5");
      const screwCost = screwQty * parseFloat(screw?.unitPrice ?? "2.8");
      const totalMaterialCost = connectorCost + screwCost;
      const laborHours = (legacy.totals.totalWallArea + legacy.totals.totalSlabArea) * 0.8;
      const laborCost = laborHours * 65;

      await storage.addExtractedData({
        projectId, fileId: null, elementType: "etapa6_catalogo",
        data: {
          etapa: 6, label: "Integracao com Catalogo",
          resultado: {
            proposta: { itens: propostaItens, total_paineis: totalPanelCost, total_area_m2: totalAreaM2, total_paineis_un: budget.resumo.total_geral_paineis },
            paginacao: propostaPaginacao,
            custo_total_proposta: totalCost,
            complementar: {
              materiais: { conectores: { qtd: connQty, custo: connectorCost }, parafusos: { qtd: screwQty, custo: screwCost }, total: totalMaterialCost },
              mao_de_obra: { horas: laborHours, taxa_hora: 65, total: laborCost },
            },
          },
        },
        hasAssumption: 0,
      });

      sendProgress(projectId, 7, "Validacao", "running", "Verificando inconsistencias...");
      const alerts = inconsistenciasToAlerts(budget.inconsistencias);
      const critCount = budget.inconsistencias.filter(i => i.severidade === "Critica").length;
      const medCount = budget.inconsistencias.filter(i => i.severidade === "Media").length;
      const lowCount = budget.inconsistencias.filter(i => i.severidade === "Baixa").length;
      sendProgress(projectId, 7, "Validacao", "done", `${budget.inconsistencias.length} inconsistencias (${critCount} criticas, ${medCount} medias, ${lowCount} baixas)`);

      await storage.addExtractedData({
        projectId, fileId: null, elementType: "etapa1_classificacoes",
        data: { etapa: 1, label: "Classificacao de Paginas", resultado: allClassifications },
        hasAssumption: 0,
      });
      await storage.addExtractedData({
        projectId, fileId: null, elementType: "etapa2_tabelas",
        data: { etapa: 2, label: "Extracao de Tabelas", resultado: mergedTableData },
        hasAssumption: 0,
      });
      await storage.addExtractedData({
        projectId, fileId: null, elementType: "etapa3_geometria_bruta",
        data: {
          etapa: 3, label: "Extracao Geometrica (antes da fusao)",
          resultado: allGeometries.map((g, i) => ({
            arquivo_index: i,
            paredes: g.walls.length,
            lajes: g.slabs.length,
            cantos: g.corners.length,
            walls: g.walls,
            slabs: g.slabs,
            corners: g.corners,
          })),
        },
        hasAssumption: 0,
      });
      const fusaoWallsWithScope = fused.walls.map(w => ({
        ...w,
        enabled: (w.classe === "externa" && !scope.paredesExternas) || (w.classe === "interna" && !scope.paredesInternas) || (w.classe === "muro" && !scope.muros) ? false : true,
      }));
      const fusaoSlabsWithScope = fused.slabs.map(s => ({
        ...s,
        enabled: ((s.classe === "piso" || s.classe === "radier") && !scope.lajePiso) || (s.classe === "coberta" && !scope.lajeCoberta) ? false : true,
      }));
      const fusaoCornersWithScope = fused.corners.map(c => ({
        ...c,
        enabled: scope.cantos,
      }));
      // Fase E.0/Bugfix #3: atribui displayLabel GLOBAL (W001..Wn / M001..Mn /
      // L001..Ln) ANTES de persistir, para que o cliente possa exibir a
      // numeracao consistente no Resumo do Levantamento sem precisar
      // recalcular. assignDisplayLabels muta em lugar.
      assignDisplayLabels(fusaoWallsWithScope, fusaoSlabsWithScope);
      await storage.addExtractedData({
        projectId, fileId: null, elementType: "etapa4_fusao",
        data: {
          etapa: 4, label: "Fusao Multivista (apos deduplicacao)",
          resultado: { walls: fusaoWallsWithScope, slabs: fusaoSlabsWithScope, corners: fusaoCornersWithScope },
          scope,
        },
        hasAssumption: 0,
      });

      // PARALLELIZED: fire description AI call EARLY so it runs concurrently
      // with the entire Etapa 4.5 annotation block below. The description only
      // depends on budget data + file paths — both already computed. We attach
      // .catch() immediately to prevent unhandled rejection if intermediate steps
      // throw and the promise is never awaited.
      const nonIfcFiles = files.filter(f => f.fileType !== "ifc");
      const ifcOnly = nonIfcFiles.length === 0 && files.length > 0;
      const filePaths = nonIfcFiles.map(f => ({ path: f.filePath, fileType: f.fileType, name: f.originalName }));
      const geometrySummary = {
        wallCount: fused.walls.length,
        slabCount: fused.slabs.length,
        cornerCount: fused.corners.length,
        floors: budget.pavimentos.map((p: any) => p.nome),
      };
      const budgetSummaryForDesc = {
        totalPanels: budget.resumo.total_geral_paineis,
        totalCost: totalCost,
        floors: budget.pavimentos.map((p: any) => ({
          name: p.nome,
          panels: p.paredes_externas.quantidade_paineis + p.paredes_internas.quantidade_paineis + p.laje_piso.quantidade_paineis + p.laje_coberta.quantidade_paineis,
        })),
      };

      const descriptionPromise = (async (): Promise<{ text: string; failed: boolean }> => {
        if (ifcOnly) {
          sendProgress(projectId, 8, "Descricao do Projeto", "running", "Gerando resumo do modelo IFC (sem IA)...");
          const text = buildIfcDeterministicDescription(files.length, budget, geometrySummary, totalCost);
          sendProgress(projectId, 8, "Descricao do Projeto", "done", "Resumo gerado a partir do modelo BIM.");
          return { text, failed: false };
        }
        sendProgress(projectId, 8, "Descricao do Projeto", "running", "A IA esta analisando profundamente as imagens para descrever o projeto...");
        const descModel = providerForRun === "openai" ? `openai:${getOpenAIModelName()}` : "gemini-2.5-pro";
        const text = await auditAiCall(
          {
            projectId,
            promptVersion: "describeProject_v1",
            model: descModel,
            inputSummary: `files=${filePaths.length} pages=${allClassifications.length}`,
          },
          () => describeProject(filePaths, allClassifications, geometrySummary, budgetSummaryForDesc, characterization),
          (out: any) => ({ length: typeof out === "string" ? out.length : 0 }),
        );
        const failed = text.startsWith("Nao foi possivel");
        if (failed) {
          sendProgress(projectId, 8, "Descricao do Projeto", "error", "Falha ao gerar descricao automatica. O orcamento foi calculado normalmente.");
        } else {
          sendProgress(projectId, 8, "Descricao do Projeto", "done", text.substring(0, 150) + "...");
        }
        return { text, failed };
      })().catch((err: any) => {
        console.error(`[DESCRICAO] Erro na descricao paralela: ${err?.message || err}`);
        sendProgress(projectId, 8, "Descricao do Projeto", "error", "Falha ao gerar descricao automatica.");
        return { text: "Nao foi possivel gerar descricao automatica.", failed: true };
      });

      // ===== Step 4.5: Auto-generate annotated floor plan images (one per floor) =====
      try {
        const totalWalls = fusaoWallsWithScope.filter((w: any) => w.enabled !== false);
        const totalSlabs = fusaoSlabsWithScope.filter((s: any) => s.enabled !== false);
        const summaryAll = {
          externas: totalWalls.filter((w: any) => w.classe === "externa").length,
          internas: totalWalls.filter((w: any) => w.classe === "interna").length,
          muros: totalWalls.filter((w: any) => w.classe === "muro").length,
          lajePiso: totalSlabs.filter((s: any) => s.classe === "piso" || s.classe === "radier").length,
          lajeCoberta: totalSlabs.filter((s: any) => s.classe === "coberta").length,
        };

        // Annotated images of the planta_baixa pages (the ones that actually
        // need wall/slab overlays). Reference images of OTHER plan types
        // (cortes, fachadas, planta_cobertura, detalhes, quadros) are gathered
        // separately and shown in the UI as a parallel section. This guarantees
        // the AI annotator only paints over floor plans it can understand,
        // while still surfacing the rest of the project to the user.
        let annotatedImages: Array<{ pavimento: string; pageIndex: number; image: string; summary: any }> = [];
        let annotationSource: "ia" | "none" = "none";
        // Erros por pavimento — exibidos na UI quando o card "Planta Anotada" nao
        // consegue ser renderizado. Persistidos junto com etapa3_annotated_plan.
        const annotationErrors: Array<{ pavimento: string; pageIndex: number; error: string }> = [];

        {
          // Renderizacao DETERMINISTICA (sharp + SVG) no servidor. Substitui a
          // antiga IA de edicao de imagem (editImage/buildAnnotationPrompt) que
          // gerava anotacoes inconsistentes (IDs duplicados, retangulos em
          // comodos, unidades misturadas). Custo zero, ~100-500ms por pavimento.
          sendProgress(projectId, 7.5, "Imagem Anotada", "running", "Renderizando anotacoes (servidor, sem IA)...");

          // Atribui rotulos globais UMA UNICA VEZ antes do loop, garantindo que
          // W001..Wn sejam unicos em todo o projeto.
          assignDisplayLabels(fusaoWallsWithScope, fusaoSlabsWithScope);

          const imgSources = await getAnnotationImageSources(files, allClassifications);
          const annotationJobs = imgSources.map(src => {
            const floorWalls = fusaoWallsWithScope.filter((w: any) =>
              src.pavimento === "all" || w.nivel === src.pavimento
            );
            const floorSlabs = fusaoSlabsWithScope.filter((s: any) =>
              src.pavimento === "all" || s.nivel === src.pavimento
            );
            const enabledFloorWalls = floorWalls.filter((w: any) => w.enabled !== false);
            const enabledFloorSlabs = floorSlabs.filter((s: any) => s.enabled !== false);
            if (enabledFloorWalls.length === 0 && enabledFloorSlabs.length === 0) return null;
            return { src, floorWalls, floorSlabs, enabledFloorWalls, enabledFloorSlabs };
          }).filter((j): j is NonNullable<typeof j> => j !== null);

          const annotationResults = await Promise.allSettled(
            annotationJobs.map(async (job) => {
              // Emit started per pavimento — antes a Promise.allSettled era
              // silenciosa ate todas terminarem; agora a UI pode mostrar grid
              // ao vivo conforme cada imagem fica pronta.
              emitImageRender({
                projectId,
                pavimento: job.src.pavimento,
                pageIndex: job.src.pageIndex,
                phase: "started",
              });
              try {
                const baseBuffer = Buffer.from(job.src.base64, "base64");
                const env = envelopes.find(
                  e => e.pavimento === job.src.pavimento ||
                       (job.src.pavimento === "all" && envelopes.length === 1),
                );
                const { pngBuffer } = await renderAnnotatedImage(
                  baseBuffer,
                  job.src.mimeType,
                  job.src.pageIndex,
                  job.enabledFloorWalls,
                  job.enabledFloorSlabs,
                  {
                    pavimentoLabel: job.src.pavimento === "all" ? "" : `Pavimento: ${job.src.pavimento}`,
                    envelopePolygon: env?.polygon,
                    lotPolygon: env?.lotPolygon,
                  },
                );
                const dataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
                console.log(`[ETAPA 4.5] Anotada ${job.src.pavimento} pg ${job.src.pageIndex}: ${Math.round(dataUrl.length / 1024)}KB`);
                emitImageRender({
                  projectId,
                  pavimento: job.src.pavimento,
                  pageIndex: job.src.pageIndex,
                  phase: "completed",
                  imageUrl: dataUrl,
                  byteSize: pngBuffer.length,
                });
                return {
                  pavimento: job.src.pavimento,
                  pageIndex: job.src.pageIndex,
                  image: dataUrl,
                  summary: {
                    externas: job.enabledFloorWalls.filter((w: any) => w.classe === "externa").length,
                    internas: job.enabledFloorWalls.filter((w: any) => w.classe === "interna").length,
                    muros: job.enabledFloorWalls.filter((w: any) => w.classe === "muro").length,
                    lajePiso: job.enabledFloorSlabs.filter((s: any) => s.classe === "piso" || s.classe === "radier").length,
                    lajeCoberta: job.enabledFloorSlabs.filter((s: any) => s.classe === "coberta").length,
                  },
                };
              } catch (err: any) {
                emitImageRender({
                  projectId,
                  pavimento: job.src.pavimento,
                  pageIndex: job.src.pageIndex,
                  phase: "failed",
                  errorMessage: err?.message || String(err),
                });
                throw err;
              }
            }),
          );
          // Captura erros por pavimento pra UI dar visibilidade (Parte 1 do bugfix).
          // Antes, era so console.error e o usuario nunca via — caia silenciosamente
          // no fallback de "Outras Vistas".
          for (let i = 0; i < annotationResults.length; i++) {
            const r = annotationResults[i];
            const job = annotationJobs[i];
            if (r.status === "fulfilled") {
              annotatedImages.push(r.value);
            } else {
              const reason = (r as PromiseRejectedResult).reason;
              const errMsg = reason?.message || String(reason);
              console.error(`[ETAPA 4.5] Falha pavimento "${job.src.pavimento}" pg ${job.src.pageIndex}:`, errMsg);
              annotationErrors.push({
                pavimento: job.src.pavimento,
                pageIndex: job.src.pageIndex,
                error: errMsg,
              });
            }
          }
          // Tambem detecta quando o filtro eliminou TODOS os jobs antes do render.
          // (Acontece quando walls/slabs nao casam com pavimento das imagens, ou
          // quando todos os escopos estao desligados.)
          if (annotationJobs.length === 0 && imgSources.length > 0) {
            for (const src of imgSources) {
              const reason =
                fusaoWallsWithScope.length === 0 && fusaoSlabsWithScope.length === 0
                  ? "Nenhuma parede ou laje extraida — Etapa 3 nao produziu resultado utilizavel"
                  : `Nenhuma parede/laje habilitada no pavimento "${src.pavimento}" — verifique escopo e classificacao por pavimento`;
              annotationErrors.push({
                pavimento: src.pavimento,
                pageIndex: src.pageIndex,
                error: reason,
              });
            }
            console.error(`[ETAPA 4.5] annotationJobs vazio (${imgSources.length} fontes mas nenhuma com walls/slabs habilitados)`);
          }
          if (annotatedImages.length > 0) annotationSource = "ia";
        }

        // ===== Always extract reference images for OTHER plan types =====
        // This runs for every mode (gemini-only, openai-only,
        // openai-vision-takeoff) because the user explicitly asked that "outras partes"
        // (cortes, fachadas, planta_cobertura, detalhes, quadros) get
        // separate visualizations. We embed them as PDF-page data URLs and let
        // the frontend render them via PdfViewer.
        //
        // Additionally, when AI annotation produced ZERO images (e.g.
        // openai-only mode without a Gemini key, or AI failure), we also
        // include the planta_baixa pages as reference so the user never loses
        // sight of their floor plans.
        let referenceImages: Array<{
          kind: "reference"; pageType: string; pageTypeLabel: string;
          pageIndex: number; pavimento?: string;
          image: string; mimeType: string;
        }> = [];
        try {
          const refSources = await getReferencePageSources(files, allClassifications);
          referenceImages = refSources.map(src => ({
            kind: "reference" as const,
            pageType: src.pageType,
            pageTypeLabel: pageTypeLabel(src.pageType),
            pageIndex: src.pageIndex,
            pavimento: src.pavimento,
            image: `data:${src.mimeType};base64,${src.base64}`,
            mimeType: src.mimeType,
          }));

          if (annotatedImages.length === 0) {
            const fallbackSources = await getAnnotationImageSources(files, allClassifications);
            for (const src of fallbackSources) {
              if (src.pavimento === "all" && src.pageIndex === 0 && fallbackSources.length === 1) {
                // Pure image upload fallback — already a single image, not really a planta_baixa classification.
                continue;
              }
              referenceImages.unshift({
                kind: "reference" as const,
                pageType: "planta_baixa",
                pageTypeLabel: pageTypeLabel("planta_baixa"),
                pageIndex: src.pageIndex,
                pavimento: src.pavimento,
                image: `data:${src.mimeType};base64,${src.base64}`,
                mimeType: src.mimeType,
              });
            }
          }

          if (referenceImages.length > 0) {
            console.log(`[ETAPA 4.5] ${referenceImages.length} imagem(ns) de referencia (outras vistas) extraida(s)`);
          }
        } catch (refError: any) {
          console.error(`[ETAPA 4.5] Falha ao extrair imagens de referencia:`, refError?.message);
        }

        // ===== Persist annotated + reference together (single record) =====
        if (annotatedImages.length > 0 || referenceImages.length > 0) {
          const sourceFileId = files.find((f: any) => f.fileType === "image" || /\.(png|jpe?g|webp)$/i.test(f.originalName || ""))?.id
            || files.find((f: any) => f.fileType === "pdf")?.id
            || null;
          const labelByMode = annotationSource === "ia"
            ? "Imagem Anotada (auto-gerada)"
            : "Vistas de Referencia";

          // Compress every image before persisting. Raw PNG base64 from PDFs
          // and OpenAI image edits can be 3-8MB each; storing several of
          // them as a single JSONB row triggers Neon serverless to abort
          // with code 08P01 ("Authentication timed out"). Re-encode to JPEG
          // ~1600px wide, quality 75 — perfectly fine for a UI preview.
          const sharp = (await import("sharp")).default;
          // Returns { dataUrl, mimeType } so the caller knows what was actually
          // produced — important for reference images that may be PDFs (kept
          // as-is) and need the right viewer on the frontend.
          const compressDataUrl = async (
            dataUrl: string,
          ): Promise<{ dataUrl: string; mimeType: string }> => {
            const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
            const origMime = m?.[1] || "image/png";
            // PDFs are not raster images — leave untouched so PdfViewer keeps working.
            if (origMime === "application/pdf") return { dataUrl, mimeType: origMime };
            if (!m) return { dataUrl, mimeType: origMime };
            try {
              const buf = Buffer.from(m[2], "base64");
              const out = await sharp(buf)
                .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
                .jpeg({ quality: 75, mozjpeg: true })
                .toBuffer();
              return {
                dataUrl: `data:image/jpeg;base64,${out.toString("base64")}`,
                mimeType: "image/jpeg",
              };
            } catch (cErr: any) {
              console.warn(`[ETAPA 4.5] Falha ao comprimir imagem (mime=${origMime}): ${cErr?.message}`);
              return { dataUrl, mimeType: origMime };
            }
          };
          const compressedAnnotated = await Promise.all(
            annotatedImages.map(async (img) => {
              const c = await compressDataUrl(img.image);
              return { ...img, image: c.dataUrl };
            }),
          );
          const compressedReference = await Promise.all(
            referenceImages.map(async (img) => {
              const c = await compressDataUrl(img.image);
              return { ...img, image: c.dataUrl, mimeType: c.mimeType };
            }),
          );

          const annotatedKB = compressedAnnotated.reduce((s, img) => s + Math.round(img.image.length / 1024), 0);
          const refKB = compressedReference.reduce((s, img) => s + Math.round(img.image.length / 1024), 0);
          const totalKB = annotatedKB + refKB;
          console.log(`[ETAPA 4.5] Payload comprimido: ${totalKB}KB (annotated=${annotatedKB}KB, ref=${refKB}KB)`);

          // Hard safety cap. JSONB inserts approaching ~10MB still risk a
          // Neon timeout; if we somehow exceed that even after compression,
          // drop reference images first, then drop the secondary annotated
          // images keeping only the cover.
          const MAX_PAYLOAD_KB = 8 * 1024;
          let finalAnnotated = compressedAnnotated;
          let finalReference = compressedReference;
          if (totalKB > MAX_PAYLOAD_KB) {
            console.warn(`[ETAPA 4.5] Payload ${totalKB}KB > ${MAX_PAYLOAD_KB}KB; reduzindo`);
            finalReference = [];
            if (finalAnnotated.length > 1) finalAnnotated = [finalAnnotated[0]];
          }

          try {
            await storage.addExtractedData({
              projectId, fileId: sourceFileId, elementType: "etapa3_annotated_plan",
              data: {
                etapa: 4.5,
                label: labelByMode,
                image: finalAnnotated[0]?.image,
                images: finalAnnotated,
                referenceImages: finalReference,
                summary: summaryAll,
                generatedAt: new Date().toISOString(),
                source: annotationSource,
                annotationErrors,  // Parte 1 do bugfix — visibilidade pra UI
              },
              hasAssumption: 0,
            });
            const parts: string[] = [];
            if (finalAnnotated.length > 0) parts.push(`${finalAnnotated.length} planta(s) anotada(s) (${annotatedKB}KB)`);
            if (finalReference.length > 0) parts.push(`${finalReference.length} vista(s) de referencia (${refKB}KB)`);
            sendProgress(projectId, 7.5, "Imagem Anotada", "done", parts.join(" + ") || "Nenhuma imagem gerada");
          } catch (storeErr: any) {
            console.error(`[ETAPA 4.5] Falha ao persistir imagens: ${storeErr?.message}`);
            sendProgress(projectId, 7.5, "Imagem Anotada", "done", `Imagens geradas mas nao persistidas (${storeErr?.message?.substring(0, 80) || "erro DB"})`);
          }
        } else {
          sendProgress(projectId, 7.5, "Imagem Anotada", "done", "Nenhum arquivo de planta encontrado para anotacao");
        }
      } catch (annotatedError: any) {
        console.error(`[ETAPA 4.5] Falha ao gerar imagem anotada:`, annotatedError);
        console.error(`[ETAPA 4.5] Stack:`, annotatedError?.stack);
        const errMsg = annotatedError?.message || String(annotatedError);
        sendProgress(projectId, 7.5, "Imagem Anotada", "done", `Falha: ${errMsg.substring(0, 150)}`);
      }

      await storage.addExtractedData({
        projectId, fileId: null, elementType: "etapa5_calculo",
        data: { etapa: 5, label: "Calculo de Quantitativos", resultado: budget },
        hasAssumption: 0,
      });
      await storage.addExtractedData({
        projectId, fileId: null, elementType: "etapa7_validacao",
        data: {
          etapa: 7, label: "Validacao",
          resultado: { inconsistencias: budget.inconsistencias, alertas: alerts },
        },
        hasAssumption: 0,
      });

      // Await the description promise that was fired BEFORE Etapa 4.5
      // (overlaps with annotation generation + reference image extraction).
      const { text: projectDescription, failed: descriptionFailed } = await descriptionPromise;

      await storage.addExtractedData({
        projectId, fileId: null, elementType: "descricao_projeto",
        data: { etapa: 8, label: "Descricao do Projeto pela IA", texto: projectDescription },
        hasAssumption: 0,
      });

      const materials = {
        complementaryMaterials: [
          { name: "Conectores metalicos", unit: "un", quantity: connQty, reference: "Manual Biomassa - Item 3.2" },
          { name: "Parafusos autoperfurantes", unit: "un", quantity: screwQty, reference: "Manual Biomassa - Item 3.3" },
          { name: "Fita de vedacao", unit: "m", quantity: Math.ceil(legacy.totals.totalPanels * 2), reference: "Manual Biomassa - Item 3.4" },
          { name: "Massa de vedacao", unit: "kg", quantity: Math.ceil(legacy.totals.totalPanels * 0.5), reference: "Manual Biomassa - Item 3.5" },
        ],
      };

      const apiMetrics = getApiMetrics(projectId);
      const reliability = computeReliabilityScore(apiMetrics);

      const budgetData = {
        quantitatives: legacy,
        materials,
        alerts,
        assumptions: [],
        totals: legacy.totals,
        budget7etapas: budget,
        projectDescription: projectDescription,
        proposta: {
          itens: propostaItens,
          totais_por_sku: computeTotaisPorSku(propostaItens),
          total_paineis_un: budget.resumo.total_geral_paineis,
          total_area_m2: totalAreaM2,
          total_paineis_cost: totalPanelCost,
          paginacao: propostaPaginacao,
          grandTotal: totalCost,
          preco_m2_ext: PRECO_M2_EXT,
          preco_m2_int: PRECO_M2_INT,
          painel_ext: PRODUCT_NAME_EXT,
          painel_int: PRODUCT_NAME_INT,
        },
        costs: {
          panels: { total: totalPanelCost },
          paginacao: { total: paginacaoCost },
          complementar: {
            materials: { items: materials.complementaryMaterials, total: totalMaterialCost },
            labor: { hours: laborHours, rate: 65, total: laborCost },
          },
          grandTotal: totalCost,
        },
        apiHealth: {
          metrics: apiMetrics,
          reliability,
          processedAt: new Date().toISOString(),
        },
      };

      console.log(`[PERSIST] createBudget: totalArea=${legacy.totals.totalWallArea + legacy.totals.totalSlabArea}, totalCost=${totalCost}`);
      try {
        await storage.createBudget({
          projectId,
          budgetData,
          totalArea: String(legacy.totals.totalWallArea + legacy.totals.totalSlabArea),
          totalCost: String(totalCost),
          status: "completed",
        });
        console.log(`[PERSIST] createBudget OK`);
      } catch (persistErr: any) {
        console.error(`[PERSIST] createBudget FALHOU:`, persistErr?.message, persistErr?.stack);
        throw persistErr;
      }

      await storage.updateProjectStatus(projectId, "completed");
      console.log(`[PERSIST] updateProjectStatus(completed) OK`);
      if (detectedBuildingType) {
        await storage.addExtractedData({
          projectId, fileId: null, elementType: "building_type_detection",
          data: {
            detected: detectedBuildingType,
            userProvided: userBuildingType || null,
            effective: effectiveBuildingType(),
            discordance: userBuildingType && detectedBuildingType !== userBuildingType ? true : false,
          },
          hasAssumption: 0,
        });
        if (!userBuildingType) {
          await storage.updateProject(projectId, { buildingType: detectedBuildingType });
        } else if (userBuildingType !== detectedBuildingType) {
          console.log(`[PIPELINE] Discordancia tipo edificacao: usuario=${userBuildingType}, detectado=${detectedBuildingType}. Mantendo tipo do usuario.`);
        }
      }
      cleanupApiMetrics(projectId);
      const failedInfo = pipelineFailedPages.length > 0 ? ` (${pipelineFailedPages.length} pagina(s) com erro parcial)` : "";
      sendProgress(projectId, 0, "Concluido", "done", `Pipeline finalizado com sucesso!${failedInfo}`);
      pipelineStartTimes.delete(projectId);

      res.json({
        message: "Projeto processado com sucesso",
        budget: budgetData,
      });
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      const isRateLimit = errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("rate");
      const isTimeout = errMsg.includes("timeout") || errMsg.includes("DEADLINE_EXCEEDED");
      const userMsg = isRateLimit
        ? "API sobrecarregada (limite de taxa atingido). Tente novamente em alguns minutos."
        : isTimeout
        ? "Tempo limite excedido na API. Tente novamente."
        : `Erro ao processar projeto: ${errMsg.substring(0, 150)}`;
      console.error("Erro ao processar projeto:", error);
      console.error("Stack:", error?.stack);
      sendProgress(projectId, 0, "Erro", "error", userMsg);
      pipelineStartTimes.delete(projectId);
      await storage.updateProjectStatus(projectId, "error");
      cleanupApiMetrics(projectId);
      res.status(500).json({ message: userMsg });
    }
    }); // end runWithProvider
  });

  app.put("/api/projects/:id", async (req, res) => {
    try {
      const projectId = parseInt(String(req.params.id));
      const { name, clientName, description, projectType, buildingType, realCost, realAreaExt, realAreaInt, realAreaMuros, realAreaPiso, realAreaCoberta, status, discountPanelPct, freightCost, biomassCost } = req.body;
      const validBuildingTypes = ["residencial", "comercial", "institucional", "industrial", "outro"];
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (clientName !== undefined) updateData.clientName = clientName;
      if (description !== undefined) updateData.description = description;
      if (projectType !== undefined) updateData.projectType = projectType;
      if (buildingType !== undefined) updateData.buildingType = (buildingType && validBuildingTypes.includes(buildingType)) ? buildingType : null;
      if (status !== undefined && ["pending", "processing", "completed", "error"].includes(status)) {
        await storage.updateProjectStatus(projectId, status);
      }
      if (realCost !== undefined) updateData.realCost = realCost;
      if (realAreaExt !== undefined) updateData.realAreaExt = realAreaExt;
      if (realAreaInt !== undefined) updateData.realAreaInt = realAreaInt;
      if (realAreaMuros !== undefined) updateData.realAreaMuros = realAreaMuros;
      if (realAreaPiso !== undefined) updateData.realAreaPiso = realAreaPiso;
      if (realAreaCoberta !== undefined) updateData.realAreaCoberta = realAreaCoberta;
      if (discountPanelPct !== undefined) {
        const n = typeof discountPanelPct === "number" ? discountPanelPct : parseFloat(discountPanelPct);
        if (!Number.isFinite(n) || n < 0 || n > 25) {
          return res.status(400).json({ message: "Desconto invalido (0 a 25%)" });
        }
        updateData.discountPanelPct = String(n);
      }
      if (freightCost !== undefined) {
        const n = typeof freightCost === "number" ? freightCost : parseFloat(freightCost);
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ message: "Frete invalido" });
        updateData.freightCost = String(n);
      }
      if (biomassCost !== undefined) {
        const n = typeof biomassCost === "number" ? biomassCost : parseFloat(biomassCost);
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ message: "Biomassa invalida" });
        updateData.biomassCost = String(n);
      }
      const updated = await storage.updateProject(projectId, updateData);
      if (!updated) return res.status(404).json({ message: "Projeto nao encontrado" });

      if (discountPanelPct !== undefined || freightCost !== undefined || biomassCost !== undefined) {
        try {
          const existingBudget = await storage.getBudget(projectId);
          if (existingBudget) {
            const bd = existingBudget.budgetData as any;
            const panelCost = Number(bd?.proposta?.total_paineis_cost || 0);
            const paginacaoCost = Number(bd?.proposta?.paginacao?.preco_total || 0);
            const disc = Math.min(25, Math.max(0, parseFloat(String(updated.discountPanelPct || "0")) || 0));
            const fr = Math.max(0, parseFloat(String(updated.freightCost || "0")) || 0);
            const bm = Math.max(0, parseFloat(String(updated.biomassCost || "0")) || 0);
            const finalTotal = panelCost * (1 - disc / 100) + paginacaoCost + fr + bm;
            await storage.updateBudgetTotalCost(projectId, String(finalTotal.toFixed(2)));
          }
        } catch (e) {
          console.warn("[BUDGET_RECOMPUTE] Falha ao atualizar totalCost:", e);
        }
      }
      if (buildingType !== undefined) {
        const existing = await storage.getExtractedDataByType(projectId, "building_type_detection");
        if (existing) {
          const prevData = existing.data as any;
          const detectedType = prevData?.detected;
          if (detectedType && detectedType !== (updateData.buildingType || null)) {
            await storage.addExtractedData({
              projectId, fileId: null, elementType: "building_type_correction",
              data: {
                previousDetected: detectedType,
                correctedTo: updateData.buildingType,
                correctedAt: new Date().toISOString(),
              },
              hasAssumption: 0,
            });
            console.log(`[CORRECAO] Tipo edificacao corrigido: detectado=${detectedType} → usuario=${updateData.buildingType}`);
          }
        }
      }
      res.json(updated);
    } catch (error) {
      console.error("Erro ao atualizar projeto:", error);
      res.status(500).json({ message: "Erro ao atualizar projeto" });
    }
  });

  app.put("/api/projects/:id/quantitativos", async (req, res) => {
    try {
      const projectId = parseInt(String(req.params.id));
      const { walls, slabs, corners } = req.body;

      if (!walls || !slabs) {
        return res.status(400).json({ message: "Dados de paredes e lajes sao obrigatorios" });
      }

      const existingOriginal = await storage.getExtractedDataByType(projectId, "etapa4_fusao_original");
      if (!existingOriginal) {
        const currentFusao = await storage.getExtractedDataByType(projectId, "etapa4_fusao");
        if (currentFusao) {
          await storage.addExtractedData({
            projectId,
            elementType: "etapa4_fusao_original",
            data: {
              ...(currentFusao.data as Record<string, unknown>),
              _snapshot_at: new Date().toISOString(),
              _snapshot_reason: "preservado_antes_edicao_manual",
            },
          });
        }
      }

      const enabledWalls = walls.filter((w: any) => w.enabled !== false);
      const enabledSlabs = slabs.filter((s: any) => s.enabled !== false);
      const enabledCorners = (corners || []).filter((c: any) => c.enabled !== false);

      await storage.updateExtractedDataByType(projectId, "etapa4_fusao", {
        etapa: 4,
        label: "Fusao Multivista (editado manualmente)",
        editedAt: new Date().toISOString(),
        resultado: { walls: walls, slabs: slabs, corners: corners || [] },
      });

      const budget = calculateBudget(enabledWalls, enabledSlabs, enabledCorners);
      const legacy = budgetToLegacy(budget);
      const alerts = inconsistenciasToAlerts(budget.inconsistencias);

      const projectForRecalcPricing = await storage.getProject(projectId);
      const rawProductsR = await storage.getProducts();
      const allProducts = await applyProfilePrices(rawProductsR, projectForRecalcPricing?.pricingProfileId);
      const existingBudgetForPrices = await storage.getBudget(projectId);
      const prevProposta = (existingBudgetForPrices?.budgetData as any)?.proposta;
      const productExtDefault = allProducts.find((p) => p.sku === "LW-2P-090");
      const productIntDefault = allProducts.find((p) => p.sku === "LW-SP-090") || productExtDefault;
      const productPisoDefault = allProducts.find((p) => p.category === "laje_piso") || productExtDefault;
      const productCobertaDefault = allProducts.find((p) => p.category === "laje_coberta") || productExtDefault;
      const productMurosDefault = allProducts.find((p) => p.category === "muros") || productIntDefault;
      const PRECO_M2_EXT = prevProposta?.preco_m2_ext ?? parseFloat(productExtDefault?.unitPrice ?? "275");
      const PRECO_M2_INT = prevProposta?.preco_m2_int ?? parseFloat(productIntDefault?.unitPrice ?? "180");
      const PRECO_M2_PISO = parseFloat(productPisoDefault?.unitPrice ?? String(PRECO_M2_EXT));
      const PRECO_M2_COBERTA = parseFloat(productCobertaDefault?.unitPrice ?? String(PRECO_M2_EXT));
      const PRECO_M2_MUROS = parseFloat(productMurosDefault?.unitPrice ?? String(PRECO_M2_INT));
      const PRODUCT_NAME_EXT = prevProposta?.painel_ext ?? productExtDefault?.name ?? "PAINEL DE CONCRETO LEVE 3000X610X90MM 2P";
      const PRODUCT_NAME_INT = prevProposta?.painel_int ?? productIntDefault?.name ?? "PAINEL DE CONCRETO LEVE 3000X610X90MM SP";
      const PRODUCT_NAME_PISO = productPisoDefault?.name ?? PRODUCT_NAME_EXT;
      const PRODUCT_NAME_COBERTA = productCobertaDefault?.name ?? PRODUCT_NAME_EXT;
      const PRODUCT_NAME_MUROS = productMurosDefault?.name ?? PRODUCT_NAME_INT;
      const PRECO_PAGINACAO_M2 = 11;

      const extPanels = budget.resumo.paredes_externas.quantidade_paineis;
      const intPanels = budget.resumo.paredes_internas.quantidade_paineis;
      const murosPanels = budget.resumo.muros?.quantidade_paineis || 0;
      const pisoPanels = budget.resumo.laje_piso.quantidade_paineis;
      const cobertaPanels = budget.resumo.laje_coberta.quantidade_paineis;
      const extArea = Math.round(extPanels * 1.83 * 1000) / 1000;
      const intArea = Math.round(intPanels * 1.83 * 1000) / 1000;
      const murosArea = Math.round(murosPanels * 1.83 * 1000) / 1000;
      const pisoArea = Math.round(pisoPanels * 1.83 * 1000) / 1000;
      const cobertaArea = Math.round(cobertaPanels * 1.83 * 1000) / 1000;
      const totalAreaM2 = Math.round((extArea + intArea + murosArea + pisoArea + cobertaArea) * 1000) / 1000;
      const extCost = Math.round(extArea * PRECO_M2_EXT * 100) / 100;
      const intCost = Math.round(intArea * PRECO_M2_INT * 100) / 100;
      const murosCost = Math.round(murosArea * PRECO_M2_MUROS * 100) / 100;
      const pisoCost = Math.round(pisoArea * PRECO_M2_PISO * 100) / 100;
      const cobertaCost = Math.round(cobertaArea * PRECO_M2_COBERTA * 100) / 100;
      const totalPanelCost = extCost + intCost + murosCost + pisoCost + cobertaCost;
      const paginacaoCost = Math.round(totalAreaM2 * PRECO_PAGINACAO_M2 * 100) / 100;
      const totalCost = totalPanelCost + paginacaoCost;

      const SKU_EXT_R = prevProposta?.itens?.[0]?.sku || productExtDefault?.sku || "LW-2P-090";
      const SKU_INT_R = prevProposta?.itens?.[1]?.sku || productIntDefault?.sku || "LW-SP-090";
      const SKU_MUROS_R = productMurosDefault?.sku || SKU_INT_R;
      const SKU_PISO_R = productPisoDefault?.sku || SKU_EXT_R;
      const SKU_COBERTA_R = productCobertaDefault?.sku || SKU_EXT_R;
      const propostaItens: Array<{ item: number; local: string; discriminacao: string; sku: string; qtd_un: number; qtd_m2: number; preco_m2: number; preco_total: number }> = [];
      let lineNoR = 1;
      propostaItens.push({ item: lineNoR++, local: "PAREDES EXTERNAS", discriminacao: PRODUCT_NAME_EXT, sku: SKU_EXT_R, qtd_un: extPanels, qtd_m2: extArea, preco_m2: PRECO_M2_EXT, preco_total: extCost });
      propostaItens.push({ item: lineNoR++, local: "PAREDES INTERNAS", discriminacao: PRODUCT_NAME_INT, sku: SKU_INT_R, qtd_un: intPanels, qtd_m2: intArea, preco_m2: PRECO_M2_INT, preco_total: intCost });
      if (murosPanels > 0) {
        propostaItens.push({ item: lineNoR++, local: "MUROS (DIVISA)", discriminacao: PRODUCT_NAME_MUROS, sku: SKU_MUROS_R, qtd_un: murosPanels, qtd_m2: murosArea, preco_m2: PRECO_M2_MUROS, preco_total: murosCost });
      }
      propostaItens.push({ item: lineNoR++, local: "LAJE DE PISO", discriminacao: PRODUCT_NAME_PISO, sku: SKU_PISO_R, qtd_un: pisoPanels, qtd_m2: pisoArea, preco_m2: PRECO_M2_PISO, preco_total: pisoCost });
      propostaItens.push({ item: lineNoR++, local: "LAJE COBERTA", discriminacao: PRODUCT_NAME_COBERTA, sku: SKU_COBERTA_R, qtd_un: cobertaPanels, qtd_m2: cobertaArea, preco_m2: PRECO_M2_COBERTA, preco_total: cobertaCost });
      const propostaPaginacao = { item: 1, discriminacao: "Projeto de Paginação", qtd_un: budget.resumo.total_geral_paineis, qtd_m2: totalAreaM2, preco_m2: PRECO_PAGINACAO_M2, preco_total: paginacaoCost };

      const connQty = Math.ceil(legacy.totals.totalPanels * 4);
      const screwQty = Math.ceil(legacy.totals.totalPanels * 8);
      const totalMaterialCost = connQty * 12.5 + screwQty * 2.8;
      const laborHours = (legacy.totals.totalWallArea + legacy.totals.totalSlabArea) * 0.8;
      const laborCost = laborHours * 65;

      const materials = {
        complementaryMaterials: [
          { name: "Conectores metalicos", unit: "un", quantity: connQty, reference: "Manual Biomassa - Item 3.2" },
          { name: "Parafusos autoperfurantes", unit: "un", quantity: screwQty, reference: "Manual Biomassa - Item 3.3" },
          { name: "Fita de vedacao", unit: "m", quantity: Math.ceil(legacy.totals.totalPanels * 2), reference: "Manual Biomassa - Item 3.4" },
          { name: "Massa de vedacao", unit: "kg", quantity: Math.ceil(legacy.totals.totalPanels * 0.5), reference: "Manual Biomassa - Item 3.5" },
        ],
      };

      await storage.updateExtractedDataByType(projectId, "etapa5_calculo", {
        etapa: 5, label: "Calculo de Quantitativos (recalculado)", resultado: budget,
      });
      await storage.updateExtractedDataByType(projectId, "etapa7_validacao", {
        etapa: 7, label: "Validacao (recalculado)",
        resultado: { inconsistencias: budget.inconsistencias, alertas: alerts },
      });

      const budgetData = {
        quantitatives: legacy,
        materials,
        alerts,
        assumptions: [],
        totals: legacy.totals,
        budget7etapas: budget,
        projectDescription: (existingBudgetForPrices?.budgetData as any)?.projectDescription || "",
        proposta: {
          itens: propostaItens,
          totais_por_sku: computeTotaisPorSku(propostaItens),
          total_paineis_un: budget.resumo.total_geral_paineis,
          total_area_m2: totalAreaM2,
          total_paineis_cost: totalPanelCost,
          paginacao: propostaPaginacao,
          grandTotal: totalCost,
          preco_m2_ext: PRECO_M2_EXT,
          preco_m2_int: PRECO_M2_INT,
          painel_ext: PRODUCT_NAME_EXT,
          painel_int: PRODUCT_NAME_INT,
        },
        costs: {
          panels: { total: totalPanelCost },
          paginacao: { total: paginacaoCost },
          complementar: {
            materials: { items: materials.complementaryMaterials, total: totalMaterialCost },
            labor: { hours: laborHours, rate: 65, total: laborCost },
          },
          grandTotal: totalCost,
        },
      };

      await storage.deleteBudget(projectId);
      await storage.createBudget({
        projectId,
        budgetData,
        totalArea: String(legacy.totals.totalWallArea + legacy.totals.totalSlabArea),
        totalCost: String(totalCost),
        status: "completed",
      });

      res.json({ message: "Quantitativos recalculados com sucesso", budget: budgetData });
    } catch (error) {
      console.error("Erro ao recalcular quantitativos:", error);
      res.status(500).json({ message: "Erro ao recalcular quantitativos" });
    }
  });

  app.get("/api/projects/:id/export/:format", async (req, res) => {
    try {
      const projectId = parseInt(String(req.params.id));
      const format = req.params.format as "pdf" | "excel" | "json";
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }

      const budget = await storage.getBudget(projectId);
      if (!budget) {
        return res
          .status(400)
          .json({ message: "Orçamento não gerado ainda" });
      }

      const budgetData = budget.budgetData as any;
      const exportData = {
        projectName: project.name,
        clientName: project.clientName || undefined,
        date: new Date(),
        quantitatives: budgetData.quantitatives,
        materials: budgetData.materials,
        alerts: budgetData.alerts || [],
        assumptions: budgetData.assumptions || [],
      };

      const exportDir = "server/uploads/exports";
      await fs.mkdir(exportDir, { recursive: true });

      if (format === "excel") {
        const outputPath = path.join(
          exportDir,
          `orcamento_${projectId}.xlsx`,
        );
        await exportToExcel(exportData, outputPath);
        res.download(outputPath);
      } else if (format === "pdf") {
        const outputPath = path.join(
          exportDir,
          `orcamento_${projectId}.pdf`,
        );
        await exportToPDF(exportData, outputPath);
        res.download(outputPath);
      } else if (format === "json") {
        const outputPath = path.join(
          exportDir,
          `orcamento_${projectId}.json`,
        );
        await exportToJSON(exportData, outputPath);
        res.download(outputPath);
      } else {
        res.status(400).json({ message: "Formato inválido. Use pdf, excel ou json" });
      }
    } catch (error) {
      console.error("Erro ao exportar:", error);
      res.status(500).json({ message: "Erro ao exportar orçamento" });
    }
  });

  // ===== Wall feedback (human-in-the-loop) =====
  // Schema de payload (cliente). Limites de string previnem inflar a coluna.
  const wallFeedbackBodySchema = z.object({
    project_id: z.union([z.number(), z.string()]).optional().nullable(),
    wall_id: z.string().trim().min(1).max(64),
    nivel: z.string().trim().max(64).optional().nullable(),
    espessura_m: z.number().nonnegative().max(10).optional(),
    comprimento_m: z.number().nonnegative().max(1000).optional(),
    has_window: z.boolean().optional().nullable(),
    has_door: z.boolean().optional().nullable(),
    review_reason_bucket: z.string().trim().max(64).optional().nullable(),
    original_classe: z.enum(["externa", "interna", "muro"]).optional().nullable(),
    corrected_classe: z.enum(["externa", "interna", "muro", "nao_parede"]).optional().nullable(),
    action: z.enum(["confirm", "correct", "exemplar", "not_wall"]),
    is_exemplar: z.boolean().optional(),
    notes: z.string().trim().max(500).optional().nullable(),
  });

  function feedbackSignatureFromBody(b: z.infer<typeof wallFeedbackBodySchema>) {
    const espM = Number(b.espessura_m ?? 0);
    const compM = Number(b.comprimento_m ?? 0);
    return {
      espessuraBucketCm: espM > 0 ? Math.round(espM * 100) : null,
      comprimentoBucketDm: compM > 0 ? Math.round(compM * 10) : null,
      hasWindow: typeof b.has_window === "boolean" ? b.has_window : null,
      hasDoor: typeof b.has_door === "boolean" ? b.has_door : null,
      reviewReasonBucket: b.review_reason_bucket || null,
    };
  }

  // Verifica que o projeto pertence ao usuario (ou que ele e admin). Previne poisoning cross-tenant.
  async function assertCanFeedbackForProject(req: any, projectIdRaw: number | string | null | undefined): Promise<{ ok: true; projectId: number | null } | { ok: false; status: number; message: string }> {
    const projectId = projectIdRaw != null && projectIdRaw !== "" ? Number(projectIdRaw) : null;
    if (projectId === null) {
      // Sem projeto explicito: so admin pode (feedback global manual e raro)
      if (req.user?.role !== "admin") return { ok: false, status: 403, message: "Apenas admin pode criar feedback sem projeto" };
      return { ok: true, projectId: null };
    }
    if (!Number.isFinite(projectId)) return { ok: false, status: 400, message: "project_id invalido" };
    const project = await storage.getProject(projectId);
    if (!project) return { ok: false, status: 404, message: "Projeto nao encontrado" };
    // Projetos nao tem owner explicito nesta plataforma; basta que o projeto exista.
    // (Acesso ao app ja exige autenticacao; admin retem permissao total.)
    return { ok: true, projectId };
  }

  async function persistFeedback(req: any, parsed: z.infer<typeof wallFeedbackBodySchema>, projectId: number | null) {
    const sig = feedbackSignatureFromBody(parsed);
    // Hardening anti-poisoning: a flag isExemplar (que pula o threshold de votos no engine)
    // so e setada por admin — "verdade curada". Nao-admin pode registrar action="exemplar"
    // para auditoria/UI, mas isExemplar=false e ele entra no mesmo pool de votos.
    const isAdmin = req.user?.role === "admin";
    const isExemplar = isAdmin && (!!parsed.is_exemplar || parsed.action === "exemplar");
    const insert: InsertWallFeedback = {
      projectId,
      userId: req.user?.id ?? null,
      wallId: parsed.wall_id,
      nivel: parsed.nivel || null,
      espessuraBucketCm: sig.espessuraBucketCm,
      comprimentoBucketDm: sig.comprimentoBucketDm,
      hasWindow: sig.hasWindow,
      hasDoor: sig.hasDoor,
      reviewReasonBucket: sig.reviewReasonBucket,
      originalClasse: parsed.original_classe || null,
      correctedClasse: parsed.corrected_classe || null,
      action: parsed.action,
      isExemplar,
      notes: parsed.notes || null,
      active: true,
    };
    return storage.createWallFeedback(insert);
  }

  app.post("/api/wall-feedback", requireAuth, async (req: any, res) => {
    try {
      const parsed = wallFeedbackBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Payload invalido", errors: parsed.error.flatten() });
      const auth = await assertCanFeedbackForProject(req, parsed.data.project_id ?? null);
      if (!auth.ok) return res.status(auth.status).json({ message: auth.message });
      const fb = await persistFeedback(req, parsed.data, auth.projectId);
      res.json(fb);
    } catch (err: any) {
      console.error("Erro ao salvar feedback:", err);
      res.status(500).json({ message: "Erro ao salvar feedback" });
    }
  });

  app.post("/api/wall-feedback/batch", requireAuth, async (req: any, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (items.length === 0) return res.status(400).json({ message: "items vazio" });
      if (items.length > 500) return res.status(400).json({ message: "Limite de 500 items por lote" });
      const created: any[] = [];
      const skipped: any[] = [];
      const permCache = new Map<string, { ok: boolean; status?: number; projectId: number | null; message?: string }>();
      for (const raw of items) {
        const parsed = wallFeedbackBodySchema.safeParse(raw);
        if (!parsed.success) { skipped.push({ reason: "schema", item: raw }); continue; }
        const pid = parsed.data.project_id ?? null;
        const cacheKey = pid != null ? String(pid) : "__none__";
        let perm = permCache.get(cacheKey);
        if (!perm) {
          const r = await assertCanFeedbackForProject(req, pid);
          perm = r.ok ? { ok: true, projectId: r.projectId } : { ok: false, status: r.status, projectId: null, message: r.message };
          permCache.set(cacheKey, perm);
        }
        if (!perm.ok) { skipped.push({ reason: perm.message, item: raw }); continue; }
        const fb = await persistFeedback(req, parsed.data, perm.projectId);
        created.push(fb);
      }
      res.json({ created: created.length, skipped: skipped.length, items: created });
    } catch (err: any) {
      console.error("Erro ao salvar feedback em lote:", err);
      res.status(500).json({ message: "Erro ao salvar feedback em lote" });
    }
  });

  // ===== Side hints (lado externo / interno marcado pelo humano) =====
  const sideHintBodySchema = z.object({
    pavimento: z.string().min(1).max(100),
    xNorm: z.number().int().min(0).max(1000),
    yNorm: z.number().int().min(0).max(1000),
    side: z.enum(["exterior", "interior"]),
  });
  const sideHintsReplaceSchema = z.object({
    hints: z.array(sideHintBodySchema).max(500),
  });

  app.get("/api/projects/:id/side-hints", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      if (!Number.isFinite(projectId)) return res.status(400).json({ message: "id invalido" });
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Projeto nao encontrado" });
      const rows = await storage.getFloorSideHints(projectId);
      res.json(rows);
    } catch {
      res.status(500).json({ message: "Erro ao listar marcadores" });
    }
  });

  app.put("/api/projects/:id/side-hints", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      if (!Number.isFinite(projectId)) return res.status(400).json({ message: "id invalido" });
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Projeto nao encontrado" });
      const parsed = sideHintsReplaceSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Payload invalido", issues: parsed.error.flatten() });
      const inserts = parsed.data.hints.map(h => ({ projectId, ...h }));
      const saved = await storage.replaceFloorSideHints(projectId, inserts);

      // Aplica os marcadores nas paredes ja extraidas/editadas e persiste a
      // reclassificacao no fusao + recalcula orcamento. Assim o usuario ve o
      // efeito imediato sem precisar reprocessar o PDF inteiro.
      let reclassified = 0;
      try {
        const fusao = await storage.getExtractedDataByType(projectId, "etapa4_fusao");
        const currentWalls = (fusao?.data as any)?.resultado?.walls;
        if (Array.isArray(currentWalls) && currentWalls.length > 0) {
          const hintsForEngine = saved.map(h => ({
            pavimento: h.pavimento,
            xNorm: h.xNorm,
            yNorm: h.yNorm,
            side: h.side as "exterior" | "interior",
          }));
          const r = applySideHintsOverride(currentWalls, hintsForEngine);
          reclassified = r.overridden;
          if (r.overridden > 0) {
            const newData = {
              ...(fusao!.data as Record<string, unknown>),
              resultado: {
                ...((fusao!.data as any).resultado || {}),
                walls: r.walls,
              },
              editedAt: new Date().toISOString(),
              _side_hints_applied_at: new Date().toISOString(),
              _side_hints_count: saved.length,
            };
            await storage.updateExtractedDataByType(projectId, "etapa4_fusao", newData);
          }
        }
      } catch (applyErr) {
        console.warn("[SIDE_HINTS] Falha ao aplicar marcadores nas paredes existentes:", applyErr);
      }

      res.json({ count: saved.length, reclassified, items: saved });
    } catch (err: any) {
      console.error("Erro ao salvar marcadores:", err);
      res.status(500).json({ message: "Erro ao salvar marcadores" });
    }
  });

  // Lista feedbacks de UM projeto (visivel para qualquer usuario autenticado).
  // Serve para a UI exibir os exemplos persistidos do projeto na aba Quantitativos.
  app.get("/api/wall-feedback/project/:projectId", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.projectId);
      if (!Number.isFinite(projectId)) return res.status(400).json({ message: "projectId invalido" });
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Projeto nao encontrado" });
      const rows = await storage.getWallFeedback({ projectId, active: true });
      res.json(rows);
    } catch {
      res.status(500).json({ message: "Erro ao listar feedbacks do projeto" });
    }
  });

  app.get("/api/wall-feedback", requireAdmin, async (req, res) => {
    try {
      const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
      const active = req.query.active !== undefined ? req.query.active === "true" : undefined;
      const isExemplar = req.query.isExemplar !== undefined ? req.query.isExemplar === "true" : undefined;
      const rows = await storage.getWallFeedback({ projectId, active, isExemplar });
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: "Erro ao listar feedbacks" });
    }
  });

  app.patch("/api/wall-feedback/:id/active", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const active = !!req.body?.active;
      const updated = await storage.setWallFeedbackActive(id, active);
      if (!updated) return res.status(404).json({ message: "Feedback nao encontrado" });
      res.json(updated);
    } catch {
      res.status(500).json({ message: "Erro ao atualizar feedback" });
    }
  });

  app.delete("/api/wall-feedback/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteWallFeedback(Number(req.params.id));
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Erro ao deletar feedback" });
    }
  });

  app.get("/api/wall-feedback/stats", requireAdmin, async (_req, res) => {
    try {
      const all = await storage.getWallFeedback({});
      const active = all.filter(f => f.active);
      const counts = {
        total: all.length,
        active: active.length,
        confirm: all.filter(f => f.action === "confirm").length,
        correct: all.filter(f => f.action === "correct").length,
        not_wall: all.filter(f => f.action === "not_wall").length,
        exemplar: all.filter(f => f.isExemplar).length,
      };
      // Top padroes por assinatura (apenas correcoes/exemplares ativos)
      const sigMap = new Map<string, { espessuraBucketCm: number | null; comprimentoBucketDm: number | null; originalClasse: string | null; correctedClasse: string | null; count: number }>();
      for (const f of active) {
        if (f.action === "confirm") continue;
        const key = `${f.espessuraBucketCm ?? "x"}|${f.comprimentoBucketDm ?? "x"}|${f.originalClasse ?? "x"}|${f.correctedClasse ?? "x"}`;
        const cur = sigMap.get(key) || { espessuraBucketCm: f.espessuraBucketCm, comprimentoBucketDm: f.comprimentoBucketDm, originalClasse: f.originalClasse, correctedClasse: f.correctedClasse, count: 0 };
        cur.count += 1;
        sigMap.set(key, cur);
      }
      const topPatterns = Array.from(sigMap.values()).sort((a, b) => b.count - a.count).slice(0, 20);

      // Acuracia de classificacao: comparar etapa4_fusao vs etapa4_fusao_original
      // para todos os projetos de teste. Acuracia = paredes cuja classe nao mudou
      // E o humano nao desativou. Paredes removidas pelo humano contam como "mudadas"
      // (a IA originalmente as classificou como parede valida e o humano discordou).
      const projects = await storage.getProjects();
      const testProjects = projects.filter(p => p.projectType === "teste" && p.status === "completed");
      const perProjectRaw = await Promise.all(testProjects.map(async (p) => {
        const [orig, edited] = await Promise.all([
          storage.getExtractedDataByType(p.id, "etapa4_fusao_original"),
          storage.getExtractedDataByType(p.id, "etapa4_fusao"),
        ]);
        if (!orig || !edited) return null;
        const ow = ((orig.data as any)?.resultado?.walls || []) as any[];
        const ew = ((edited.data as any)?.resultado?.walls || []) as any[];
        const editedById = new Map(ew.map(w => [w.id, w]));
        let pTot = 0, pUn = 0;
        for (const o of ow) {
          pTot += 1;
          const e = editedById.get(o.id);
          if (e && o.classe === e.classe && e.enabled !== false) pUn += 1;
        }
        if (pTot === 0) return null;
        return { projectId: p.id, projectName: p.name, total: pTot, unchanged: pUn, accuracy: Math.round((pUn / pTot) * 1000) / 10 };
      }));
      const perProject = perProjectRaw.filter((x): x is { projectId: number; projectName: string; total: number; unchanged: number; accuracy: number } => x !== null);
      let totalWalls = 0;
      let unchangedWalls = 0;
      for (const pp of perProject) { totalWalls += pp.total; unchangedWalls += pp.unchanged; }
      const classificationAccuracy = totalWalls > 0 ? Math.round((unchangedWalls / totalWalls) * 1000) / 10 : null;
      res.json({
        counts,
        topPatterns,
        classificationAccuracy,
        classificationSample: { totalWalls, unchangedWalls, projectsCompared: perProject.length },
        perProject,
      });
    } catch (err: any) {
      console.error("Erro stats feedback:", err);
      res.status(500).json({ message: "Erro ao calcular estatisticas" });
    }
  });

  app.get("/api/calibration", async (_req, res) => {
    try {
      const allBudgetsWithProjects = await storage.getAllBudgetsWithProjects();
      const testProjects = allBudgetsWithProjects.filter(
        ({ project }) => project.projectType === "teste" && (
          (project.realAreaExt && parseFloat(project.realAreaExt) > 0) ||
          (project.realAreaInt && parseFloat(project.realAreaInt) > 0) ||
          (project.realAreaMuros && parseFloat(project.realAreaMuros) > 0) ||
          (project.realAreaPiso && parseFloat(project.realAreaPiso) > 0) ||
          (project.realAreaCoberta && parseFloat(project.realAreaCoberta) > 0) ||
          (project.realCost && parseFloat(project.realCost) > 0)
        )
      );

      if (testProjects.length === 0) {
        return res.json({
          hasData: false,
          avgAccuracy: 0,
          avgCostAccuracy: 0,
          avgAreaAccuracy: null,
          avgDeviation: 0,
          projectCount: 0,
          projectsWithAreas: 0,
          categories: [],
          patterns: [],
          projects: [],
        });
      }

      const categoryNames = ["paredes_externas", "paredes_internas", "muros", "laje_piso", "laje_coberta"];
      const categoryLabels: Record<string, string> = {
        paredes_externas: "Paredes Externas",
        paredes_internas: "Paredes Internas",
        muros: "Muros",
        laje_piso: "Laje de Piso",
        laje_coberta: "Laje Coberta",
      };

      interface PropostaItem {
        local?: string;
        preco_total?: number;
        qtd_un?: number;
        qtd_m2?: number;
      }
      interface BudgetDataShape {
        proposta?: { itens?: PropostaItem[] };
        apiHealth?: { reliability?: { score: number; level: string; factors?: string[] } };
      }
      interface FusaoElement {
        classe?: string;
        enabled?: boolean;
        comprimento_m?: number;
        altura_m?: number;
        area_m2?: number;
        id?: string;
        nivel?: string;
        qtd_cantos?: number;
      }
      interface FusaoDataShape {
        resultado?: { walls?: FusaoElement[]; slabs?: FusaoElement[]; corners?: FusaoElement[] };
        walls?: FusaoElement[];
        slabs?: FusaoElement[];
        corners?: FusaoElement[];
      }
      interface CategoryCounts {
        paredes_externas: number;
        paredes_internas: number;
        muros: number;
        laje_piso: number;
        laje_coberta: number;
        total_walls: number;
        total_slabs: number;
      }
      interface OriginalVsEditedData {
        original: CategoryCounts;
        edited: CategoryCounts;
        originalCalcCost: number;
        changes: Record<string, number>;
      }

      function extractCategoryCosts(budgetData: BudgetDataShape) {
        const proposta = budgetData?.proposta;
        const cats: Record<string, { cost: number; panels: number; area: number }> = {};
        for (const cat of categoryNames) cats[cat] = { cost: 0, panels: 0, area: 0 };
        if (proposta?.itens) {
          for (const item of proposta.itens) {
            const local = (item.local || "").toUpperCase();
            if (local.includes("EXTERNAS")) cats.paredes_externas = { cost: item.preco_total || 0, panels: item.qtd_un || 0, area: item.qtd_m2 || 0 };
            else if (local.includes("INTERNAS")) cats.paredes_internas = { cost: item.preco_total || 0, panels: item.qtd_un || 0, area: item.qtd_m2 || 0 };
            else if (local.includes("PISO")) cats.laje_piso = { cost: item.preco_total || 0, panels: item.qtd_un || 0, area: item.qtd_m2 || 0 };
            else if (local.includes("COBERTA")) cats.laje_coberta = { cost: item.preco_total || 0, panels: item.qtd_un || 0, area: item.qtd_m2 || 0 };
          }
        }
        return cats;
      }

      function countWallsSlabs(fusaoData: FusaoDataShape): CategoryCounts {
        const resultado = fusaoData?.resultado || fusaoData;
        const walls = resultado?.walls || [];
        const slabs = resultado?.slabs || [];
        return {
          paredes_externas: walls.filter(w => w.classe === "externa" && w.enabled !== false).length,
          paredes_internas: walls.filter(w => w.classe === "interna" && w.enabled !== false).length,
          muros: walls.filter(w => w.classe === "muro" && w.enabled !== false).length,
          laje_piso: slabs.filter(s => (s.classe === "piso" || s.classe === "radier") && s.enabled !== false).length,
          laje_coberta: slabs.filter(s => s.classe === "coberta" && s.enabled !== false).length,
          total_walls: walls.filter(w => w.enabled !== false).length,
          total_slabs: slabs.filter(s => s.enabled !== false).length,
        };
      }

      function estimateCostFromFusion(fusaoData: FusaoDataShape): number {
        try {
          const resultado = fusaoData?.resultado || fusaoData;
          const walls = (resultado?.walls || []).filter(w => w.enabled !== false);
          const slabs = (resultado?.slabs || []).filter(s => s.enabled !== false);
          const corners = resultado?.corners || [];
          const budgetResult = calculateBudget(
            walls as ExtractedWall[],
            slabs as ExtractedSlab[],
            corners as ExtractedCorner[],
          );
          const AREA_PAINEL = 1.83;
          const PRECO_M2 = 275;
          const PRECO_PAG_M2 = 11;
          const extPanels = budgetResult.resumo.paredes_externas.quantidade_paineis;
          const intPanels = budgetResult.resumo.paredes_internas.quantidade_paineis;
          const pisoPanels = budgetResult.resumo.laje_piso.quantidade_paineis;
          const cobertaPanels = budgetResult.resumo.laje_coberta.quantidade_paineis;
          const extArea = Math.round(extPanels * AREA_PAINEL * 1000) / 1000;
          const intArea = Math.round(intPanels * AREA_PAINEL * 1000) / 1000;
          const pisoArea = Math.round(pisoPanels * AREA_PAINEL * 1000) / 1000;
          const cobertaArea = Math.round(cobertaPanels * AREA_PAINEL * 1000) / 1000;
          const totalArea = extArea + intArea + pisoArea + cobertaArea;
          const panelCost = Math.round(totalArea * PRECO_M2 * 100) / 100;
          const pagCost = Math.round(totalArea * PRECO_PAG_M2 * 100) / 100;
          return Math.round((panelCost + pagCost) * 100) / 100;
        } catch {
          return 0;
        }
      }

      const projectDetails = await Promise.all(testProjects.map(async ({ budget, project }) => {
        const budgetData = budget.budgetData as BudgetDataShape | null;
        const realCost = project.realCost ? parseFloat(project.realCost) : 0;
        const calcCost = parseFloat(budget.totalCost || "0");
        const costAccuracy = realCost > 0 ? Math.max(0, (1 - Math.abs(calcCost - realCost) / realCost) * 100) : 0;
        const costDeviation = realCost > 0 ? ((calcCost - realCost) / realCost) * 100 : 0;

        const categories = extractCategoryCosts(budgetData || {});
        const totalCalc = Object.values(categories).reduce((s, c) => s + c.cost, 0);

        const realAreas: Record<string, number | null> = {
          paredes_externas: project.realAreaExt ? parseFloat(project.realAreaExt) : null,
          paredes_internas: project.realAreaInt ? parseFloat(project.realAreaInt) : null,
          muros: project.realAreaMuros ? parseFloat(project.realAreaMuros) : null,
          laje_piso: project.realAreaPiso ? parseFloat(project.realAreaPiso) : null,
          laje_coberta: project.realAreaCoberta ? parseFloat(project.realAreaCoberta) : null,
        };
        const hasRealAreas = Object.values(realAreas).some(v => v !== null && v > 0);

        const categoryDeviations: Record<string, { calcArea: number; realArea: number | null; deviation: number | null; accuracy: number | null }> = {};
        let areaAccuracy: number | null = null;

        if (hasRealAreas) {
          let weightedAccuracySum = 0;
          let totalWeight = 0;
          for (const cat of categoryNames) {
            const calcArea = categories[cat]?.area || 0;
            const realArea = realAreas[cat];
            if (realArea !== null && realArea > 0) {
              const dev = ((calcArea - realArea) / realArea) * 100;
              const acc = Math.max(0, (1 - Math.abs(calcArea - realArea) / realArea) * 100);
              categoryDeviations[cat] = { calcArea, realArea, deviation: Math.round(dev * 10) / 10, accuracy: Math.round(acc * 10) / 10 };
              weightedAccuracySum += acc * realArea;
              totalWeight += realArea;
            } else {
              categoryDeviations[cat] = { calcArea, realArea: null, deviation: null, accuracy: null };
            }
          }
          areaAccuracy = totalWeight > 0 ? Math.round((weightedAccuracySum / totalWeight) * 10) / 10 : null;
        } else {
          for (const cat of categoryNames) {
            categoryDeviations[cat] = { calcArea: categories[cat]?.area || 0, realArea: null, deviation: null, accuracy: null };
          }
        }

        const primaryAccuracy = hasRealAreas && areaAccuracy !== null ? areaAccuracy : Math.round(costAccuracy * 10) / 10;

        const categoryContributions: Record<string, number> = {};
        const errorAmount = calcCost - realCost;
        for (const cat of categoryNames) {
          const proportion = totalCalc > 0 ? categories[cat].cost / totalCalc : 0;
          categoryContributions[cat] = Math.round(proportion * errorAmount * 100) / 100;
        }

        const originalSnapshot = await storage.getExtractedDataByType(project.id, "etapa4_fusao_original");
        const currentFusao = await storage.getExtractedDataByType(project.id, "etapa4_fusao");
        const hasManualEdits = !!originalSnapshot;

        let originalVsEdited: OriginalVsEditedData | null = null;
        let originalCalcCost: number | null = null;
        if (hasManualEdits && originalSnapshot && currentFusao) {
          const origCounts = countWallsSlabs(originalSnapshot.data as FusaoDataShape);
          const editedCounts = countWallsSlabs(currentFusao.data as FusaoDataShape);
          originalCalcCost = estimateCostFromFusion(originalSnapshot.data as FusaoDataShape);
          originalVsEdited = {
            original: origCounts,
            edited: editedCounts,
            originalCalcCost,
            changes: {
              paredes_externas: editedCounts.paredes_externas - origCounts.paredes_externas,
              paredes_internas: editedCounts.paredes_internas - origCounts.paredes_internas,
              muros: editedCounts.muros - origCounts.muros,
              laje_piso: editedCounts.laje_piso - origCounts.laje_piso,
              laje_coberta: editedCounts.laje_coberta - origCounts.laje_coberta,
              total_walls: editedCounts.total_walls - origCounts.total_walls,
              total_slabs: editedCounts.total_slabs - origCounts.total_slabs,
            },
          };
        }

        const apiReliability = budgetData?.apiHealth?.reliability || null;

        return {
          projectId: project.id,
          projectName: project.name,
          clientName: project.clientName || "",
          realCost,
          calcCost,
          originalCalcCost,
          accuracy: primaryAccuracy,
          costAccuracy: Math.round(costAccuracy * 10) / 10,
          areaAccuracy,
          deviation: Math.round(costDeviation * 10) / 10,
          categories,
          categoryDeviations,
          categoryContributions,
          hasRealAreas,
          hasManualEdits,
          originalVsEdited,
          apiReliability: apiReliability || null,
          processedAt: budget.createdAt,
        };
      }));

      const avgAccuracy = projectDetails.reduce((s, p) => s + p.accuracy, 0) / projectDetails.length;
      const avgCostAccuracy = projectDetails.reduce((s, p) => s + p.costAccuracy, 0) / projectDetails.length;
      const avgDeviation = projectDetails.reduce((s, p) => s + p.deviation, 0) / projectDetails.length;

      const projectsWithAreas = projectDetails.filter(p => p.hasRealAreas);
      const avgAreaAccuracy = projectsWithAreas.length > 0
        ? projectsWithAreas.reduce((s, p) => s + (p.areaAccuracy || 0), 0) / projectsWithAreas.length
        : null;

      const categoryStats = categoryNames.map(cat => {
        const costs = projectDetails.map(p => p.categories[cat]?.cost || 0);
        const avgCost = costs.reduce((s, v) => s + v, 0) / costs.length;
        const contributions = projectDetails.map(p => p.categoryContributions[cat] || 0);
        const avgContribution = contributions.reduce((s, v) => s + v, 0) / contributions.length;
        const totalCalcs = projectDetails.map(p => Object.values(p.categories).reduce((s, c) => s + c.cost, 0));
        const avgProportion = totalCalcs.reduce((s, tc, i) => s + (tc > 0 ? (costs[i] / tc) : 0), 0) / projectDetails.length * 100;
        const projectsWithZero = projectDetails.filter(p => (p.categories[cat]?.cost || 0) === 0).length;

        const areaDeviations = projectsWithAreas
          .filter(p => p.categoryDeviations[cat]?.deviation !== null)
          .map(p => p.categoryDeviations[cat].deviation!);
        const avgAreaDeviation = areaDeviations.length > 0
          ? areaDeviations.reduce((s, v) => s + v, 0) / areaDeviations.length
          : null;

        const areaAccuracies = projectsWithAreas
          .filter(p => p.categoryDeviations[cat]?.accuracy !== null)
          .map(p => p.categoryDeviations[cat].accuracy!);
        const avgCatAreaAccuracy = areaAccuracies.length > 0
          ? areaAccuracies.reduce((s, v) => s + v, 0) / areaAccuracies.length
          : null;

        return {
          category: cat,
          label: categoryLabels[cat],
          avgCost: Math.round(avgCost * 100) / 100,
          avgProportion: Math.round(avgProportion * 10) / 10,
          avgErrorContribution: Math.round(avgContribution * 100) / 100,
          avgAreaDeviation: avgAreaDeviation !== null ? Math.round(avgAreaDeviation * 10) / 10 : null,
          avgAreaAccuracy: avgCatAreaAccuracy !== null ? Math.round(avgCatAreaAccuracy * 10) / 10 : null,
          projectsWithZero,
          projectsWithRealArea: areaDeviations.length,
        };
      });

      const patterns: string[] = [];

      if (avgAreaAccuracy !== null) {
        for (const cat of categoryStats) {
          if (cat.avgAreaDeviation !== null && Math.abs(cat.avgAreaDeviation) > 10) {
            const direction = cat.avgAreaDeviation > 0 ? "superestima" : "subestima";
            patterns.push(`${cat.label}: ${direction} m² em media ${Math.abs(cat.avgAreaDeviation).toFixed(1)}%`);
          }
        }
      }

      if (avgDeviation > 5) {
        patterns.push(`Sistema superestima custo em media ${Math.abs(avgDeviation).toFixed(1)}%`);
      } else if (avgDeviation < -5) {
        patterns.push(`Sistema subestima custo em media ${Math.abs(avgDeviation).toFixed(1)}%`);
      }

      for (const cat of categoryStats) {
        const zeroRate = cat.projectsWithZero / projectDetails.length;
        if (zeroRate >= 0.5 && cat.category !== "laje_coberta") {
          patterns.push(`${cat.label}: nao detectado em ${Math.round(zeroRate * 100)}% dos projetos`);
        }
      }

      const lowReliabilityProjects = projectDetails.filter(p => p.apiReliability?.level === "low" || p.apiReliability?.level === "medium");
      if (lowReliabilityProjects.length > 0) {
        patterns.push(`${lowReliabilityProjects.length} projeto(s) com problemas de API durante processamento`);
      }

      const maxDeviationProject = projectDetails.reduce((max, p) => Math.abs(p.deviation) > Math.abs(max.deviation) ? p : max);
      if (Math.abs(maxDeviationProject.deviation) > 20) {
        patterns.push(`Maior desvio: ${maxDeviationProject.projectName} (${maxDeviationProject.deviation > 0 ? "+" : ""}${maxDeviationProject.deviation.toFixed(1)}%)`);
      }

      const editedProjects = projectDetails.filter(p => p.hasManualEdits);
      if (editedProjects.length > 0) {
        patterns.push(`${editedProjects.length} projeto(s) com correcoes manuais aplicadas`);
      }

      res.json({
        hasData: true,
        avgAccuracy: Math.round(avgAccuracy * 10) / 10,
        avgCostAccuracy: Math.round(avgCostAccuracy * 10) / 10,
        avgAreaAccuracy: avgAreaAccuracy !== null ? Math.round(avgAreaAccuracy * 10) / 10 : null,
        avgDeviation: Math.round(avgDeviation * 10) / 10,
        projectCount: projectDetails.length,
        projectsWithAreas: projectsWithAreas.length,
        categories: categoryStats,
        patterns,
        projects: projectDetails,
      });
    } catch (error) {
      console.error("Erro ao calcular calibracao:", error);
      res.status(500).json({ message: "Erro ao calcular dados de calibracao" });
    }
  });

  app.post("/api/projects/:id/annotated-image", requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(String(req.params.id));
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Projeto nao encontrado" });

      const files = await storage.getProjectFiles(projectId);
      const extracted = await storage.getExtractedData(projectId);
      const fusao = extracted.find((d: any) => d.elementType === "etapa4_fusao");
      const walls = (fusao?.data as any)?.resultado?.walls || [];
      const slabs = (fusao?.data as any)?.resultado?.slabs || [];
      if (walls.length === 0 && slabs.length === 0) {
        return res.status(400).json({ message: "Sem geometria extraida. Processe o projeto antes." });
      }

      const classificacoesData = extracted.find((d: any) => d.elementType === "etapa1_classificacoes");
      const classifications: PageClassification[] = (classificacoesData?.data as any)?.resultado || [];

      // Envelopes salvos pela Etapa 3.7 — usados para desenhar o contorno
      // tracejado por tras das paredes.
      const envelopesData = extracted.find((d: any) => d.elementType === "envelopes");
      const cachedEnvelopes: EnvelopePolygon[] = (envelopesData?.data as any)?.envelopes || [];

      const imgSources = await getAnnotationImageSources(files, classifications);
      if (imgSources.length === 0) {
        return res.status(400).json({ message: "Nenhum arquivo de planta encontrado (PDF ou imagem)." });
      }

      const annotatedImages: Array<{ pavimento: string; pageIndex: number; image: string; summary: any }> = [];

      // Atribui labels GLOBAIS uma vez antes de qualquer renderizacao, garantindo
      // W001..Wn unicos no projeto inteiro.
      assignDisplayLabels(walls, slabs);

      // Task #9: dedupe — UMA imagem anotada por pavimento. Se ha multiplas
      // paginas do mesmo pavimento (raro mas possivel), mantemos a primeira.
      const seenPavimentos = new Set<string>();
      let dedupedSources = imgSources.filter(s => {
        if (seenPavimentos.has(s.pavimento)) return false;
        seenPavimentos.add(s.pavimento);
        return true;
      });

      // Task #9: filtro opcional por pavimento/pageIndex no body. Permite
      // regenerar a imagem de UM pavimento especifico sem reprocessar os outros.
      const reqPavimento = typeof req.body?.pavimento === "string" ? req.body.pavimento.trim() : "";
      const reqPageIndex = Number.isFinite(req.body?.pageIndex) ? Number(req.body.pageIndex) : undefined;
      if (reqPavimento) {
        dedupedSources = dedupedSources.filter(s => s.pavimento === reqPavimento);
      }
      if (typeof reqPageIndex === "number") {
        dedupedSources = dedupedSources.filter(s => s.pageIndex === reqPageIndex);
      }
      if ((reqPavimento || reqPageIndex !== undefined) && dedupedSources.length === 0) {
        return res.status(404).json({ message: `Nenhuma planta encontrada para pavimento="${reqPavimento}" pageIndex=${reqPageIndex ?? "?"}` });
      }

      for (const src of dedupedSources) {
        const floorWalls = walls.filter((w: any) => src.pavimento === "all" || w.nivel === src.pavimento);
        const floorSlabs = slabs.filter((s: any) => src.pavimento === "all" || s.nivel === src.pavimento);
        const enabledFloorWalls = floorWalls.filter((w: any) => w.enabled !== false);
        const enabledFloorSlabs = floorSlabs.filter((s: any) => s.enabled !== false);

        // Quando o pavimento NAO tem paredes/lajes classificadas, ainda
        // emitimos a pagina original (sem anotacao IA) para o operador poder
        // marcar manualmente. Evita "desaparecer" pavimentos da UI.
        if (enabledFloorWalls.length === 0 && enabledFloorSlabs.length === 0) {
          console.log(`[ANNOTATED-IMG] ${src.pavimento} (pg ${src.pageIndex}) sem elementos classificados — emitindo pagina original pra validacao manual`);
          const dataUrl = `data:${src.mimeType};base64,${src.base64}`;
          annotatedImages.push({
            pavimento: src.pavimento,
            pageIndex: src.pageIndex,
            image: dataUrl,
            summary: {
              externas: 0, internas: 0, muros: 0, lajePiso: 0, lajeCoberta: 0,
              unannotated: true,
              note: "Sem paredes/lajes extraidas para este pavimento. Use o editor para marcar manualmente.",
            },
          });
          continue;
        }

        console.log(`[ANNOTATED-IMG] Gerando imagem ${src.pavimento} (pg ${src.pageIndex}) | ${enabledFloorWalls.length} paredes, ${enabledFloorSlabs.length} lajes`);

        const baseBuffer = Buffer.from(src.base64, "base64");
        const envForPav = cachedEnvelopes.find(
          e => e.pavimento === src.pavimento ||
               (src.pavimento === "all" && cachedEnvelopes.length === 1),
        );
        const { pngBuffer } = await renderAnnotatedImage(
          baseBuffer,
          src.mimeType,
          src.pageIndex,
          enabledFloorWalls,
          enabledFloorSlabs,
          {
            pavimentoLabel: src.pavimento === "all" ? "" : `Pavimento: ${src.pavimento}`,
            envelopePolygon: envForPav?.polygon,
            lotPolygon: envForPav?.lotPolygon,
          },
        );
        const dataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;

        annotatedImages.push({
          pavimento: src.pavimento,
          pageIndex: src.pageIndex,
          image: dataUrl,
          summary: {
            externas: enabledFloorWalls.filter((w: any) => w.classe === "externa").length,
            internas: enabledFloorWalls.filter((w: any) => w.classe === "interna").length,
            muros: enabledFloorWalls.filter((w: any) => w.classe === "muro").length,
            lajePiso: enabledFloorSlabs.filter((s: any) => s.classe === "piso" || s.classe === "radier").length,
            lajeCoberta: enabledFloorSlabs.filter((s: any) => s.classe === "coberta").length,
          },
        });
      }

      const enabledWalls = walls.filter((w: any) => w.enabled !== false);
      const enabledSlabs = slabs.filter((s: any) => s.enabled !== false);
      res.json({
        image: annotatedImages[0]?.image || null, // backward compat
        images: annotatedImages,
        summary: {
          externas: enabledWalls.filter((w: any) => w.classe === "externa").length,
          internas: enabledWalls.filter((w: any) => w.classe === "interna").length,
          muros: enabledWalls.filter((w: any) => w.classe === "muro").length,
          lajePiso: enabledSlabs.filter((s: any) => s.classe === "piso" || s.classe === "radier").length,
          lajeCoberta: enabledSlabs.filter((s: any) => s.classe === "coberta").length,
        },
      });
    } catch (error: any) {
      console.error("[ANNOTATED-IMG] Erro:", error);
      res.status(500).json({ message: error?.message || "Erro ao gerar imagem anotada" });
    }
  });

  // Consolidates per-pavimento annotated images into a single grid PNG (prancha-style).
  // Reuses the per-pavimento images cached in extracted_data → etapa3_annotated_plan
  // (auto-generated by /process). Returns an error if the project hasn't been processed yet.
  app.post("/api/projects/:id/annotated-image-consolidated", requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(String(req.params.id));
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Projeto nao encontrado" });

      const extracted = await storage.getExtractedData(projectId);
      const cached = extracted.find((d: any) => d.elementType === "etapa3_annotated_plan");
      const cachedImgs = (cached?.data as any)?.images || [];
      if (!Array.isArray(cachedImgs) || cachedImgs.length === 0) {
        return res.status(400).json({
          message: "Sem imagens anotadas em cache. Processe o projeto primeiro (POST /api/projects/:id/process).",
        });
      }
      const tiles: AnnotatedTile[] = cachedImgs.map((c: any) => ({
        pavimento: c.pavimento || "Pavimento",
        pageIndex: c.pageIndex || 0,
        image: c.image,
        summary: c.summary,
      }));

      console.log(`[ANNOTATED-CONSOLIDADO] Compondo ${tiles.length} pavimento(s) em prancha unica`);
      const base64 = await buildConsolidatedAnnotation(tiles, { columns: tiles.length === 1 ? 1 : 2 });
      const dataUrl = `data:image/png;base64,${base64}`;
      console.log(`[ANNOTATED-CONSOLIDADO] PNG consolidado: ${Math.round(base64.length / 1024)}KB`);
      res.json({
        image: dataUrl,
        tileCount: tiles.length,
        pavimentos: tiles.map(t => ({
          pavimento: t.pavimento,
          pageIndex: t.pageIndex,
          summary: t.summary,
        })),
      });
    } catch (error: any) {
      console.error("[ANNOTATED-CONSOLIDADO] Erro:", error);
      res.status(500).json({ message: error?.message || "Erro ao consolidar imagens anotadas" });
    }
  });

  // ===== User Management (admin only) =====

  app.get("/api/users", requireAdmin, async (_req, res) => {
    try {
      const allUsers = await storage.getUsers();
      const safeUsers = allUsers.map(u => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        active: u.active,
        storeName: u.storeName,
        pricingProfileId: u.pricingProfileId,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      }));
      res.json(safeUsers);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Erro ao listar usuarios" });
    }
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, displayName, role, storeName } = req.body;
      if (!username || typeof username !== "string" || username.trim().length < 3) {
        return res.status(400).json({ message: "Nome de usuario deve ter pelo menos 3 caracteres" });
      }
      if (!password || typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ message: "Senha deve ter pelo menos 6 caracteres" });
      }
      const existing = await storage.getUserByUsername(username.trim().toLowerCase());
      if (existing) {
        return res.status(409).json({ message: "Nome de usuario ja existe" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const { pricingProfileId } = req.body;
      const user = await storage.createUser({
        username: username.trim().toLowerCase(),
        password: hashedPassword,
        displayName: displayName?.trim() || username.trim(),
        role: role === "admin" ? "admin" : "viewer",
        active: 1,
        storeName: storeName?.trim() || null,
        pricingProfileId: typeof pricingProfileId === "number" ? pricingProfileId : null,
      });
      res.status(201).json({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        active: user.active,
        storeName: user.storeName,
        createdAt: user.createdAt,
      });
    } catch (error: any) {
      console.error("Erro ao criar usuario:", error);
      res.status(500).json({ message: error?.message || "Erro ao criar usuario" });
    }
  });

  app.put("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(String(req.params.id));
      const { displayName, role, active, storeName, password, pricingProfileId } = req.body;
      const normalizedActive = active !== undefined ? (active ? 1 : 0) : undefined;
      const normalizedRole = role !== undefined ? (role === "admin" ? "admin" : "viewer") : undefined;
      if (userId === req.user?.id && normalizedActive === 0) {
        return res.status(400).json({ message: "Voce nao pode desativar sua propria conta" });
      }
      if (userId === req.user?.id && normalizedRole !== undefined && normalizedRole !== "admin") {
        return res.status(400).json({ message: "Voce nao pode remover seu proprio acesso admin" });
      }
      const updateData: any = {};
      if (displayName !== undefined) updateData.displayName = displayName?.trim() || null;
      if (normalizedRole !== undefined) updateData.role = normalizedRole;
      if (normalizedActive !== undefined) updateData.active = normalizedActive;
      if (storeName !== undefined) updateData.storeName = storeName?.trim() || null;
      if (pricingProfileId !== undefined) updateData.pricingProfileId = pricingProfileId === null || pricingProfileId === "" ? null : Number(pricingProfileId);

      const updated = await storage.updateUser(userId, updateData);
      if (!updated) return res.status(404).json({ message: "Usuario nao encontrado" });

      if (password && typeof password === "string" && password.length >= 6) {
        const hashedPassword = await bcrypt.hash(password, 10);
        await storage.updateUserPassword(userId, hashedPassword);
      }

      res.json({
        id: updated.id,
        username: updated.username,
        displayName: updated.displayName,
        role: updated.role,
        active: updated.active,
        storeName: updated.storeName,
        lastLoginAt: updated.lastLoginAt,
        createdAt: updated.createdAt,
      });
    } catch (error: any) {
      console.error("Erro ao atualizar usuario:", error);
      res.status(500).json({ message: error?.message || "Erro ao atualizar usuario" });
    }
  });

  return httpServer;
}
