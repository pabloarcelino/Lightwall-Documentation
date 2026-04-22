import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { storage } from "./storage";
import {
  classifyAndExtractTables,
  extractGeometryParallel,
  preAnalyzeProject,
  verifyExtraction,
  describeProject,
  setUserApiKey,
  clearUserApiKey,
  splitPdfPages,
  type PageClassification,
  type GeometryResult,
  type TableData,
  type PreAnalysis,
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
} from "./services/ai/provider";
import {
  fusionMultiView,
  calculateBudget,
  budgetToLegacy,
  inconsistenciasToAlerts,
} from "./services/calculation/engine";
import type { ExtractedWall, ExtractedSlab, ExtractedCorner } from "./services/gemini/planAnalyzer";
import {
  exportToExcel,
  exportToPDF,
  exportToJSON,
} from "./services/export/exportService";

import type { Response } from "express";
import { requireAuth } from "./auth";
import { editImage } from "./replit_integrations/image/client";
import { cvAnalyze, cvAnnotate, isCvServiceAvailable } from "./services/cv/client";

const progressClients = new Map<number, Response[]>();

/**
 * Obtém TODAS as fontes de imagem para anotação (uma por pavimento/planta_baixa).
 * Prioridade: imagem PNG/JPG > páginas planta_baixa do PDF > primeira página do PDF.
 */
async function getAnnotationImageSources(
  files: any[],
  classifications?: PageClassification[],
): Promise<Array<{ pageIndex: number; pavimento: string; base64: string; mimeType: string }>> {
  // 1. Prefer real image files (PNG/JPG/WebP) — single entry, pavimento="all"
  const imageFile = files.find((f: any) => f.fileType === "image" || /\.(png|jpe?g|webp)$/i.test(f.originalName || ""));
  if (imageFile) {
    const buf = await fs.readFile(path.resolve(imageFile.filePath));
    const ext = path.extname(imageFile.originalName || imageFile.filePath).toLowerCase();
    const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
    return [{ pageIndex: 0, pavimento: "all", base64: buf.toString("base64"), mimeType }];
  }

  // 2. Fall back to PDF — extract ALL planta_baixa pages
  const pdfFile = files.find((f: any) => f.fileType === "pdf" || /\.pdf$/i.test(f.originalName || ""));
  if (!pdfFile) return [];

  const pages = await splitPdfPages(path.resolve(pdfFile.filePath));
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

function buildAnnotationPrompt(walls: any[], slabs: any[]): string {
  const enabledWalls = walls.filter((w: any) => w.enabled !== false);
  const externas = enabledWalls.filter((w: any) => w.classe === "externa");
  const internas = enabledWalls.filter((w: any) => w.classe === "interna");
  const murosArr = enabledWalls.filter((w: any) => w.classe === "muro");
  const enabledSlabs = slabs.filter((s: any) => s.enabled !== false);
  const slabPiso = enabledSlabs.filter((s: any) => s.classe === "piso" || s.classe === "radier");
  const slabCoberta = enabledSlabs.filter((s: any) => s.classe === "coberta");

  const fmt = (n: number) => Number(n || 0).toFixed(2);
  // Include bbox coordinates when available so Gemini paints at the right locations
  const wallLine = (w: any) => {
    const bbox = w.bbox || w.box_2d;
    const bboxStr = bbox ? ` [bbox: y${bbox[0]}-${bbox[2]}, x${bbox[1]}-${bbox[3]}]` : "";
    return `${w.id}: ${fmt(w.comprimento_m)}m${bboxStr}`;
  };
  const slabLine = (s: any, i: number) => `${s.id || `L${i + 1}`}: ${fmt(s.area_m2)}m2`;

  const hasBbox = enabledWalls.some((w: any) => w.bbox || w.box_2d);

  return `Pinte contornos coloridos semi-transparentes sobre esta planta arquitetonica para identificar elementos Lightwall.

REGRAS:
- NAO altere o desenho tecnico por baixo. Apenas sobreponha cores.
- Use contornos GROSSOS (3-5px) e fill semi-transparente.
- A planta original deve continuar visivel.
${hasBbox ? `- Cada parede inclui coordenadas [bbox: ymin-ymax, xmin-xmax] normalizadas 0-1000. Use estas coordenadas para localizar EXATAMENTE cada parede na imagem.` : ""}
- REGRA ANTI-SOBREPOSICAO: Se uma parede EXTERNA e uma INTERNA compartilham uma borda, pinte SOMENTE a cor EXTERNA. Externas tem precedencia visual.
- TAGS OBRIGATORIAS: Em CADA parede e laje pintada, escreva o ID (P1, P2, M1, L1...) como TAG visivel. Use texto BRANCO GRANDE em negrito com fundo retangular da cor do elemento. Posicione a tag NO CENTRO do elemento. A tag deve ser legivel mesmo em zoom reduzido.

CORES:
- Paredes EXTERNAS → CIANO (#06b6d4) contorno + fill 35%
- Paredes INTERNAS → LARANJA (#f97316) contorno + fill 35%
- MUROS → ROXO (#a855f7) contorno + fill 35%
- LAJE PISO → VERDE (#10b981) fill 25%
- LAJE COBERTA → VERMELHO (#ef4444) fill 25%

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

Resultado: planta original visivel com paredes contornadas em ciano/laranja/roxo e areas de laje em verde/vermelho semi-transparente.`;
}

const pipelineStartTimes = new Map<number, number>();

function sendProgress(projectId: number, step: number, label: string, status: "running" | "done" | "error", detail?: string) {
  const clients = progressClients.get(projectId) || [];
  const now = Date.now();
  const startTime = pipelineStartTimes.get(projectId) || now;
  const elapsed = now - startTime;
  const data = JSON.stringify({ step, label, status, detail, timestamp: now, elapsed });
  for (const client of clients) {
    try { client.write(`data: ${data}\n\n`); } catch {}
  }
}

const upload = multer({
  dest: "server/uploads/projects/",
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
      "image/bmp",
      "image/tiff",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Formato não suportado. Use PDF, PNG, JPG, WEBP, BMP ou TIFF."));
    }
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/auth/")) return next();
    return requireAuth(req, res, next);
  });

  const savedGeminiKey = await storage.getSetting("gemini_api_key");
  if (savedGeminiKey && savedGeminiKey.length > 0) {
    setUserApiKey(savedGeminiKey);
  }

  const savedOpenAIKey = await storage.getSetting("openai_api_key");
  if (savedOpenAIKey && savedOpenAIKey.length > 0) {
    setOpenAIApiKey(savedOpenAIKey);
  }

  app.get("/api/settings/gemini-key", async (_req, res) => {
    try {
      const apiKey = await storage.getSetting("gemini_api_key");
      res.json({ hasKey: !!apiKey, maskedKey: apiKey ? `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}` : null });
    } catch (error) {
      console.error("Erro ao buscar configuracao:", error);
      res.status(500).json({ message: "Erro ao buscar configuracao" });
    }
  });

  app.post("/api/settings/gemini-key", async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
        return res.status(400).json({ message: "Chave de API invalida" });
      }
      await storage.setSetting("gemini_api_key", apiKey.trim());
      setUserApiKey(apiKey.trim());
      res.json({ success: true, message: "Chave de API salva com sucesso" });
    } catch (error) {
      console.error("Erro ao salvar chave:", error);
      res.status(500).json({ message: "Erro ao salvar chave de API" });
    }
  });

  app.delete("/api/settings/gemini-key", async (_req, res) => {
    try {
      await storage.setSetting("gemini_api_key", "");
      clearUserApiKey();
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
      const apiKey = await storage.getSetting("openai_api_key");
      res.json({ hasKey: !!apiKey, maskedKey: apiKey ? `sk-...${apiKey.substring(apiKey.length - 4)}` : null });
    } catch (error) {
      console.error("Erro ao buscar config OpenAI:", error);
      res.status(500).json({ message: "Erro ao buscar configuracao" });
    }
  });

  app.post("/api/settings/openai-key", async (req, res) => {
    try {
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
      const id = parseInt(req.params.id);
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
      const id = parseInt(req.params.id);
      await storage.deleteProduct(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Erro ao excluir produto:", error);
      res.status(500).json({ message: "Erro ao excluir produto" });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const { name, clientName, description, buildingType } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Nome do projeto é obrigatório" });
      }
      const validTypes = ["residencial", "comercial", "institucional", "industrial", "outro"];
      const project = await storage.createProject({
        name,
        clientName: clientName || null,
        description: description || null,
        buildingType: buildingType && validTypes.includes(buildingType) ? buildingType : null,
        status: "draft",
      });
      res.json(project);
    } catch (error) {
      console.error("Erro ao criar projeto:", error);
      res.status(500).json({ message: "Erro ao criar projeto" });
    }
  });

  app.get("/api/projects", async (_req, res) => {
    try {
      const projects = await storage.getProjects();
      const projectsWithBudget = await Promise.all(
        projects.map(async (p) => {
          const budget = await storage.getBudget(p.id);
          return {
            ...p,
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
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      if (!project) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const files = await storage.getProjectFiles(id);
      const extracted = await storage.getExtractedData(id);
      const budget = await storage.getBudget(id);
      res.json({
        project: { ...project, budgetTotalCost: budget?.totalCost ?? null },
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
      const id = parseInt(req.params.id);
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
      const fileId = parseInt(req.params.fileId);
      const targetFile = await storage.getProjectFile(fileId);
      if (!targetFile) {
        return res.status(404).json({ message: "Arquivo nao encontrado" });
      }
      const filePath = path.resolve(targetFile.filePath);
      await fs.access(filePath);
      const mimeTypes: Record<string, string> = {
        pdf: "application/pdf",
        image: "image/png",
      };
      const ext = targetFile.originalName?.split(".").pop()?.toLowerCase();
      let contentType = mimeTypes[targetFile.fileType] || "application/octet-stream";
      if (ext === "jpg" || ext === "jpeg") contentType = "image/jpeg";
      else if (ext === "png") contentType = "image/png";
      else if (ext === "webp") contentType = "image/webp";
      else if (ext === "bmp") contentType = "image/bmp";
      else if (ext === "tif" || ext === "tiff") contentType = "image/tiff";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `inline; filename="${targetFile.originalName}"`);
      const data = await fs.readFile(filePath);
      res.send(data);
    } catch (error) {
      console.error("Erro ao servir arquivo:", error);
      res.status(500).json({ message: "Erro ao servir arquivo" });
    }
  });

  app.delete("/api/files/:fileId", async (req, res) => {
    try {
      const fileId = parseInt(req.params.fileId);
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
    const projectId = parseInt(req.params.id);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const clients = progressClients.get(projectId) || [];
    clients.push(res);
    progressClients.set(projectId, clients);

    req.on("close", () => {
      const remaining = (progressClients.get(projectId) || []).filter(c => c !== res);
      if (remaining.length === 0) progressClients.delete(projectId);
      else progressClients.set(projectId, remaining);
    });
  });

  app.post(
    "/api/projects/:id/upload",
    upload.array("files", 20),
    async (req, res) => {
      try {
        const projectId = parseInt(req.params.id);
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
          const fileType = ext === ".pdf" ? "pdf" : "image";

          const saved = await storage.addProjectFile({
            projectId,
            originalName: file.originalname,
            filePath: file.path,
            fileType,
            fileSize: file.size,
            pageType: null,
          });
          savedFiles.push(saved);
        }

        res.json({ files: savedFiles });
      } catch (error) {
        console.error("Erro no upload:", error);
        res.status(500).json({ message: "Erro no upload de arquivos" });
      }
    },
  );

  app.post("/api/projects/:id/process", async (req, res) => {
    const projectId = parseInt(req.params.id);
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
    try {
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Projeto não encontrado" });
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
      pipelineStartTimes.set(projectId, Date.now());

      const allClassifications: PageClassification[] = [];
      const allGeometries: GeometryResult[] = [];
      let mergedTableData: TableData = { paredes_de_tabela: [], esquadrias_de_tabela: [], areas_de_tabela: [] };
      const pipelineFailedPages: Array<{ fileId: number; fileName: string; pageIndex: number }> = [];
      const cvAnnotatedImages: Array<{ pavimento: string; pageIndex: number; image: string }> = [];
      const cvServiceUp = analysisMode !== "gemini-only" ? await isCvServiceAvailable() : false;
      if (analysisMode === "gemini-only") console.log("[PIPELINE] Modo Gemini-only selecionado");
      else if (cvServiceUp) console.log("[PIPELINE] CV service disponivel");
      else console.log("[PIPELINE] CV service indisponivel — fallback para Gemini-only");
      const userBuildingType = project.buildingType || undefined;
      let detectedBuildingType: string | undefined;
      const effectiveBuildingType = (): string | undefined => userBuildingType || detectedBuildingType;
      let preAnalysis: PreAnalysis | null = null;
      let effectivePeDireito = peDireito;

      for (const file of files) {
        try {
          sendProgress(projectId, 1, "Classificacao + Tabelas", "running", `Classificando e extraindo tabelas de ${file.originalName} (chamada unificada, paginas em paralelo)...`);
          const ctResult = await classifyAndExtractTables(file.filePath, file.fileType, 3, !!userBuildingType);
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

          // ETAPA 2 — Pre-analise (run once, on first file with geometry pages)
          if (!preAnalysis) {
            sendProgress(projectId, 2, "Pre-analise", "running", `Analisando estrutura de ${file.originalName}...`);
            try {
              preAnalysis = await preAnalyzeProject(file.filePath, file.fileType, allClassifications);
              const ambCount = preAnalysis.ambientes.length;
              const pavList = preAnalysis.pavimentos.join(", ");
              sendProgress(projectId, 2, "Pre-analise", "done",
                `${preAnalysis.tipo_edificacao} | Pav: ${pavList} | ${ambCount} ambientes | PD=${preAnalysis.pe_direito_estimado}m`);
              // Use pre-analysis pe-direito if user didn't override
              if (peDireito === 3.0 && preAnalysis.pe_direito_estimado !== 3.0) {
                effectivePeDireito = preAnalysis.pe_direito_estimado;
                console.log(`[PIPELINE] Pe-direito da pre-analise: ${effectivePeDireito}m`);
              }
            } catch (preErr: any) {
              console.warn("[ETAPA 2] Pre-analise falhou:", preErr.message);
              sendProgress(projectId, 2, "Pre-analise", "done", "Fallback: sem pre-analise");
            }
          }

          const hasGeometryPages = classifications.some(c =>
            c.classificacao === "planta_baixa" ||
            c.classificacao === "planta_cobertura" ||
            c.classificacao === "corte" ||
            c.classificacao === "fachada" ||
            c.classificacao === "detalhe_construtivo"
          );

          if (hasGeometryPages || classifications.every(c => c.classificacao !== "irrelevante")) {
            const plantaPages = classifications.filter(c => c.classificacao === "planta_baixa");

            // Helper: run CV pipeline for planta pages
            const runCvPipeline = async (): Promise<GeometryResult | null> => {
              if (!cvServiceUp || plantaPages.length === 0) return null;
              const pages = await splitPdfPages(path.resolve(file.filePath));
              const cvGeo: GeometryResult = { walls: [], slabs: [], corners: [] };
              for (const pc of plantaPages) {
                const page = pages.find(p => p.pageIndex === pc.page_index);
                if (!page) continue;
                const raw64 = page.base64.includes(",") ? page.base64.split(",", 2)[1] : page.base64;
                const cvResult = await cvAnalyze({
                  image_base64: raw64,
                  mime_type: "application/pdf",
                  pavimento: pc.pavimento || "Terreo",
                  building_type: effectiveBuildingType() || "residencial",
                  gemini_api_key: undefined,
                  page_index: pc.page_index,
                });
                cvGeo.walls.push(...cvResult.geometry.walls);
                cvGeo.slabs.push(...cvResult.geometry.slabs);
                cvGeo.corners.push(...cvResult.geometry.corners);
                if (cvResult.annotated_image_base64) {
                  cvAnnotatedImages.push({ pavimento: pc.pavimento || "Terreo", pageIndex: pc.page_index, image: cvResult.annotated_image_base64 });
                }
                console.log(`[ETAPA 3 CV] Pav ${pc.pavimento} pg ${pc.page_index}: ${cvResult.geometry.walls.length} paredes, ${cvResult.geometry.slabs.length} lajes (OCR=${cvResult.cv_metadata?.ocr_count}, lines=${cvResult.cv_metadata?.line_count})`);
              }
              return cvGeo;
            };

            // Helper: run Gemini-only pipeline (Flash extraction + Flash per-floor verification, all parallel)
            const runGeminiPipeline = async (): Promise<GeometryResult> => {
              const geoResult = await extractGeometryParallel(file.filePath, file.fileType, classifications, 3, effectiveBuildingType(), effectivePeDireito, preAnalysis);
              for (const p of geoResult.failedPages) {
                pipelineFailedPages.push({ fileId: file.id, fileName: file.originalName, pageIndex: p });
                recordFailedPage({ fileId: file.id, fileName: file.originalName, pageIndex: p, reason: "Falha na extracao geometrica" });
              }
              const geometry: GeometryResult = { walls: geoResult.walls, slabs: geoResult.slabs, corners: geoResult.corners };
              // Per-floor verification already done inside extractGeometryParallel
              sendProgress(projectId, 3.5, "Verificacao IA", "done", `${geometry.walls.length} paredes, ${geometry.slabs.length} lajes (verificacao per-floor integrada)`);
              return geometry;
            };

            // Helper: store geometry in DB
            const storeGeometry = async (geometry: GeometryResult) => {
              for (const wall of geometry.walls) {
                await storage.addExtractedData({ projectId, fileId: file.id, elementType: "parede", data: wall, hasAssumption: 0 });
              }
              for (const slab of geometry.slabs) {
                await storage.addExtractedData({ projectId, fileId: file.id, elementType: "laje", data: slab, hasAssumption: 0 });
              }
              for (const corner of geometry.corners) {
                await storage.addExtractedData({ projectId, fileId: file.id, elementType: "canto", data: corner, hasAssumption: 0 });
              }
            };

            // ===== Execute based on analysisMode =====
            if (analysisMode === "combinada" && cvServiceUp && plantaPages.length > 0) {
              // COMBINADA: run both in parallel, merge via fusionMultiView
              sendProgress(projectId, 3, "Extracao Geometrica (Combinada)", "running", `Executando CV + Gemini em paralelo para ${file.originalName}...`);
              sendProgress(projectId, 3.5, "Verificacao IA", "running", `Verificando extracao de ${file.originalName}...`);
              const [cvResult, geminiResult] = await Promise.all([
                runCvPipeline().catch((e: any) => { console.warn(`[ETAPA 3] CV falhou no modo combinada: ${e.message}`); return null; }),
                runGeminiPipeline(),
              ]);
              if (cvResult) {
                allGeometries.push(cvResult);
                console.log(`[ETAPA 3] Combinada CV: ${cvResult.walls.length} paredes, ${cvResult.slabs.length} lajes`);
              }
              allGeometries.push(geminiResult);
              console.log(`[ETAPA 3] Combinada Gemini: ${geminiResult.walls.length} paredes, ${geminiResult.slabs.length} lajes`);
              const totalWalls = (cvResult?.walls.length || 0) + geminiResult.walls.length;
              const totalSlabs = (cvResult?.slabs.length || 0) + geminiResult.slabs.length;
              sendProgress(projectId, 3, "Extracao Geometrica (Combinada)", "done", `${totalWalls} paredes, ${totalSlabs} lajes (CV + Gemini, antes da fusao)`);
              // Store combined results
              const combined: GeometryResult = {
                walls: [...(cvResult?.walls || []), ...geminiResult.walls],
                slabs: [...(cvResult?.slabs || []), ...geminiResult.slabs],
                corners: [...(cvResult?.corners || []), ...geminiResult.corners],
              };
              await storeGeometry(combined);

            } else if (analysisMode === "cv-gemini" && cvServiceUp && plantaPages.length > 0) {
              // CV + GEMINI: try CV, fallback to Gemini
              sendProgress(projectId, 3, "Extracao Geometrica (CV + IA)", "running", `Analisando ${file.originalName} via Computer Vision + Gemini...`);
              let usedCv = false;
              try {
                const cvResult = await runCvPipeline();
                if (cvResult) {
                  allGeometries.push(cvResult);
                  await storeGeometry(cvResult);
                  sendProgress(projectId, 3, "Extracao Geometrica (CV + IA)", "done", `${cvResult.walls.length} paredes, ${cvResult.slabs.length} lajes, ${cvResult.corners.length} cantos (CV + IA)`);
                  usedCv = true;
                }
              } catch (cvError: any) {
                console.warn(`[ETAPA 3] CV falhou: ${cvError.message}. Caindo para Gemini-only.`);
              }
              if (!usedCv) {
                sendProgress(projectId, 3, "Extracao Geometrica", "running", `Fallback Gemini-only para ${file.originalName}...`);
                sendProgress(projectId, 3.5, "Verificacao IA", "running", `Verificando extracao de ${file.originalName}...`);
                const geometry = await runGeminiPipeline();
                allGeometries.push(geometry);
                await storeGeometry(geometry);
                sendProgress(projectId, 3, "Extracao Geometrica", "done", `${geometry.walls.length} paredes, ${geometry.slabs.length} lajes, ${geometry.corners.length} cantos`);
              }

            } else {
              // GEMINI-ONLY (or CV unavailable)
              sendProgress(projectId, 3, "Extracao Geometrica", "running", `Analisando geometria de ${file.originalName} (Gemini-only)...`);
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

      sendProgress(projectId, 4, "Fusao Multivista", "running", "Cruzando dados de todas as paginas...");
      const hasTableData = mergedTableData.paredes_de_tabela.length > 0 || mergedTableData.esquadrias_de_tabela.length > 0;
      const fused = fusionMultiView(allGeometries, hasTableData ? mergedTableData : null, effectiveBuildingType());
      sendProgress(projectId, 4, "Fusao Multivista", "done", `${fused.walls.length} paredes, ${fused.slabs.length} lajes, ${fused.corners.length} cantos (apos deduplicacao)`);

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

      // Apply effective pe-direito to walls without explicit height
      if (effectivePeDireito !== 3.0) {
        for (const w of scopedWalls) {
          if (!w.altura_m || w.altura_m <= 0) w.altura_m = effectivePeDireito;
        }
      }

      sendProgress(projectId, 5, "Calculo de Quantitativos", "running", "Calculando paineis por pavimento...");
      const budget = calculateBudget(scopedWalls, scopedSlabs, scopedCorners);
      const pavNames = budget.pavimentos.map(p => p.nome).join(", ");
      sendProgress(projectId, 5, "Calculo de Quantitativos", "done", `${budget.resumo.total_geral_paineis} paineis total | Pavimentos: ${pavNames} | 2P=${budget.consolidado_por_tipo[0]?.quantidade_total_paineis}`);

      sendProgress(projectId, 6, "Integracao com Catalogo", "running", "Calculando custos no formato de proposta Lightwall...");
      const allProducts = await storage.getProducts();
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

      const propostaItens: Array<{ item: number; local: string; discriminacao: string; qtd_un: number; qtd_m2: number; preco_m2: number; preco_total: number }> = [];
      let lineNo = 1;
      propostaItens.push({ item: lineNo++, local: "PAREDES EXTERNAS", discriminacao: PRODUCT_NAME_EXT, qtd_un: extPanels, qtd_m2: extArea, preco_m2: PRECO_M2_EXT, preco_total: extCost });
      propostaItens.push({ item: lineNo++, local: "PAREDES INTERNAS", discriminacao: PRODUCT_NAME_INT, qtd_un: intPanels, qtd_m2: intArea, preco_m2: PRECO_M2_INT, preco_total: intCost });
      if (murosPanels > 0) {
        propostaItens.push({ item: lineNo++, local: "MUROS (DIVISA)", discriminacao: PRODUCT_NAME_MUROS, qtd_un: murosPanels, qtd_m2: murosArea, preco_m2: PRECO_M2_MUROS, preco_total: murosCost });
      }
      propostaItens.push({ item: lineNo++, local: "LAJE DE PISO", discriminacao: PRODUCT_NAME_PISO, qtd_un: pisoPanels, qtd_m2: pisoArea, preco_m2: PRECO_M2_PISO, preco_total: pisoCost });
      propostaItens.push({ item: lineNo++, local: "LAJE COBERTA", discriminacao: PRODUCT_NAME_COBERTA, qtd_un: cobertaPanels, qtd_m2: cobertaArea, preco_m2: PRECO_M2_COBERTA, preco_total: cobertaCost });
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
      if (preAnalysis) {
        await storage.addExtractedData({
          projectId, fileId: null, elementType: "etapa2_preanalise",
          data: { etapa: 2, label: "Pre-analise do Projeto", resultado: preAnalysis },
          hasAssumption: 0,
        });
      }
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
      await storage.addExtractedData({
        projectId, fileId: null, elementType: "etapa4_fusao",
        data: {
          etapa: 4, label: "Fusao Multivista (apos deduplicacao)",
          resultado: { walls: fusaoWallsWithScope, slabs: fusaoSlabsWithScope, corners: fusaoCornersWithScope },
          scope,
        },
        hasAssumption: 0,
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

        if (cvAnnotatedImages.length > 0) {
          // ---- CV path: use pre-computed deterministic images from Python renderer ----
          sendProgress(projectId, 7.5, "Imagem Anotada", "running", "Usando imagens anotadas do pipeline CV (deterministico)...");

          // Build annotatedImages with summary per floor
          const annotatedImages = cvAnnotatedImages.map(cv => {
            const floorWalls = totalWalls.filter((w: any) => cv.pavimento === "all" || w.nivel === cv.pavimento);
            const floorSlabs = totalSlabs.filter((s: any) => cv.pavimento === "all" || s.nivel === cv.pavimento);
            return {
              ...cv,
              summary: {
                externas: floorWalls.filter((w: any) => w.classe === "externa").length,
                internas: floorWalls.filter((w: any) => w.classe === "interna").length,
                muros: floorWalls.filter((w: any) => w.classe === "muro").length,
                lajePiso: floorSlabs.filter((s: any) => s.classe === "piso" || s.classe === "radier").length,
                lajeCoberta: floorSlabs.filter((s: any) => s.classe === "coberta").length,
              },
            };
          });

          const sourceFileId = files.find((f: any) => f.fileType === "image" || /\.(png|jpe?g|webp)$/i.test(f.originalName || ""))?.id
            || files.find((f: any) => f.fileType === "pdf")?.id
            || null;

          await storage.addExtractedData({
            projectId, fileId: sourceFileId, elementType: "etapa3_annotated_plan",
            data: {
              etapa: 4.5, label: "Imagem Anotada (CV pipeline)",
              image: annotatedImages[0].image,
              images: annotatedImages,
              summary: summaryAll,
              generatedAt: new Date().toISOString(),
              source: "cv_pipeline",
            },
            hasAssumption: 0,
          });

          const totalKB = annotatedImages.reduce((s, img) => s + Math.round(img.image.length / 1024), 0);
          sendProgress(projectId, 7.5, "Imagem Anotada", "done", `${annotatedImages.length} imagem(ns) via CV pipeline (${totalKB}KB) | ${totalWalls.length} paredes`);

        } else {
          // ---- Fallback: Gemini image editing (original path) ----
          sendProgress(projectId, 7.5, "Imagem Anotada", "running", "Extraindo paginas da planta e gerando imagens anotadas com IA...");
          const imgSources = await getAnnotationImageSources(files, allClassifications);
          if (imgSources.length > 0) {
            const annotatedImages: Array<{ pavimento: string; pageIndex: number; image: string; summary: any }> = [];

            for (const src of imgSources) {
              const floorWalls = fusaoWallsWithScope.filter((w: any) =>
                src.pavimento === "all" || w.nivel === src.pavimento
              );
              const floorSlabs = fusaoSlabsWithScope.filter((s: any) =>
                src.pavimento === "all" || s.nivel === src.pavimento
              );
              const enabledFloorWalls = floorWalls.filter((w: any) => w.enabled !== false);
              const enabledFloorSlabs = floorSlabs.filter((s: any) => s.enabled !== false);

              if (enabledFloorWalls.length === 0 && enabledFloorSlabs.length === 0) continue;

              try {
                const prompt = buildAnnotationPrompt(floorWalls, floorSlabs);
                const dataUrl = await editImage(prompt, [{ data: src.base64, mimeType: src.mimeType }]);
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
                console.log(`[ETAPA 4.5] Imagem anotada ${src.pavimento} (pg ${src.pageIndex}): ${Math.round(dataUrl.length / 1024)}KB`);
              } catch (floorError: any) {
                console.error(`[ETAPA 4.5] Falha na imagem do pav ${src.pavimento}:`, floorError?.message);
              }
            }

            if (annotatedImages.length > 0) {
              const sourceFileId = files.find((f: any) => f.fileType === "image" || /\.(png|jpe?g|webp)$/i.test(f.originalName || ""))?.id
                || files.find((f: any) => f.fileType === "pdf")?.id
                || null;
              await storage.addExtractedData({
                projectId, fileId: sourceFileId, elementType: "etapa3_annotated_plan",
                data: {
                  etapa: 4.5, label: "Imagem Anotada (auto-gerada)",
                  image: annotatedImages[0].image,
                  images: annotatedImages,
                  summary: summaryAll,
                  generatedAt: new Date().toISOString(),
                },
                hasAssumption: 0,
              });
              const totalKB = annotatedImages.reduce((s, img) => s + Math.round(img.image.length / 1024), 0);
              sendProgress(projectId, 7.5, "Imagem Anotada", "done", `${annotatedImages.length} imagem(ns) gerada(s) (${totalKB}KB) | ${totalWalls.length} paredes`);
            } else {
              sendProgress(projectId, 7.5, "Imagem Anotada", "done", "Nenhuma imagem gerada (sem paredes/lajes habilitadas)");
            }
          } else {
            sendProgress(projectId, 7.5, "Imagem Anotada", "done", "Nenhum arquivo de planta encontrado para anotacao");
          }
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

      sendProgress(projectId, 8, "Descricao do Projeto", "running", "A IA esta analisando profundamente as imagens para descrever o projeto...");
      const filePaths = files.map(f => ({ path: f.filePath, fileType: f.fileType, name: f.originalName }));
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
      const projectDescription = await describeProject(filePaths, allClassifications, geometrySummary, budgetSummaryForDesc);
      const descriptionFailed = projectDescription.startsWith("Nao foi possivel");
      if (descriptionFailed) {
        sendProgress(projectId, 8, "Descricao do Projeto", "error", "Falha ao gerar descricao automatica. O orcamento foi calculado normalmente.");
      } else {
        sendProgress(projectId, 8, "Descricao do Projeto", "done", projectDescription.substring(0, 150) + "...");
      }

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
          total_paineis_un: budget.resumo.total_geral_paineis,
          total_area_m2: totalAreaM2,
          total_paineis_cost: totalPanelCost,
          paginacao: propostaPaginacao,
          grandTotal: totalCost,
          preco_m2_ext: PRECO_M2_EXT,
          preco_m2_int: PRECO_M2_INT,
          preco_m2_muros: PRECO_M2_MUROS,
          preco_m2_piso: PRECO_M2_PISO,
          preco_m2_coberta: PRECO_M2_COBERTA,
          painel_ext: PRODUCT_NAME_EXT,
          painel_int: PRODUCT_NAME_INT,
          painel_muros: PRODUCT_NAME_MUROS,
          painel_piso: PRODUCT_NAME_PISO,
          painel_coberta: PRODUCT_NAME_COBERTA,
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

      await storage.createBudget({
        projectId,
        budgetData,
        totalArea: String(legacy.totals.totalWallArea + legacy.totals.totalSlabArea),
        totalCost: String(totalCost),
        status: "completed",
      });

      await storage.updateProjectStatus(projectId, "completed");
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
      sendProgress(projectId, 0, "Erro", "error", userMsg);
      pipelineStartTimes.delete(projectId);
      await storage.updateProjectStatus(projectId, "error");
      cleanupApiMetrics(projectId);
      res.status(500).json({ message: userMsg });
    }
  });

  app.put("/api/projects/:id", async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const { name, clientName, description, projectType, buildingType, realCost, realAreaExt, realAreaInt, realAreaMuros, realAreaPiso, realAreaCoberta } = req.body;
      const validBuildingTypes = ["residencial", "comercial", "institucional", "industrial", "outro"];
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (clientName !== undefined) updateData.clientName = clientName;
      if (description !== undefined) updateData.description = description;
      if (projectType !== undefined) updateData.projectType = projectType;
      if (buildingType !== undefined) updateData.buildingType = (buildingType && validBuildingTypes.includes(buildingType)) ? buildingType : null;
      if (realCost !== undefined) updateData.realCost = realCost;
      if (realAreaExt !== undefined) updateData.realAreaExt = realAreaExt;
      if (realAreaInt !== undefined) updateData.realAreaInt = realAreaInt;
      if (realAreaMuros !== undefined) updateData.realAreaMuros = realAreaMuros;
      if (realAreaPiso !== undefined) updateData.realAreaPiso = realAreaPiso;
      if (realAreaCoberta !== undefined) updateData.realAreaCoberta = realAreaCoberta;
      const updated = await storage.updateProject(projectId, updateData);
      if (!updated) return res.status(404).json({ message: "Projeto nao encontrado" });
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
      const projectId = parseInt(req.params.id);
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

      const allProducts = await storage.getProducts();
      const existingBudgetForPrices = await storage.getBudget(projectId);
      const prevProposta = (existingBudgetForPrices?.budgetData as any)?.proposta;
      const productExtDefault = allProducts.find((p) => p.sku === "LW-2P-090");
      const productIntDefault = allProducts.find((p) => p.sku === "LW-SP-090") || productExtDefault;
      const PRECO_M2_EXT = prevProposta?.preco_m2_ext ?? parseFloat(productExtDefault?.unitPrice ?? "275");
      const PRECO_M2_INT = prevProposta?.preco_m2_int ?? parseFloat(productIntDefault?.unitPrice ?? "180");
      const PRECO_M2_MUROS = prevProposta?.preco_m2_muros ?? PRECO_M2_INT;
      const PRECO_M2_PISO = prevProposta?.preco_m2_piso ?? PRECO_M2_EXT;
      const PRECO_M2_COBERTA = prevProposta?.preco_m2_coberta ?? PRECO_M2_EXT;
      const PRODUCT_NAME_EXT = prevProposta?.painel_ext ?? productExtDefault?.name ?? "PAINEL DE CONCRETO LEVE 3000X610X90MM 2P";
      const PRODUCT_NAME_INT = prevProposta?.painel_int ?? productIntDefault?.name ?? "PAINEL DE CONCRETO LEVE 3000X610X90MM SP";
      const PRODUCT_NAME_MUROS = prevProposta?.painel_muros ?? PRODUCT_NAME_INT;
      const PRODUCT_NAME_PISO = prevProposta?.painel_piso ?? PRODUCT_NAME_EXT;
      const PRODUCT_NAME_COBERTA = prevProposta?.painel_coberta ?? PRODUCT_NAME_EXT;
      const pagProduct = allProducts.find((p) => p.sku === "PROJ-PAG");
      const PRECO_PAGINACAO_M2 = pagProduct ? parseFloat(pagProduct.unitPrice) : 11;

      const AREA_PAINEL = 1.83;
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

      const propostaItens: Array<{ item: number; local: string; discriminacao: string; qtd_un: number; qtd_m2: number; preco_m2: number; preco_total: number }> = [];
      let lineNo = 1;
      propostaItens.push({ item: lineNo++, local: "PAREDES EXTERNAS", discriminacao: PRODUCT_NAME_EXT, qtd_un: extPanels, qtd_m2: extArea, preco_m2: PRECO_M2_EXT, preco_total: extCost });
      propostaItens.push({ item: lineNo++, local: "PAREDES INTERNAS", discriminacao: PRODUCT_NAME_INT, qtd_un: intPanels, qtd_m2: intArea, preco_m2: PRECO_M2_INT, preco_total: intCost });
      if (murosPanels > 0) {
        propostaItens.push({ item: lineNo++, local: "MUROS (DIVISA)", discriminacao: PRODUCT_NAME_MUROS, qtd_un: murosPanels, qtd_m2: murosArea, preco_m2: PRECO_M2_MUROS, preco_total: murosCost });
      }
      propostaItens.push({ item: lineNo++, local: "LAJE DE PISO", discriminacao: PRODUCT_NAME_PISO, qtd_un: pisoPanels, qtd_m2: pisoArea, preco_m2: PRECO_M2_PISO, preco_total: pisoCost });
      propostaItens.push({ item: lineNo++, local: "LAJE COBERTA", discriminacao: PRODUCT_NAME_COBERTA, qtd_un: cobertaPanels, qtd_m2: cobertaArea, preco_m2: PRECO_M2_COBERTA, preco_total: cobertaCost });
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
          total_paineis_un: budget.resumo.total_geral_paineis,
          total_area_m2: totalAreaM2,
          total_paineis_cost: totalPanelCost,
          paginacao: propostaPaginacao,
          grandTotal: totalCost,
          preco_m2_ext: PRECO_M2_EXT,
          preco_m2_int: PRECO_M2_INT,
          preco_m2_muros: PRECO_M2_MUROS,
          preco_m2_piso: PRECO_M2_PISO,
          preco_m2_coberta: PRECO_M2_COBERTA,
          painel_ext: PRODUCT_NAME_EXT,
          painel_int: PRODUCT_NAME_INT,
          painel_muros: PRODUCT_NAME_MUROS,
          painel_piso: PRODUCT_NAME_PISO,
          painel_coberta: PRODUCT_NAME_COBERTA,
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
      const projectId = parseInt(req.params.id);
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
      const projectId = parseInt(req.params.id);
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

      const imgSources = await getAnnotationImageSources(files, classifications);
      if (imgSources.length === 0) {
        return res.status(400).json({ message: "Nenhum arquivo de planta encontrado (PDF ou imagem)." });
      }

      const annotatedImages: Array<{ pavimento: string; pageIndex: number; image: string; summary: any }> = [];
      const cvUp = await isCvServiceAvailable();

      for (const src of imgSources) {
        const floorWalls = walls.filter((w: any) => src.pavimento === "all" || w.nivel === src.pavimento);
        const floorSlabs = slabs.filter((s: any) => src.pavimento === "all" || s.nivel === src.pavimento);
        const enabledFloorWalls = floorWalls.filter((w: any) => w.enabled !== false);
        const enabledFloorSlabs = floorSlabs.filter((s: any) => s.enabled !== false);
        if (enabledFloorWalls.length === 0 && enabledFloorSlabs.length === 0) continue;

        console.log(`[ANNOTATED-IMG] Gerando imagem ${src.pavimento} (pg ${src.pageIndex}) | ${enabledFloorWalls.length} paredes, ${enabledFloorSlabs.length} lajes`);

        let dataUrl: string;
        if (cvUp) {
          // Use Python CV renderer (deterministic, fast, free)
          const raw64 = src.base64.includes(",") ? src.base64.split(",", 2)[1] : src.base64;
          dataUrl = await cvAnnotate({
            image_base64: raw64,
            mime_type: src.mimeType,
            walls: enabledFloorWalls,
            slabs: enabledFloorSlabs,
          });
        } else {
          // Fallback: Gemini image editing
          const prompt = buildAnnotationPrompt(floorWalls, floorSlabs);
          dataUrl = await editImage(prompt, [{ data: src.base64, mimeType: src.mimeType }]);
        }

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

  return httpServer;
}
