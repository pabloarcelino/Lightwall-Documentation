/**
 * Suite de regressão de acurácia quantitativa.
 *
 * Lê o ground-truth em groundTruth.json e compara contra os orçamentos
 * persistidos no banco (tabela `budgets`). NÃO chama IA — assume que o
 * pipeline já foi executado nos projetos de referência. Use após cada
 * execução completa para acompanhar a evolução da acurácia.
 *
 * Uso:
 *   npx tsx server/tests/accuracy.ts            # roda todas as fixtures
 *   npx tsx server/tests/accuracy.ts patricia   # filtra por chave
 *
 * Fórmula (alinhada com server/routes.ts /calibration):
 *   acuracia_categoria = max(0, 100 - |dev_pct|)
 *   media = avg(acuracia_categoria, com peso = m² ground-truth)
 */
import fs from "fs/promises";
import path from "path";
import { db } from "../db";
import { projects, budgets } from "@shared/schema";
import { sql } from "drizzle-orm";

interface GroundTruth {
  fingerprint_hint?: string;
  ground_truth_m2: {
    paredes_externas: number;
    paredes_internas: number;
    muros: number;
    laje_piso: number;
    laje_coberta: number;
  } | null;
  total_m2?: number;
  fonte?: string;
  obs?: string;
}

interface BudgetCategoryArea {
  paredes_externas: number;
  paredes_internas: number;
  muros: number;
  laje_piso: number;
  laje_coberta: number;
}

const META_OVERALL_PCT = 85;
const META_PER_CATEGORY_PCT = 70;

function extractAreasFromBudget(budget: any): BudgetCategoryArea {
  const pavs: any[] = budget?.pavimentos || [];
  const sum = (key1: string, key2: string) =>
    pavs.reduce((s, p) => s + (Number(p?.[key1]?.[key2]) || 0), 0);
  return {
    paredes_externas: sum("paredes_externas", "area_bruta_m2"),
    paredes_internas: sum("paredes_internas", "area_bruta_m2"),
    muros: sum("muros", "area_bruta_m2"),
    laje_piso: sum("laje_piso", "area_m2"),
    laje_coberta: sum("laje_coberta", "area_m2"),
  };
}

function categoryAccuracy(actual: number, truth: number): number {
  if (truth <= 0 && actual <= 0) return 100;
  if (truth <= 0) return 0;
  const devPct = Math.abs(actual - truth) / truth * 100;
  return Math.max(0, 100 - devPct);
}

function weightedAverage(per: Record<string, number>, weights: Record<string, number>): number {
  let totalW = 0, weighted = 0;
  for (const k of Object.keys(per)) {
    const w = weights[k] || 0;
    if (w <= 0) continue;
    totalW += w;
    weighted += per[k] * w;
  }
  return totalW > 0 ? weighted / totalW : 0;
}

async function findBudgetForFixture(hint: string): Promise<{ project: any; budget: any } | null> {
  const rows = await db
    .select()
    .from(projects)
    .where(sql`${projects.name} ILIKE ${"%" + hint.replace(/[._-]/g, "%") + "%"}`)
    .orderBy(sql`${projects.createdAt} DESC`)
    .limit(5);
  for (const proj of rows) {
    const budgetRows = await db
      .select()
      .from(budgets)
      .where(sql`${budgets.projectId} = ${proj.id}`)
      .orderBy(sql`${budgets.createdAt} DESC`)
      .limit(1);
    if (budgetRows.length > 0) {
      return { project: proj, budget: budgetRows[0].budgetData };
    }
  }
  return null;
}

async function main() {
  const filter = process.argv[2]?.toLowerCase();
  const gtPath = path.join(import.meta.dirname, "groundTruth.json");
  const raw = await fs.readFile(gtPath, "utf-8");
  const fixtures: Record<string, GroundTruth> = JSON.parse(raw);

  const results: Array<{ name: string; overall: number; per: Record<string, number>; status: "PASS" | "FAIL" | "SKIP" }> = [];
  let anyMatched = false;

  for (const [key, gt] of Object.entries(fixtures)) {
    if (key.startsWith("$")) continue;
    if (filter && !key.toLowerCase().includes(filter)) continue;
    anyMatched = true;
    if (!gt.ground_truth_m2) {
      console.log(`\n[${key}] SKIP — sem ground-truth definido (${gt.obs || "preencher manualmente"})`);
      results.push({ name: key, overall: 0, per: {}, status: "SKIP" });
      continue;
    }
    const hint = gt.fingerprint_hint || key;
    const found = await findBudgetForFixture(hint);
    if (!found) {
      console.log(`\n[${key}] SKIP — nenhum projeto/orcamento encontrado para "${hint}"`);
      console.log(`        execute o pipeline em ${gt.fingerprint_hint} antes de rodar a regressao`);
      results.push({ name: key, overall: 0, per: {}, status: "SKIP" });
      continue;
    }
    const actual = extractAreasFromBudget(found.budget);
    const per: Record<string, number> = {};
    for (const k of Object.keys(gt.ground_truth_m2) as Array<keyof BudgetCategoryArea>) {
      per[k] = categoryAccuracy(actual[k], gt.ground_truth_m2[k]);
    }
    const overall = weightedAverage(per, gt.ground_truth_m2 as any);
    const minPer = Math.min(...Object.values(per).filter((_, i) => Object.values(gt.ground_truth_m2!)[i] > 0));
    const status: "PASS" | "FAIL" = overall >= META_OVERALL_PCT && minPer >= META_PER_CATEGORY_PCT ? "PASS" : "FAIL";

    console.log(`\n=== [${key}] projeto ${found.project.id} (${found.project.name}) ===`);
    console.log("  categoria         truth   actual   acuracia");
    for (const k of Object.keys(per)) {
      const t = (gt.ground_truth_m2 as any)[k];
      const a = (actual as any)[k];
      console.log(`  ${k.padEnd(17)} ${String(t).padStart(7)}  ${String(a.toFixed(2)).padStart(7)}  ${per[k].toFixed(1)}%`);
    }
    console.log(`  -----`);
    console.log(`  ACURACIA MEDIA PONDERADA: ${overall.toFixed(1)}% (meta ≥${META_OVERALL_PCT}%)`);
    console.log(`  MENOR CATEGORIA:          ${minPer.toFixed(1)}% (meta ≥${META_PER_CATEGORY_PCT}%)`);
    console.log(`  STATUS: ${status}`);
    results.push({ name: key, overall, per, status });
  }

  if (!anyMatched) {
    console.error(`Nenhuma fixture casou com "${filter}"`);
    process.exit(2);
  }

  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  const skipped = results.filter(r => r.status === "SKIP").length;
  const evaluated = passed + failed;
  console.log(`\n========================================`);
  console.log(`RESUMO: ${passed} PASS / ${failed} FAIL / ${skipped} SKIP`);
  console.log(`========================================`);
  if (evaluated === 0) {
    console.error(`ERRO: nenhuma fixture foi efetivamente avaliada (todas SKIP). Rode o pipeline nos projetos de referência antes da regressão.`);
    process.exit(2);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[accuracy] erro fatal:", err);
  process.exit(2);
});
