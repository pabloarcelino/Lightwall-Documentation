/**
 * Adapter que roda o motor do Vision Direct dentro do fluxo de Projeto.
 *
 * Para cada arquivo do projeto, chama analyzeVisionDirect() e consolida os
 * resultados num formato compativel com o que o ProjectDetails.tsx ja espera:
 *   - extractedData: vision_direct_summary + etapa3_annotated_plan + audit_notes
 *   - budgets: via calculateBudget + applyProfilePrices (paredes sinteticas)
 *   - projects.status: draft -> processing -> completed | error
 *
 * O usuario optou por manter a pipeline antiga como fallback. Esta nova rota
 * usa o motor enxuto do Modo Visao Direta porque o anterior nao estava
 * dando resultados satisfatorios.
 */

import * as fs from "fs/promises";
import { storage } from "../../storage";
import { analyzeVisionDirect, type VisionDirectResult, type PageResult } from "./analyzer";
import {
  calculateBudget,
  type BudgetResult,
} from "../calculation/engine";
import type { ExtractedWall, ExtractedSlab, ExtractedCorner } from "../gemini/planAnalyzer";
import {
  clearAbort,
  throwIfAborted,
  PipelineAbortedError,
} from "../pipelineAbort";
import { emitStage, emitAuditFinding } from "../audit/aiEvents";
import { applyProfilePrices } from "../pricing/profilePrices";

export interface VisionDirectScope {
  paredesExternas: boolean;
  paredesInternas: boolean;
  muros: boolean;
  lajePiso: boolean;
  lajeCoberta: boolean;
}

export interface VisionDirectProductIds {
  ext?: number;
  int?: number;
  muros?: number;
  piso?: number;
  coberta?: number;
}

export interface RunVisionDirectForProjectInput {
  projectId: number;
  userId: number | null;
  defaultPeDireitoM?: number;
  scope?: VisionDirectScope;
  productIds?: VisionDirectProductIds;
}

const ALL_TRUE_SCOPE: VisionDirectScope = {
  paredesExternas: true,
  paredesInternas: true,
  muros: true,
  lajePiso: true,
  lajeCoberta: true,
};

/**
 * Zera as categorias desmarcadas no scope. O motor calcula todas,
 * mas categorias false sao zeradas antes de persistir + budget.
 */
function applyScopeFilter(
  consolidated: VisionDirectResult,
  scope: VisionDirectScope,
): VisionDirectResult {
  if (
    scope.paredesExternas && scope.paredesInternas && scope.muros &&
    scope.lajePiso && scope.lajeCoberta
  ) {
    return consolidated;
  }
  const filtered: VisionDirectResult = {
    ...consolidated,
    pages: consolidated.pages.map((p) => ({
      ...p,
      paredes_externas: scope.paredesExternas
        ? p.paredes_externas
        : { area_bruta_m2: 0, area_aberturas_m2: 0, area_liquida_m2: 0 },
      paredes_internas: scope.paredesInternas
        ? p.paredes_internas
        : { area_bruta_m2: 0, area_aberturas_m2: 0, area_liquida_m2: 0 },
      muros: scope.muros
        ? p.muros
        : { area_bruta_m2: 0, altura_assumida_m: 2.0 },
      laje_piso_m2: scope.lajePiso ? p.laje_piso_m2 : 0,
      laje_coberta_m2: scope.lajeCoberta ? p.laje_coberta_m2 : 0,
    })),
    totais: {
      paredes_externas_liquida_m2: scope.paredesExternas ? consolidated.totais.paredes_externas_liquida_m2 : 0,
      paredes_internas_liquida_m2: scope.paredesInternas ? consolidated.totais.paredes_internas_liquida_m2 : 0,
      muros_m2: scope.muros ? consolidated.totais.muros_m2 : 0,
      laje_piso_m2: scope.lajePiso ? consolidated.totais.laje_piso_m2 : 0,
      laje_coberta_m2: scope.lajeCoberta ? consolidated.totais.laje_coberta_m2 : 0,
    },
  };
  return filtered;
}

/**
 * Orquestrador principal. Roda em background — o handler HTTP devolve 202
 * imediatamente. Atualiza projects.status conforme progresso e nunca propaga
 * erro (qualquer falha vira projects.status="error").
 */
export async function runVisionDirectForProject(
  input: RunVisionDirectForProjectInput,
): Promise<void> {
  const { projectId } = input;
  const defaultPeDireitoM = input.defaultPeDireitoM ?? 3.0;
  const scope = input.scope ?? ALL_TRUE_SCOPE;
  const productIds = input.productIds ?? {};

  // Timeout absoluto: 10 minutos pra projeto inteiro. Se nao terminar
  // ate la, forca status="error" pra destravar a UI. Garante que
  // nenhum projeto fica "processing" para sempre, qualquer que seja
  // a causa (deadlock, hang na rede, bug oculto).
  const TOTAL_TIMEOUT_MS = 10 * 60 * 1000;
  const absoluteTimeout = setTimeout(async () => {
    console.error(
      `[VD-PROJECT] Projeto ${projectId}: TIMEOUT ABSOLUTO 10min atingido. Forcando status=error.`,
    );
    try {
      const proj = await storage.getProject(projectId);
      if (proj?.status === "processing") {
        await storage.updateProjectStatus(projectId, "error");
        console.error(`[VD-PROJECT] Projeto ${projectId}: status -> error (timeout absoluto)`);
      }
    } catch (err: any) {
      console.error(`[VD-PROJECT] Projeto ${projectId}: falha ao forcar error apos timeout: ${err?.message || err}`);
    }
  }, TOTAL_TIMEOUT_MS);

  // Limpa flag de aborto de runs anteriores (cooperativo).
  clearAbort(projectId);

  try {
    console.log(`[VD-PROJECT] Projeto ${projectId}: runVisionDirectForProject INICIO (defaultPe=${defaultPeDireitoM}m)`);
    emitStage({ projectId, stage: "vd_start", label: "Iniciando analise", phase: "started" });
    await storage.updateProjectStatus(projectId, "processing");
    console.log(`[VD-PROJECT] Projeto ${projectId}: status -> processing`);

    const project = await storage.getProject(projectId);
    if (!project) throw new Error(`Projeto ${projectId} nao encontrado`);
    const files = await storage.getProjectFiles(projectId);
    if (files.length === 0) throw new Error("Projeto sem arquivos enviados");

    console.log(`[VD-PROJECT] Projeto ${projectId}: ${files.length} arquivo(s) registrados`);
    emitStage({ projectId, stage: "vd_files", label: `${files.length} arquivo(s)`, phase: "completed", detail: `${files.length} arquivo(s) registrado(s)` });

    // 1) Analisa arquivos via Vision Direct EM PARALELO (limit 2 pra nao
    // estourar rate limit do Gemini). Inclui validacao de existencia e
    // TIMEOUT por arquivo de 5min — mata travamentos individuais.
    const FILE_TIMEOUT_MS = 5 * 60 * 1000;
    const CONCURRENCY = 2;

    const jobs = files.map((file, i) => async () => {
      const tag = `${i + 1}/${files.length}`;
      try {
        await fs.access(file.filePath);
      } catch {
        console.warn(
          `[VD-PROJECT] Projeto ${projectId} arquivo ${tag} (${file.originalName}) INEXISTENTE no disco: ${file.filePath}`,
        );
        return null;
      }
      // Checkpoint de aborto antes de cada arquivo.
      try { throwIfAborted(projectId); } catch (e) {
        if (e instanceof PipelineAbortedError) throw e;
        throw e;
      }
      const fileStart = Date.now();
      console.log(
        `[VD-PROJECT] Projeto ${projectId} arquivo ${tag} (${file.originalName}) iniciando analise...`,
      );
      emitStage({
        projectId,
        stage: `vd_file_${i + 1}`,
        label: `Arquivo ${tag} — ${file.originalName}`,
        phase: "started",
      });
      try {
        const analyzePromise = analyzeVisionDirect({
          filePath: file.filePath,
          fileType: inferFileType(file.fileType, file.originalName),
          fileName: file.originalName,
          defaultPeDireitoM,
          userId: input.userId ?? undefined,
          projectId, // <- chave para auditAiCall persistir ai_runs
        });
        const result = await Promise.race([
          analyzePromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`timeout ${FILE_TIMEOUT_MS / 1000}s`)), FILE_TIMEOUT_MS),
          ),
        ]);
        console.log(
          `[VD-PROJECT] Projeto ${projectId} arquivo ${tag} OK em ${((Date.now() - fileStart) / 1000).toFixed(1)}s ` +
            `(${result.pages.length} pag, custo US$ ${result.costUsd.toFixed(4)})`,
        );
        emitStage({
          projectId,
          stage: `vd_file_${i + 1}`,
          label: `Arquivo ${tag} — ${file.originalName}`,
          phase: "completed",
          detail: `${result.pages.length} pag · US$ ${result.costUsd.toFixed(4)} · ${((Date.now() - fileStart) / 1000).toFixed(1)}s`,
        });
        return { fileName: file.originalName, result };
      } catch (err: any) {
        console.warn(
          `[VD-PROJECT] Projeto ${projectId} arquivo ${tag} (${file.originalName}) falhou em ${((Date.now() - fileStart) / 1000).toFixed(1)}s: ${err?.message || err}`,
        );
        emitStage({
          projectId,
          stage: `vd_file_${i + 1}`,
          label: `Arquivo ${tag} — ${file.originalName}`,
          phase: "failed",
          errorMessage: err?.message || String(err),
        });
        return null;
      }
    });

    // Executa jobs em paralelo com concorrencia limitada
    const perFileResults: Array<{ fileName: string; result: VisionDirectResult }> = [];
    const active: Promise<void>[] = [];
    let next = 0;
    const runNext = async (): Promise<void> => {
      const idx = next++;
      if (idx >= jobs.length) return;
      const out = await jobs[idx]();
      if (out) perFileResults.push(out);
      return runNext();
    };
    for (let i = 0; i < Math.min(CONCURRENCY, jobs.length); i++) {
      active.push(runNext());
    }
    await Promise.all(active);

    if (perFileResults.length === 0) {
      throw new Error("Nenhum arquivo foi analisado com sucesso");
    }

    // 2) Consolida todos os arquivos num resultado unico
    emitStage({ projectId, stage: "vd_consolidate", label: "Consolidando resultados", phase: "started" });
    console.log(`[VD-PROJECT] Projeto ${projectId}: consolidando ${perFileResults.length} arquivo(s)...`);
    const rawConsolidated = consolidateResults(perFileResults);
    const consolidated = applyScopeFilter(rawConsolidated, scope);
    const scopeOff = Object.entries(scope).filter(([_, v]) => v === false).map(([k]) => k);
    console.log(
      `[VD-PROJECT] Projeto ${projectId} consolidado: ${consolidated.pages.length} pagina(s), ` +
        `custo US$ ${consolidated.costUsd.toFixed(4)}, ${consolidated.durationMs}ms` +
        (scopeOff.length ? ` (categorias zeradas pelo escopo: ${scopeOff.join(", ")})` : ""),
    );
    emitStage({
      projectId,
      stage: "vd_consolidate",
      label: "Consolidando resultados",
      phase: "completed",
      detail: `${consolidated.pages.length} pag · US$ ${consolidated.costUsd.toFixed(4)}` +
        (scopeOff.length ? ` · escopo OFF: ${scopeOff.join(", ")}` : ""),
    });

    if (consolidated.pages.length === 0) {
      throw new Error("Consolidacao resultou em zero paginas analisadas");
    }

    // 3) Limpa extractedData/budget antigos do projeto (caso seja reprocesso)
    console.log(`[VD-PROJECT] Projeto ${projectId}: limpando dados antigos...`);
    await safeDeleteOldData(projectId);

    // 4) Persiste extractedData — OBRIGATORIO. Falha aqui = projeto sem
    // dados utilizaveis, status="error".
    emitStage({ projectId, stage: "vd_persist", label: "Persistindo resultados", phase: "started" });
    console.log(`[VD-PROJECT] Projeto ${projectId}: persistindo extractedData...`);
    await persistExtractedData(projectId, consolidated);
    console.log(`[VD-PROJECT] Projeto ${projectId}: extractedData persistido`);
    emitStage({ projectId, stage: "vd_persist", label: "Persistindo resultados", phase: "completed" });

    // 5) Calcula budget — SECUNDARIO. Falha aqui apenas loga warn; m² ja
    // estao em extractedData e a UI principal consegue funcionar sem budget.
    emitStage({ projectId, stage: "vd_budget", label: "Calculando orcamento", phase: "started" });
    console.log(`[VD-PROJECT] Projeto ${projectId}: calculando budget...`);
    try {
      const baseBudget = await buildBudget(consolidated, project.pricingProfileId ?? null, projectId, productIds);

      // Enriquece JSONB com totalCost + totalArea + pavimentos[] com
      // custo_total por categoria — compatibiliza com CompletedFooter.
      const enriched = await enrichBudgetForFooter(
        consolidated,
        baseBudget,
        project.pricingProfileId ?? null,
        productIds,
      );
      const totalAreaStr = String(enriched.totalArea.toFixed(2));
      const totalCostStr = String(enriched.totalCost.toFixed(2));

      await storage.createBudget({
        projectId,
        budgetData: enriched as any,
        totalArea: totalAreaStr as any,
        totalCost: totalCostStr as any,
        status: "finalizado",
      } as any);
      console.log(`[VD-PROJECT] Projeto ${projectId}: budget persistido`);
      emitStage({ projectId, stage: "vd_budget", label: "Calculando orcamento", phase: "completed" });
    } catch (err: any) {
      console.warn(
        `[VD-PROJECT] Projeto ${projectId} budget falhou (continuando sem budget): ${err?.message || err}`,
      );
      emitStage({
        projectId,
        stage: "vd_budget",
        label: "Calculando orcamento",
        phase: "failed",
        errorMessage: err?.message || String(err),
      });
    }

    // 6) Marca projeto como concluido — SEMPRE chega aqui se chegou ao consolidated
    await storage.updateProjectStatus(projectId, "completed");
    console.log(`[VD-PROJECT] Projeto ${projectId}: status -> completed`);
    emitStage({ projectId, stage: "vd_done", label: "Analise concluida", phase: "completed" });
  } catch (err: any) {
    const aborted = err instanceof PipelineAbortedError;
    console.error(`[VD-PROJECT] Projeto ${projectId} ${aborted ? "ABORTADO pelo usuario" : "falhou"}: ${err?.message || err}`);
    emitStage({
      projectId,
      stage: "vd_done",
      label: aborted ? "Analise cancelada" : "Analise interrompida",
      phase: "failed",
      errorMessage: err?.message || String(err),
    });
    if (aborted) {
      emitAuditFinding({
        projectId,
        severity: "warning",
        code: "USER_ABORT",
        message: "Análise cancelada pelo usuário.",
      });
    }
    try {
      await storage.updateProjectStatus(projectId, "error");
      console.log(`[VD-PROJECT] Projeto ${projectId}: status -> error`);
    } catch {
      /* noop */
    }
  } finally {
    clearTimeout(absoluteTimeout);
    console.log(`[VD-PROJECT] Projeto ${projectId}: runVisionDirectForProject FIM`);
  }
}

// ============================================================
// Helpers
// ============================================================

function inferFileType(stored: string, fileName: string): string {
  if (stored === "pdf" || /\.pdf$/i.test(fileName)) return "pdf";
  return "image";
}

/**
 * Consolida resultados de varios arquivos em um VisionDirectResult unico.
 * - pages: concat de todas as paginas com pageIndex re-numerado
 * - totais: soma
 * - costUsd, durationMs: soma
 * - peDireitoUsadoM: o primeiro nao-default encontrado (ou default)
 */
function consolidateResults(
  perFile: Array<{ fileName: string; result: VisionDirectResult }>,
): VisionDirectResult {
  const allPages: PageResult[] = [];
  let totalCost = 0;
  let totalDuration = 0;
  let peDireitoUsadoM = perFile[0]?.result.peDireitoUsadoM ?? 3.0;
  let peDireitoFonte: "corte" | "default" = perFile[0]?.result.peDireitoFonte ?? "default";
  let pageCountTotal = 0;
  let fileTypeFirst = perFile[0]?.result.preflight.fileType ?? "image";

  const totais = {
    paredes_externas_liquida_m2: 0,
    paredes_internas_liquida_m2: 0,
    muros_m2: 0,
    laje_piso_m2: 0,
    laje_coberta_m2: 0,
  };

  let pageOffset = 0;
  for (const { result } of perFile) {
    for (const pg of result.pages) {
      allPages.push({ ...pg, pageIndex: pg.pageIndex + pageOffset });
    }
    pageOffset += result.preflight.pageCount;
    totalCost += result.costUsd;
    totalDuration += result.durationMs;
    pageCountTotal += result.preflight.pageCount;
    if (result.peDireitoFonte === "corte" && peDireitoFonte === "default") {
      peDireitoUsadoM = result.peDireitoUsadoM;
      peDireitoFonte = "corte";
    }
    totais.paredes_externas_liquida_m2 += result.totais.paredes_externas_liquida_m2;
    totais.paredes_internas_liquida_m2 += result.totais.paredes_internas_liquida_m2;
    totais.muros_m2 += result.totais.muros_m2;
    totais.laje_piso_m2 += result.totais.laje_piso_m2;
    totais.laje_coberta_m2 += result.totais.laje_coberta_m2;
  }

  return {
    peDireitoUsadoM,
    peDireitoFonte,
    pages: allPages,
    totais,
    costUsd: totalCost,
    durationMs: totalDuration,
    preflight: {
      fileType: fileTypeFirst,
      pageCount: pageCountTotal,
      isPdfVector: null,
    },
  };
}

async function safeDeleteOldData(projectId: number): Promise<void> {
  try {
    await storage.clearExtractedData(projectId);
  } catch (err: any) {
    console.warn(`[VD-PROJECT] clearExtractedData: ${err?.message || err}`);
  }
  try {
    await storage.deleteBudget(projectId);
  } catch (err: any) {
    console.warn(`[VD-PROJECT] deleteBudget: ${err?.message || err}`);
  }
}

/**
 * Persiste extractedData no formato esperado pelo ProjectDetails.tsx:
 *  - elementType="vision_direct_summary": totais + meta (marcador do novo modo)
 *  - elementType="etapa3_annotated_plan": imagens anotadas por pagina
 *  - elementType="audit_notes": observacoes da IA convertidas em notes
 */
async function persistExtractedData(
  projectId: number,
  consolidated: VisionDirectResult,
): Promise<void> {
  // Summary — marcador do novo modo (ProjectDetails detecta isso)
  await storage.addExtractedData({
    projectId,
    elementType: "vision_direct_summary",
    data: {
      peDireitoUsadoM: consolidated.peDireitoUsadoM,
      peDireitoFonte: consolidated.peDireitoFonte,
      totais: consolidated.totais,
      costUsd: consolidated.costUsd,
      durationMs: consolidated.durationMs,
      preflight: consolidated.preflight,
      pages: consolidated.pages.map((p) => ({
        pageIndex: p.pageIndex,
        pavimento: p.pavimento,
        paredes_externas: p.paredes_externas,
        paredes_internas: p.paredes_internas,
        muros: p.muros,
        laje_piso_m2: p.laje_piso_m2,
        laje_coberta_m2: p.laje_coberta_m2,
        aberturas: p.aberturas,
        confidence: p.confidence,
        observacoes: p.observacoes,
        // Imagens consumidas por VisionDirectAnnotatedImages no frontend
        annotatedImage: p.annotatedImage ?? null,
        originalImage: p.originalImage ?? null,
      })),
    } as any,
    hasAssumption: 0,
  } as any);

  // Plantas anotadas — mesmo formato que a pipeline antiga usa (etapa3)
  const images = consolidated.pages
    .filter((p) => !!p.annotatedImage)
    .map((p) => {
      const data = p.annotatedImage!;
      const m = data.match(/^data:([^;]+);base64,(.+)$/);
      return {
        pavimento: p.pavimento || `Pavimento ${p.pageIndex}`,
        image: m ? m[2] : data,
        mimeType: m ? m[1] : "image/png",
        pageIndex: p.pageIndex,
      };
    });
  if (images.length > 0) {
    await storage.addExtractedData({
      projectId,
      elementType: "etapa3_annotated_plan",
      data: { images } as any,
      hasAssumption: 0,
    } as any);
  }

  // Observacoes -> audit_notes (severity=info pra cada pagina com observacao)
  const notes = consolidated.pages
    .filter((p) => !!p.observacoes)
    .map((p) => ({
      severity: "info" as const,
      message: p.observacoes,
      pavimento: p.pavimento,
      pageIndex: p.pageIndex,
    }));
  if (notes.length > 0) {
    await storage.addExtractedData({
      projectId,
      elementType: "audit_notes",
      data: { notes } as any,
      hasAssumption: 0,
    } as any);
  }
}

/**
 * Calcula budget criando paredes/lajes "sinteticas" com base nos totais
 * por pavimento, passando pra calculateBudget e aplicando preco do
 * pricingProfile do projeto.
 */
async function buildBudget(
  consolidated: VisionDirectResult,
  pricingProfileId: number | null,
  projectId: number,
  productIds?: VisionDirectProductIds,
): Promise<BudgetResult> {
  void pricingProfileId; void projectId; void productIds; // todo: usar SKU por categoria no calcuateBudget
  const peDireito = consolidated.peDireitoUsadoM;

  // Agrupa pages por pavimento
  const byPavimento = new Map<string, PageResult[]>();
  for (const p of consolidated.pages) {
    const key = p.pavimento || `Pavimento ${p.pageIndex}`;
    const list = byPavimento.get(key) ?? [];
    list.push(p);
    byPavimento.set(key, list);
  }

  const walls: ExtractedWall[] = [];
  const slabs: ExtractedSlab[] = [];
  const corners: ExtractedCorner[] = [];
  let wallSeq = 0;
  let slabSeq = 0;

  for (const [pavimento, pages] of byPavimento) {
    const ext = sum(pages, (p) => p.paredes_externas.area_liquida_m2);
    const extBruta = sum(pages, (p) => p.paredes_externas.area_bruta_m2);
    const extAberturas = sum(pages, (p) => p.paredes_externas.area_aberturas_m2);
    const int = sum(pages, (p) => p.paredes_internas.area_liquida_m2);
    const intBruta = sum(pages, (p) => p.paredes_internas.area_bruta_m2);
    const intAberturas = sum(pages, (p) => p.paredes_internas.area_aberturas_m2);
    const muros = sum(pages, (p) => p.muros.area_bruta_m2);
    const muroAltura = pages[0]?.muros.altura_assumida_m ?? 2.0;
    const piso = sum(pages, (p) => p.laje_piso_m2);
    const coberta = sum(pages, (p) => p.laje_coberta_m2);

    if (extBruta > 0 || ext > 0) {
      wallSeq += 1;
      walls.push(buildSyntheticWall(`W-EXT-${wallSeq}`, pavimento, "externa", extBruta || ext, ext, peDireito, extAberturas));
    }
    if (intBruta > 0 || int > 0) {
      wallSeq += 1;
      walls.push(buildSyntheticWall(`W-INT-${wallSeq}`, pavimento, "interna", intBruta || int, int, peDireito, intAberturas));
    }
    if (muros > 0) {
      wallSeq += 1;
      walls.push(buildSyntheticWall(`W-MURO-${wallSeq}`, pavimento, "muro", muros, muros, muroAltura, 0));
    }
    if (piso > 0) {
      slabSeq += 1;
      slabs.push(buildSyntheticSlab(`S-PISO-${slabSeq}`, pavimento, "piso", piso));
    }
    if (coberta > 0) {
      slabSeq += 1;
      slabs.push(buildSyntheticSlab(`S-COB-${slabSeq}`, pavimento, "coberta", coberta));
    }
  }

  const budget = calculateBudget(walls, slabs, corners);
  return budget;
}

function sum<T>(arr: T[], fn: (x: T) => number): number {
  return arr.reduce((s, x) => s + (fn(x) || 0), 0);
}

function buildSyntheticWall(
  id: string,
  nivel: string,
  classe: "externa" | "interna" | "muro",
  areaBruta: number,
  areaLiquida: number,
  alturaM: number,
  aberturasM2: number,
): ExtractedWall {
  const comprimento = alturaM > 0 ? Math.max(0, areaBruta / alturaM) : 0;
  return {
    id,
    nivel,
    classe,
    comprimento_m: round2(comprimento),
    altura_m: round2(alturaM),
    espessura_m: 0.15,
    measurement_source: "vision-direct",
    confidence: 0.7,
    has_door: false,
    has_window: false,
    opening_area_m2: round2(aberturasM2),
    esquadrias: [],
  } as ExtractedWall;
}

function buildSyntheticSlab(
  id: string,
  nivel: string,
  classe: "piso" | "coberta",
  areaM2: number,
): ExtractedSlab {
  return {
    id,
    nivel,
    classe,
    area_m2: round2(areaM2),
    measurement_source: "vision-direct",
    confidence: 0.7,
  } as ExtractedSlab;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================
// Edicao manual de quantitativos
// ============================================================

export interface VisionDirectEditedPage {
  pageIndex: number;
  paredes_externas: number;
  paredes_internas: number;
  muros: number;
  laje_piso: number;
  laje_coberta: number;
}

/**
 * Aplica edicao manual: substitui os m² liquidos por pagina no
 * vision_direct_summary, recalcula totais, recalcula budget e atualiza
 * registros. Nao chama Gemini.
 */
export async function applyVisionDirectEdit(
  projectId: number,
  editedPages: VisionDirectEditedPage[],
): Promise<void> {
  const allExtracted = await storage.getExtractedData(projectId);
  const summary = allExtracted.find((d: any) => d.elementType === "vision_direct_summary");
  if (!summary) throw new Error("vision_direct_summary nao encontrado");

  const data = (summary.data ?? {}) as any;
  const pages = Array.isArray(data.pages) ? data.pages : [];
  if (pages.length === 0) throw new Error("Summary sem paginas");

  // Snapshot prévio (so na primeira edicao)
  const hasSnapshot = allExtracted.some((d: any) => d.elementType === "vision_direct_summary_original");
  if (!hasSnapshot) {
    await storage.addExtractedData({
      projectId,
      elementType: "vision_direct_summary_original",
      data: structuredClone(data) as any,
      hasAssumption: 0,
    } as any);
  }

  // Aplica edits por pageIndex
  const editsByIdx = new Map<number, VisionDirectEditedPage>();
  for (const ep of editedPages) editsByIdx.set(ep.pageIndex, ep);

  for (const p of pages) {
    const e = editsByIdx.get(p.pageIndex);
    if (!e) continue;
    const extLiq = Math.max(0, Number(e.paredes_externas) || 0);
    const intLiq = Math.max(0, Number(e.paredes_internas) || 0);
    const muros = Math.max(0, Number(e.muros) || 0);
    const piso = Math.max(0, Number(e.laje_piso) || 0);
    const coberta = Math.max(0, Number(e.laje_coberta) || 0);
    p.paredes_externas = {
      area_bruta_m2: extLiq,
      area_aberturas_m2: 0,
      area_liquida_m2: extLiq,
    };
    p.paredes_internas = {
      area_bruta_m2: intLiq,
      area_aberturas_m2: 0,
      area_liquida_m2: intLiq,
    };
    p.muros = { area_bruta_m2: muros, altura_assumida_m: p.muros?.altura_assumida_m ?? 2.0 };
    p.laje_piso_m2 = piso;
    p.laje_coberta_m2 = coberta;
  }

  // Recalcula totais
  const totais = {
    paredes_externas_liquida_m2: round2(sum(pages, (p: any) => p.paredes_externas.area_liquida_m2)),
    paredes_internas_liquida_m2: round2(sum(pages, (p: any) => p.paredes_internas.area_liquida_m2)),
    muros_m2: round2(sum(pages, (p: any) => p.muros.area_bruta_m2)),
    laje_piso_m2: round2(sum(pages, (p: any) => p.laje_piso_m2)),
    laje_coberta_m2: round2(sum(pages, (p: any) => p.laje_coberta_m2)),
  };
  data.totais = totais;
  data.pages = pages;

  await storage.updateExtractedDataByType(projectId, "vision_direct_summary", data);

  // Recalcula budget a partir do consolidated reconstruido
  const reconstructed: VisionDirectResult = {
    peDireitoUsadoM: data.peDireitoUsadoM ?? 3.0,
    peDireitoFonte: data.peDireitoFonte ?? "default",
    pages: pages as PageResult[],
    totais,
    costUsd: data.costUsd ?? 0,
    durationMs: data.durationMs ?? 0,
    preflight: data.preflight ?? { fileType: "image", pageCount: pages.length, isPdfVector: null },
  };
  const project = await storage.getProject(projectId);
  try {
    const baseBudget = await buildBudget(reconstructed, project?.pricingProfileId ?? null, projectId, undefined);
    const enriched = await enrichBudgetForFooter(reconstructed, baseBudget, project?.pricingProfileId ?? null, undefined);
    await storage.deleteBudget(projectId);
    await storage.createBudget({
      projectId,
      budgetData: enriched as any,
      totalArea: String(enriched.totalArea.toFixed(2)) as any,
      totalCost: String(enriched.totalCost.toFixed(2)) as any,
      status: "finalizado",
    } as any);
  } catch (err: any) {
    console.warn(`[VD-EDIT] Projeto ${projectId} budget recalc falhou: ${err?.message || err}`);
  }
  console.log(`[VD-EDIT] Projeto ${projectId}: edicao manual aplicada (${editedPages.length} paginas editadas)`);
}

// ============================================================
// Enriquecimento do budget para o CompletedFooter
// ============================================================

/**
 * Pega o BudgetResult cru de calculateBudget e o enriquece com custos por
 * categoria e totais agregados, no formato esperado por CompletedFooter:
 *   pavimentos: [
 *     {
 *       nome,
 *       paredes_externas: { area_liquida_m2, custo_total },
 *       paredes_internas: { area_liquida_m2, custo_total },
 *       muros:            { area_liquida_m2, custo_total },
 *       laje_piso:        { area_m2,         custo_total },
 *       laje_coberta:     { area_m2,         custo_total },
 *     }
 *   ]
 *   totalArea: number
 *   totalCost: number
 *
 * Preço por categoria vem do produto selecionado (productIds.kind) ou,
 * na falta, do catalogo via storage.getProducts() (primeiro 2P / SP).
 */
async function enrichBudgetForFooter(
  consolidated: VisionDirectResult,
  baseBudget: BudgetResult,
  pricingProfileId: number | null,
  productIds?: VisionDirectProductIds,
): Promise<any> {
  // Resolve precos unitarios por categoria. applyProfilePrices aplica
  // overrides do pricing profile do projeto (se houver) sobre o catalogo
  // base.
  const rawProducts = await storage.getProducts().catch(() => [] as any[]);
  const products = await applyProfilePrices(rawProducts as any, pricingProfileId);
  const findById = (id?: number) => products.find((p: any) => p.id === id);
  const find2P = () =>
    products.find((p: any) => p.sku === "LW-2P-090") ||
    products.find((p: any) => p.panelType === "2P");
  const findSP = () =>
    products.find((p: any) => p.sku === "LW-SP-090") ||
    products.find((p: any) => p.panelType === "SP");
  const priceOf = (id?: number, fallback?: any): number => {
    const prod = findById(id) || fallback;
    return prod ? Number(prod.unitPrice) || 0 : 0;
  };
  const prices = {
    ext: priceOf(productIds?.ext, find2P()),
    int: priceOf(productIds?.int, find2P()),
    muros: priceOf(productIds?.muros, find2P()),
    piso: priceOf(productIds?.piso, findSP()),
    coberta: priceOf(productIds?.coberta, findSP()),
  };

  // Constroi pavimentos enriquecidos a partir dos pages
  const byPav = new Map<string, PageResult[]>();
  for (const p of consolidated.pages) {
    const key = p.pavimento || `Pavimento ${p.pageIndex}`;
    const list = byPav.get(key) ?? [];
    list.push(p);
    byPav.set(key, list);
  }
  const pavimentos: Array<Record<string, any>> = [];
  let totalArea = 0;
  let totalCost = 0;
  for (const [nome, pages] of byPav) {
    const ext = sum(pages, (p) => p.paredes_externas.area_liquida_m2);
    const int_ = sum(pages, (p) => p.paredes_internas.area_liquida_m2);
    const muros = sum(pages, (p) => p.muros.area_bruta_m2);
    const piso = sum(pages, (p) => p.laje_piso_m2);
    const coberta = sum(pages, (p) => p.laje_coberta_m2);
    const extCost = round2(ext * prices.ext);
    const intCost = round2(int_ * prices.int);
    const murosCost = round2(muros * prices.muros);
    const pisoCost = round2(piso * prices.piso);
    const cobCost = round2(coberta * prices.coberta);
    totalArea += ext + int_ + muros + piso + coberta;
    totalCost += extCost + intCost + murosCost + pisoCost + cobCost;
    pavimentos.push({
      nome,
      paredes_externas: { area_liquida_m2: round2(ext), custo_total: extCost, preco_unitario: prices.ext },
      paredes_internas: { area_liquida_m2: round2(int_), custo_total: intCost, preco_unitario: prices.int },
      muros: { area_liquida_m2: round2(muros), custo_total: murosCost, preco_unitario: prices.muros },
      laje_piso: { area_m2: round2(piso), custo_total: pisoCost, preco_unitario: prices.piso },
      laje_coberta: { area_m2: round2(coberta), custo_total: cobCost, preco_unitario: prices.coberta },
    });
  }

  return {
    pavimentos,
    totalArea: round2(totalArea),
    totalCost: round2(totalCost),
    // Mantem o resultado cru de calculateBudget para futuras camadas
    raw: baseBudget,
  };
}
