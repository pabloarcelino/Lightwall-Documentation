import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { requireAuth } from "./auth";
import { AiTakeoffService } from "./services/takeoff/aiTakeoffService";
import {
  computePxPerMeter,
  recomputeSegmentGeometry,
  areaInSquareMeters,
  lengthInMeters,
} from "./services/takeoff/geometry";
import { exportTakeoffExcel, exportTakeoffPdf } from "./services/takeoff/exporters";
import {
  insertProjectPageSchema,
  insertTakeoffSegmentSchema,
  insertTakeoffSlabSchema,
  TAKEOFF_SEGMENT_CATEGORY,
  TAKEOFF_LEVEL,
  TAKEOFF_GEOMETRY,
  TAKEOFF_SLAB_CATEGORY,
  type TakeoffPoint,
} from "@shared/schema";
import { z } from "zod";

const PointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

const CreatePagesBody = z.object({
  pages: z
    .array(
      z.object({
        fileId: z.number().nullable().optional(),
        pageNumber: z.number(),
        imageData: z.string(),
        widthPx: z.number(),
        heightPx: z.number(),
        pageLabel: z.string().nullable().optional(),
        pavimento: z.string().nullable().optional(),
      }),
    )
    .min(1),
  replaceExisting: z.boolean().optional().default(true),
});

const UpdatePageBody = z.object({
  selectedForAnalysis: z.boolean().optional(),
  pageLabel: z.string().nullable().optional(),
  pavimento: z.string().nullable().optional(),
  scaleText: z.string().nullable().optional(),
});

const CalibratePageBody = z.object({
  point1: PointSchema,
  point2: PointSchema,
  realMeters: z.number().positive(),
});

const CreateSegmentBody = z.object({
  pageId: z.number(),
  category: z.enum(TAKEOFF_SEGMENT_CATEGORY),
  level: z.enum(TAKEOFF_LEVEL),
  geometryType: z.enum(TAKEOFF_GEOMETRY).optional().default("line"),
  points: z.array(PointSchema).min(2),
  heightM: z.number().nullable().optional(),
  code: z.string().nullable().optional(),
});

const UpdateSegmentBody = z.object({
  category: z.enum(TAKEOFF_SEGMENT_CATEGORY).optional(),
  level: z.enum(TAKEOFF_LEVEL).optional(),
  geometryType: z.enum(TAKEOFF_GEOMETRY).optional(),
  points: z.array(PointSchema).min(2).optional(),
  heightM: z.number().nullable().optional(),
  lengthMFinal: z.number().nullable().optional(),
  code: z.string().nullable().optional(),
  reviewed: z.boolean().optional(),
  needsReview: z.boolean().optional(),
  evidence: z.string().nullable().optional(),
  openingsDetected: z.boolean().optional(),
  grossOrNet: z.enum(["bruta", "liquida", "nao_aplicavel"]).optional(),
});

const CreateSlabBody = z.object({
  pageId: z.number(),
  category: z.enum(TAKEOFF_SLAB_CATEGORY),
  level: z.string(),
  polygon: z.array(PointSchema).min(3),
  code: z.string().nullable().optional(),
  areaM2Declared: z.number().nullable().optional(),
});

const UpdateSlabBody = z.object({
  category: z.enum(TAKEOFF_SLAB_CATEGORY).optional(),
  level: z.string().optional(),
  polygon: z.array(PointSchema).min(3).optional(),
  code: z.string().nullable().optional(),
  areaM2Declared: z.number().nullable().optional(),
  areaM2Final: z.number().nullable().optional(),
  reviewed: z.boolean().optional(),
  needsReview: z.boolean().optional(),
  evidence: z.string().nullable().optional(),
});

const AnalyzeBody = z.object({
  pageIds: z.array(z.number()).optional(),
  modelOverride: z.string().optional(),
  defaultHeights: z
    .object({
      parede_externa: z.number().optional(),
      parede_interna: z.number().optional(),
      muro: z.number().optional(),
    })
    .optional(),
});

function nextCode(prefix: string, count: number): string {
  return `${prefix}${String(count + 1).padStart(2, "0")}`;
}

/**
 * Resolve `:id` (project) and ensure it exists. Returns the project or sends 404 and returns null.
 */
async function resolveProject(req: Request, res: Response): Promise<{ projectId: number; project: any } | null> {
  const projectId = parseInt(req.params.id as string);
  if (!projectId || Number.isNaN(projectId)) {
    res.status(400).json({ message: "ID de projeto invalido" });
    return null;
  }
  const project = await storage.getProject(projectId);
  if (!project) {
    res.status(404).json({ message: "Projeto nao encontrado" });
    return null;
  }
  return { projectId, project };
}

/**
 * Load a page and ensure it belongs to the given project (otherwise 404 to avoid IDOR enumeration).
 */
async function resolvePage(pageId: number, projectId: number, res: Response) {
  const page = await storage.getProjectPage(pageId);
  if (!page || page.projectId !== projectId) {
    res.status(404).json({ message: "Pagina nao encontrada" });
    return null;
  }
  return page;
}

async function resolveSegment(segmentId: number, projectId: number, res: Response) {
  const seg = await storage.getTakeoffSegment(segmentId);
  if (!seg || seg.projectId !== projectId) {
    res.status(404).json({ message: "Segmento nao encontrado" });
    return null;
  }
  return seg;
}

async function resolveSlab(slabId: number, projectId: number, res: Response) {
  const sl = await storage.getTakeoffSlab(slabId);
  if (!sl || sl.projectId !== projectId) {
    res.status(404).json({ message: "Laje nao encontrada" });
    return null;
  }
  return sl;
}

/** Strip heavy imageData out of pages list for the main GET. */
function stripImage<T extends { imageData?: string }>(p: T): Omit<T, "imageData"> & { imageData?: undefined; hasImage: boolean } {
  const { imageData, ...rest } = p as any;
  return { ...rest, hasImage: !!imageData };
}

export function registerTakeoffRoutes(app: Express) {
  // ===== Pages =====
  app.post("/api/projects/:id/takeoff/pages", requireAuth, async (req, res) => {
    try {
      const ctx = await resolveProject(req, res);
      if (!ctx) return;
      const { projectId } = ctx;
      const parsed = CreatePagesBody.parse(req.body);
      if (parsed.replaceExisting) {
        await storage.deleteProjectPages(projectId);
      }
      const created = [];
      for (const p of parsed.pages) {
        const insert = insertProjectPageSchema.parse({
          projectId,
          fileId: p.fileId ?? null,
          pageNumber: p.pageNumber,
          imageData: p.imageData,
          widthPx: p.widthPx,
          heightPx: p.heightPx,
          pageLabel: p.pageLabel ?? null,
          pavimento: p.pavimento ?? null,
          selectedForAnalysis: false,
        });
        const row = await storage.createProjectPage(insert);
        created.push(row);
      }
      res.json({ pages: created.map(stripImage) });
    } catch (err: any) {
      console.error("[takeoff:create-pages]", err);
      res.status(400).json({ message: err?.message || "Erro" });
    }
  });

  app.get("/api/projects/:id/takeoff/pages", requireAuth, async (req, res) => {
    const ctx = await resolveProject(req, res);
    if (!ctx) return;
    const pages = await storage.getProjectPages(ctx.projectId);
    res.json({ pages: pages.map(stripImage) });
  });

  // Returns the (potentially heavy) image for a single page.
  app.get("/api/projects/:id/takeoff/pages/:pageId/image", requireAuth, async (req, res) => {
    const ctx = await resolveProject(req, res);
    if (!ctx) return;
    const pageId = parseInt(req.params.pageId as string);
    const page = await resolvePage(pageId, ctx.projectId, res);
    if (!page) return;
    res.json({ pageId: page.id, imageData: page.imageData, widthPx: page.widthPx, heightPx: page.heightPx });
  });

  app.patch("/api/projects/:id/takeoff/pages/:pageId", requireAuth, async (req, res) => {
    try {
      const ctx = await resolveProject(req, res);
      if (!ctx) return;
      const pageId = parseInt(req.params.pageId as string);
      const page = await resolvePage(pageId, ctx.projectId, res);
      if (!page) return;
      const data = UpdatePageBody.parse(req.body);
      const updated = await storage.updateProjectPage(pageId, data as any);
      res.json({ page: updated ? stripImage(updated) : null });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Erro" });
    }
  });

  app.post("/api/projects/:id/takeoff/pages/:pageId/calibrate", requireAuth, async (req, res) => {
    try {
      const ctx = await resolveProject(req, res);
      if (!ctx) return;
      const pageId = parseInt(req.params.pageId as string);
      const page = await resolvePage(pageId, ctx.projectId, res);
      if (!page) return;
      const body = CalibratePageBody.parse(req.body);
      const pxPerMeter = computePxPerMeter(
        body.point1,
        body.point2,
        body.realMeters,
        page.widthPx,
        page.heightPx,
      );
      const updated = await storage.updateProjectPage(pageId, {
        pxPerMeter,
        calibrationPoints: { point1: body.point1, point2: body.point2, realMeters: body.realMeters } as any,
      });
      // Rerun geometric calc on existing segments for this page
      await recalcGeometryForPage(pageId);
      res.json({ page: updated ? stripImage(updated) : null, pxPerMeter });
    } catch (err: any) {
      console.error("[takeoff:calibrate]", err);
      res.status(400).json({ message: err?.message || "Erro" });
    }
  });

  // ===== Analyze =====
  app.post("/api/projects/:id/takeoff/analyze", requireAuth, async (req, res) => {
    try {
      const ctx = await resolveProject(req, res);
      if (!ctx) return;
      const { projectId } = ctx;
      const body = AnalyzeBody.parse(req.body);
      const allPages = await storage.getProjectPages(projectId);
      const pages = body.pageIds
        ? allPages.filter((p) => body.pageIds!.includes(p.id))
        : allPages.filter((p) => p.selectedForAnalysis);
      if (pages.length === 0) {
        return res.status(400).json({ message: "Nenhuma pagina selecionada para analise" });
      }
      const service = new AiTakeoffService(body.modelOverride);
      const defaultHeights = body.defaultHeights ?? {};
      let totalSegs = 0;
      let totalSlabs = 0;
      const errors: Array<{ pageId: number; pageNumber: number; error: string }> = [];

      for (const page of pages) {
        try {
          // imageData is "data:image/png;base64,..." OR raw base64
          const { base64, mimeType } = parseImageData(page.imageData);
          const result = await service.analyzeSheetImage({
            projectId,
            pageId: page.id,
            pageNumber: page.pageNumber,
            pageLabel: page.pageLabel,
            pavimento: page.pavimento,
            scaleText: page.scaleText,
            pxPerMeter: page.pxPerMeter,
            imageBase64: base64,
            imageMimeType: mimeType,
            imageWidthPx: page.widthPx,
            imageHeightPx: page.heightPx,
          });

          // Wipe existing AI-created segments/slabs for this page (keep manual)
          await wipeAiCreatedForPage(page.id);

          // Insert segments
          const existingSegs = await storage.getTakeoffSegments(projectId);
          let segIdx = existingSegs.length;
          const segInserts = [];
          for (const s of result.sheet.segments) {
            const heightM = s.height_m ?? defaultHeights[s.category as keyof typeof defaultHeights] ?? null;
            const geom = recomputeSegmentGeometry(
              s.points as TakeoffPoint[],
              page.widthPx,
              page.heightPx,
              page.pxPerMeter,
              heightM,
              s.category as any,
            );
            const codePrefix = s.category === "muro" ? "M" : s.category === "parede_externa" ? "PE" : "PI";
            segInserts.push(
              insertTakeoffSegmentSchema.parse({
                projectId,
                pageId: page.id,
                code: nextCode(codePrefix, segIdx++),
                category: s.category,
                level: s.level,
                geometryType: s.geometry_type,
                pointsJson: s.points,
                lengthMAi: s.length_m_ai,
                lengthMCalculated: geom.lengthM,
                lengthMFinal: geom.lengthM ?? s.length_m_ai,
                heightM,
                areaM2OneFace: geom.areaOneFaceM2 ?? s.area_m2_one_face,
                areaM2TwoFaces: geom.areaTwoFacesM2 ?? s.area_m2_two_faces,
                openingsDetected: s.openings_detected,
                grossOrNet: s.gross_or_net,
                confidence: s.confidence,
                evidence: s.evidence,
                needsReview: s.needs_review || s.confidence < 0.7,
                reviewed: false,
                createdByAi: true,
              } as any),
            );
          }
          await storage.bulkCreateTakeoffSegments(segInserts);
          totalSegs += segInserts.length;

          // Insert slabs
          const existingSlabs = await storage.getTakeoffSlabs(projectId);
          let slabIdx = existingSlabs.length;
          const slabInserts = [];
          for (const sl of result.sheet.slabs) {
            const calcM2 = areaInSquareMeters(sl.polygon as TakeoffPoint[], page.widthPx, page.heightPx, page.pxPerMeter);
            const codePrefix = sl.category === "laje_piso" ? "LP" : "LC";
            slabInserts.push(
              insertTakeoffSlabSchema.parse({
                projectId,
                pageId: page.id,
                code: nextCode(codePrefix, slabIdx++),
                category: sl.category,
                level: sl.level,
                polygonJson: sl.polygon,
                areaM2Ai: sl.area_m2_ai,
                areaM2Declared: sl.area_m2_declared,
                areaM2Calculated: calcM2 ?? sl.area_m2_calculated,
                areaM2Final: sl.area_m2_declared ?? calcM2 ?? sl.area_m2_ai,
                confidence: sl.confidence,
                evidence: sl.evidence,
                needsReview: sl.needs_review || sl.confidence < 0.7,
                reviewed: false,
                createdByAi: true,
              } as any),
            );
          }
          await storage.bulkCreateTakeoffSlabs(slabInserts);
          totalSlabs += slabInserts.length;
        } catch (err: any) {
          console.error(`[takeoff:analyze] page ${page.pageNumber}`, err);
          errors.push({ pageId: page.id, pageNumber: page.pageNumber, error: err?.message || String(err) });
        }
      }
      res.json({ totalSegments: totalSegs, totalSlabs, errors });
    } catch (err: any) {
      console.error("[takeoff:analyze]", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });

  // ===== Full state =====
  // NOTE: page imageData is intentionally omitted here to keep responses small.
  // Use /api/projects/:id/takeoff/pages/:pageId/image to fetch the image lazily.
  app.get("/api/projects/:id/takeoff", requireAuth, async (req, res) => {
    const ctx = await resolveProject(req, res);
    if (!ctx) return;
    const { projectId } = ctx;
    const [pages, segments, slabs, runs] = await Promise.all([
      storage.getProjectPages(projectId),
      storage.getTakeoffSegments(projectId),
      storage.getTakeoffSlabs(projectId),
      storage.getAiRuns(projectId),
    ]);
    res.json({
      pages: pages.map(stripImage),
      segments,
      slabs,
      aiRuns: runs.slice(0, 20).map((r) => ({ ...r, outputJson: undefined })),
      totals: computeTotals(segments, slabs),
    });
  });

  // ===== Segments CRUD =====
  app.post("/api/projects/:id/takeoff/segments", requireAuth, async (req, res) => {
    try {
      const ctx = await resolveProject(req, res);
      if (!ctx) return;
      const { projectId } = ctx;
      const body = CreateSegmentBody.parse(req.body);
      const page = await resolvePage(body.pageId, projectId, res);
      if (!page) return;
      const all = await storage.getTakeoffSegments(projectId);
      const codePrefix = body.category === "muro" ? "M" : body.category === "parede_externa" ? "PE" : "PI";
      const geom = recomputeSegmentGeometry(
        body.points as TakeoffPoint[],
        page.widthPx,
        page.heightPx,
        page.pxPerMeter,
        body.heightM ?? null,
        body.category,
      );
      const segment = await storage.createTakeoffSegment(
        insertTakeoffSegmentSchema.parse({
          projectId,
          pageId: body.pageId,
          code: body.code ?? nextCode(codePrefix, all.length),
          category: body.category,
          level: body.level,
          geometryType: body.geometryType,
          pointsJson: body.points,
          lengthMAi: null,
          lengthMCalculated: geom.lengthM,
          lengthMFinal: geom.lengthM,
          heightM: body.heightM ?? null,
          areaM2OneFace: geom.areaOneFaceM2,
          areaM2TwoFaces: geom.areaTwoFacesM2,
          openingsDetected: false,
          grossOrNet: "bruta",
          confidence: 1,
          evidence: "Criado manualmente",
          needsReview: false,
          reviewed: true,
          createdByAi: false,
        } as any),
      );
      res.json({ segment });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Erro" });
    }
  });

  app.patch("/api/projects/:id/takeoff/segments/:segId", requireAuth, async (req, res) => {
    try {
      const ctx = await resolveProject(req, res);
      if (!ctx) return;
      const segId = parseInt(req.params.segId as string);
      const existing = await resolveSegment(segId, ctx.projectId, res);
      if (!existing) return;
      const body = UpdateSegmentBody.parse(req.body);
      const page = await storage.getProjectPage(existing.pageId);
      if (!page) return res.status(404).json({ message: "Pagina nao encontrada" });

      const points = (body.points ?? (existing.pointsJson as TakeoffPoint[])) as TakeoffPoint[];
      const category = body.category ?? (existing.category as any);
      const heightM = body.heightM !== undefined ? body.heightM : existing.heightM;
      const geom = recomputeSegmentGeometry(points, page.widthPx, page.heightPx, page.pxPerMeter, heightM, category);

      const updated = await storage.updateTakeoffSegment(segId, {
        ...(body.points ? { pointsJson: body.points } : {}),
        ...(body.category ? { category: body.category } : {}),
        ...(body.level ? { level: body.level } : {}),
        ...(body.geometryType ? { geometryType: body.geometryType } : {}),
        ...(body.heightM !== undefined ? { heightM: body.heightM } : {}),
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.evidence !== undefined ? { evidence: body.evidence } : {}),
        ...(body.openingsDetected !== undefined ? { openingsDetected: body.openingsDetected } : {}),
        ...(body.grossOrNet ? { grossOrNet: body.grossOrNet } : {}),
        ...(body.reviewed !== undefined ? { reviewed: body.reviewed } : {}),
        ...(body.needsReview !== undefined ? { needsReview: body.needsReview } : {}),
        lengthMCalculated: geom.lengthM,
        lengthMFinal: body.lengthMFinal !== undefined ? body.lengthMFinal : (geom.lengthM ?? existing.lengthMFinal),
        areaM2OneFace: geom.areaOneFaceM2,
        areaM2TwoFaces: geom.areaTwoFacesM2,
      } as any);

      // Audit
      await storage.createTakeoffRevision({
        projectId: existing.projectId,
        userId: (req as any).user?.id ?? null,
        entityType: "segment",
        entityId: segId,
        beforeJson: existing as any,
        afterJson: updated as any,
      } as any);

      res.json({ segment: updated });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Erro" });
    }
  });

  app.delete("/api/projects/:id/takeoff/segments/:segId", requireAuth, async (req, res) => {
    const ctx = await resolveProject(req, res);
    if (!ctx) return;
    const segId = parseInt(req.params.segId as string);
    const existing = await resolveSegment(segId, ctx.projectId, res);
    if (!existing) return;
    await storage.deleteTakeoffSegment(segId);
    res.json({ ok: true });
  });

  // ===== Slabs CRUD =====
  app.post("/api/projects/:id/takeoff/slabs", requireAuth, async (req, res) => {
    try {
      const ctx = await resolveProject(req, res);
      if (!ctx) return;
      const { projectId } = ctx;
      const body = CreateSlabBody.parse(req.body);
      const page = await resolvePage(body.pageId, projectId, res);
      if (!page) return;
      const all = await storage.getTakeoffSlabs(projectId);
      const calcM2 = areaInSquareMeters(body.polygon as TakeoffPoint[], page.widthPx, page.heightPx, page.pxPerMeter);
      const codePrefix = body.category === "laje_piso" ? "LP" : "LC";
      const slab = await storage.createTakeoffSlab(
        insertTakeoffSlabSchema.parse({
          projectId,
          pageId: body.pageId,
          code: body.code ?? nextCode(codePrefix, all.length),
          category: body.category,
          level: body.level,
          polygonJson: body.polygon,
          areaM2Ai: null,
          areaM2Declared: body.areaM2Declared ?? null,
          areaM2Calculated: calcM2,
          areaM2Final: body.areaM2Declared ?? calcM2,
          confidence: 1,
          evidence: "Criado manualmente",
          needsReview: false,
          reviewed: true,
          createdByAi: false,
        } as any),
      );
      res.json({ slab });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Erro" });
    }
  });

  app.patch("/api/projects/:id/takeoff/slabs/:slabId", requireAuth, async (req, res) => {
    try {
      const ctx = await resolveProject(req, res);
      if (!ctx) return;
      const slabId = parseInt(req.params.slabId as string);
      const existing = await resolveSlab(slabId, ctx.projectId, res);
      if (!existing) return;
      const body = UpdateSlabBody.parse(req.body);
      const page = await storage.getProjectPage(existing.pageId);
      if (!page) return res.status(404).json({ message: "Pagina nao encontrada" });
      const polygon = (body.polygon ?? (existing.polygonJson as TakeoffPoint[])) as TakeoffPoint[];
      const calcM2 = areaInSquareMeters(polygon, page.widthPx, page.heightPx, page.pxPerMeter);
      const declared = body.areaM2Declared !== undefined ? body.areaM2Declared : existing.areaM2Declared;
      const updated = await storage.updateTakeoffSlab(slabId, {
        ...(body.polygon ? { polygonJson: body.polygon } : {}),
        ...(body.category ? { category: body.category } : {}),
        ...(body.level ? { level: body.level } : {}),
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.areaM2Declared !== undefined ? { areaM2Declared: body.areaM2Declared } : {}),
        ...(body.evidence !== undefined ? { evidence: body.evidence } : {}),
        ...(body.reviewed !== undefined ? { reviewed: body.reviewed } : {}),
        ...(body.needsReview !== undefined ? { needsReview: body.needsReview } : {}),
        areaM2Calculated: calcM2,
        areaM2Final: body.areaM2Final !== undefined ? body.areaM2Final : (declared ?? calcM2 ?? existing.areaM2Final),
      } as any);
      await storage.createTakeoffRevision({
        projectId: existing.projectId,
        userId: (req as any).user?.id ?? null,
        entityType: "slab",
        entityId: slabId,
        beforeJson: existing as any,
        afterJson: updated as any,
      } as any);
      res.json({ slab: updated });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Erro" });
    }
  });

  app.delete("/api/projects/:id/takeoff/slabs/:slabId", requireAuth, async (req, res) => {
    const ctx = await resolveProject(req, res);
    if (!ctx) return;
    const slabId = parseInt(req.params.slabId as string);
    const existing = await resolveSlab(slabId, ctx.projectId, res);
    if (!existing) return;
    await storage.deleteTakeoffSlab(slabId);
    res.json({ ok: true });
  });

  // ===== Exports =====
  app.post("/api/projects/:id/takeoff/export", requireAuth, async (req, res) => {
    try {
      const ctx = await resolveProject(req, res);
      if (!ctx) return;
      const { projectId, project } = ctx;
      const type = String(req.query.type || req.body?.type || "json").toLowerCase();
      const [pages, segments, slabs] = await Promise.all([
        storage.getProjectPages(projectId),
        storage.getTakeoffSegments(projectId),
        storage.getTakeoffSlabs(projectId),
      ]);
      const calibratedPagesMissing = pages
        .filter((p) => p.selectedForAnalysis && (!p.pxPerMeter || p.pxPerMeter <= 0))
        .map((p) => p.pageNumber);
      if (calibratedPagesMissing.length > 0 && type !== "json") {
        return res.status(400).json({
          message: `Calibracao de escala obrigatoria para fechar quantitativo. Paginas sem calibracao: ${calibratedPagesMissing.join(", ")}.`,
        });
      }
      const input = {
        project,
        pages,
        segments,
        slabs,
        assumptions:
          "Quantitativo gerado pelo modo OpenAI Vision Takeoff. Comprimentos recalculados via geometria + escala calibrada. Areas de paredes internas computadas em duas faces.",
      };
      if (type === "excel" || type === "xlsx") {
        const buf = await exportTakeoffExcel(input);
        await storage.createTakeoffExport({
          projectId, type: "excel", fileName: `${project.name}-takeoff.xlsx`, fileData: null,
          reviewedSegmentIds: segments.filter((s) => s.reviewed).map((s) => s.id) as any,
        } as any);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${project.name}-takeoff.xlsx"`);
        return res.end(buf);
      }
      if (type === "pdf") {
        const buf = await exportTakeoffPdf(input);
        await storage.createTakeoffExport({
          projectId, type: "pdf", fileName: `${project.name}-takeoff.pdf`, fileData: null,
          reviewedSegmentIds: segments.filter((s) => s.reviewed).map((s) => s.id) as any,
        } as any);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${project.name}-takeoff.pdf"`);
        return res.end(buf);
      }
      // json default
      await storage.createTakeoffExport({
        projectId, type: "json", fileName: `${project.name}-takeoff.json`, fileData: null,
        reviewedSegmentIds: segments.filter((s) => s.reviewed).map((s) => s.id) as any,
      } as any);
      res.json(input);
    } catch (err: any) {
      console.error("[takeoff:export]", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });
}

// ===== Helpers =====
function parseImageData(s: string): { base64: string; mimeType: string } {
  if (s.startsWith("data:")) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(s);
    if (m) return { mimeType: m[1], base64: m[2] };
  }
  return { mimeType: "image/png", base64: s };
}

async function wipeAiCreatedForPage(pageId: number) {
  // We delete only AI-created items so manual edits survive a re-analysis.
  // Storage doesn't have a "delete where created_by_ai" — do it manually.
  const projectIdOfPage = (await storage.getProjectPage(pageId))?.projectId;
  if (!projectIdOfPage) return;
  const allSegs = await storage.getTakeoffSegments(projectIdOfPage);
  for (const s of allSegs.filter((x) => x.pageId === pageId && x.createdByAi)) {
    await storage.deleteTakeoffSegment(s.id);
  }
  const allSlabs = await storage.getTakeoffSlabs(projectIdOfPage);
  for (const sl of allSlabs.filter((x) => x.pageId === pageId && x.createdByAi)) {
    await storage.deleteTakeoffSlab(sl.id);
  }
}

async function recalcGeometryForPage(pageId: number) {
  const page = await storage.getProjectPage(pageId);
  if (!page) return;
  const segs = (await storage.getTakeoffSegments(page.projectId)).filter((s) => s.pageId === pageId);
  for (const s of segs) {
    const geom = recomputeSegmentGeometry(
      s.pointsJson as TakeoffPoint[],
      page.widthPx,
      page.heightPx,
      page.pxPerMeter,
      s.heightM,
      s.category as any,
    );
    await storage.updateTakeoffSegment(s.id, {
      lengthMCalculated: geom.lengthM,
      lengthMFinal: geom.lengthM ?? s.lengthMFinal ?? s.lengthMAi,
      areaM2OneFace: geom.areaOneFaceM2,
      areaM2TwoFaces: geom.areaTwoFacesM2,
    } as any);
  }
  const slabs = (await storage.getTakeoffSlabs(page.projectId)).filter((s) => s.pageId === pageId);
  for (const sl of slabs) {
    const calcM2 = areaInSquareMeters(sl.polygonJson as TakeoffPoint[], page.widthPx, page.heightPx, page.pxPerMeter);
    await storage.updateTakeoffSlab(sl.id, {
      areaM2Calculated: calcM2,
      areaM2Final: sl.areaM2Final ?? sl.areaM2Declared ?? calcM2 ?? sl.areaM2Ai,
    } as any);
  }
}

function computeTotals(segs: any[], slabs: any[]) {
  const t: Record<string, { count: number; m2: number; m: number }> = {
    parede_externa: { count: 0, m2: 0, m: 0 },
    parede_interna: { count: 0, m2: 0, m: 0 },
    muro: { count: 0, m2: 0, m: 0 },
    laje_piso: { count: 0, m2: 0, m: 0 },
    laje_cobertura: { count: 0, m2: 0, m: 0 },
  };
  for (const s of segs) {
    const k = t[s.category];
    if (!k) continue;
    k.count += 1;
    k.m += s.lengthMFinal ?? s.lengthMCalculated ?? s.lengthMAi ?? 0;
    k.m2 += (s.areaM2OneFace ?? 0) + (s.areaM2TwoFaces ? s.areaM2TwoFaces - (s.areaM2OneFace ?? 0) : 0);
  }
  for (const sl of slabs) {
    const k = t[sl.category];
    if (!k) continue;
    k.count += 1;
    k.m2 += sl.areaM2Final ?? sl.areaM2Calculated ?? sl.areaM2Declared ?? sl.areaM2Ai ?? 0;
  }
  return t;
}
