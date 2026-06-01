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

export interface VisionDirectScope {
  paredesExternas: boolean;
  paredesInternas: boolean;
  muros: boolean;
  lajePiso: boolean;
  lajeCoberta: boolean;
}

export interface RunVisionDirectForProjectInput {
  projectId: number;
  userId: number | null;
  defaultPeDireitoM?: number;
  scope?: VisionDirectScope;
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

  try {
    console.log(`[VD-PROJECT] Projeto ${projectId}: runVisionDirectForProject INICIO (defaultPe=${defaultPeDireitoM}m)`);
    await storage.updateProjectStatus(projectId, "processing");
    console.log(`[VD-PROJECT] Projeto ${projectId}: status -> processing`);

    const project = await storage.getProject(projectId);
    if (!project) throw new Error(`Projeto ${projectId} nao encontrado`);
    const files = await storage.getProjectFiles(projectId);
    if (files.length === 0) throw new Error("Projeto sem arquivos enviados");

    console.log(`[VD-PROJECT] Projeto ${projectId}: ${files.length} arquivo(s) registrados`);

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
      const fileStart = Date.now();
      console.log(
        `[VD-PROJECT] Projeto ${projectId} arquivo ${tag} (${file.originalName}) iniciando analise...`,
      );
      try {
        const analyzePromise = analyzeVisionDirect({
          filePath: file.filePath,
          fileType: inferFileType(file.fileType, file.originalName),
          fileName: file.originalName,
          defaultPeDireitoM,
          userId: input.userId ?? undefined,
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
        return { fileName: file.originalName, result };
      } catch (err: any) {
        console.warn(
          `[VD-PROJECT] Projeto ${projectId} arquivo ${tag} (${file.originalName}) falhou em ${((Date.now() - fileStart) / 1000).toFixed(1)}s: ${err?.message || err}`,
        );
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
    console.log(`[VD-PROJECT] Projeto ${projectId}: consolidando ${perFileResults.length} arquivo(s)...`);
    const rawConsolidated = consolidateResults(perFileResults);
    const consolidated = applyScopeFilter(rawConsolidated, scope);
    const scopeOff = Object.entries(scope).filter(([_, v]) => v === false).map(([k]) => k);
    console.log(
      `[VD-PROJECT] Projeto ${projectId} consolidado: ${consolidated.pages.length} pagina(s), ` +
        `custo US$ ${consolidated.costUsd.toFixed(4)}, ${consolidated.durationMs}ms` +
        (scopeOff.length ? ` (categorias zeradas pelo escopo: ${scopeOff.join(", ")})` : ""),
    );

    if (consolidated.pages.length === 0) {
      throw new Error("Consolidacao resultou em zero paginas analisadas");
    }

    // 3) Limpa extractedData/budget antigos do projeto (caso seja reprocesso)
    console.log(`[VD-PROJECT] Projeto ${projectId}: limpando dados antigos...`);
    await safeDeleteOldData(projectId);

    // 4) Persiste extractedData — OBRIGATORIO. Falha aqui = projeto sem
    // dados utilizaveis, status="error".
    console.log(`[VD-PROJECT] Projeto ${projectId}: persistindo extractedData...`);
    await persistExtractedData(projectId, consolidated);
    console.log(`[VD-PROJECT] Projeto ${projectId}: extractedData persistido`);

    // 5) Calcula budget — SECUNDARIO. Falha aqui apenas loga warn; m² ja
    // estao em extractedData e a UI principal consegue funcionar sem budget.
    console.log(`[VD-PROJECT] Projeto ${projectId}: calculando budget...`);
    try {
      const budget = await buildBudget(consolidated, project.pricingProfileId ?? null, projectId);
      await storage.createBudget({
        projectId,
        budgetData: budget as any,
        totalArea: String(
          (consolidated.totais.paredes_externas_liquida_m2 +
            consolidated.totais.paredes_internas_liquida_m2 +
            consolidated.totais.muros_m2 +
            consolidated.totais.laje_piso_m2 +
            consolidated.totais.laje_coberta_m2).toFixed(2),
        ) as any,
        totalCost: String((budget.resumo?.total_geral_paineis ?? 0).toFixed(2)) as any,
        status: "finalizado",
      } as any);
      console.log(`[VD-PROJECT] Projeto ${projectId}: budget persistido`);
    } catch (err: any) {
      console.warn(
        `[VD-PROJECT] Projeto ${projectId} budget falhou (continuando sem budget): ${err?.message || err}`,
      );
    }

    // 6) Marca projeto como concluido — SEMPRE chega aqui se chegou ao consolidated
    await storage.updateProjectStatus(projectId, "completed");
    console.log(`[VD-PROJECT] Projeto ${projectId}: status -> completed`);
  } catch (err: any) {
    console.error(`[VD-PROJECT] Projeto ${projectId} falhou: ${err?.message || err}`);
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
): Promise<BudgetResult> {
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
