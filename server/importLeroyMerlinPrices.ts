#!/usr/bin/env tsx
/**
 * Importa a Tabela Unificada Leroy Merlin (xlsx) para o catalogo de precos.
 *
 * Estrategia:
 *  - Le a aba "Tabelas_Nova Valida" (264 linhas, 22 produtos x 12 centrais).
 *  - Cria/atualiza um perfil de preco por CENTRAL (LM-MACEIO, LM-FORTALEZA, ...).
 *  - Casa o nome do produto da planilha com o SKU do catalogo (normalizando acentos/aspas).
 *  - Faz upsert de profile_prices usando a coluna "TABELA VALIDA" (preco SEM frete).
 *    Frete e tratado a parte (campo freightCost por projeto + futura tabela de frete por central).
 *
 * Uso:
 *   npx tsx server/importLeroyMerlinPrices.ts <caminho-para-xlsx>
 *
 * Idempotente: rodar de novo apenas atualiza precos / cria perfis faltantes.
 */
import ExcelJS from "exceljs";
import path from "path";
import { db } from "./db";
import { products, pricingProfiles, profilePrices } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "./storage";

const SHEET_NAME = "Tabelas_Nova Válida";
const COL_DESCRICAO = 2;
const COL_TIPO = 3;
const COL_CENTRAL = 4;
const COL_TABELA_VALIDA = 7;

const SOURCE_LABEL = "Leroy Merlin (Tabela Unificada V2)";

function normalizeName(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function centralToSlug(central: string): string {
  return normalizeName(central).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cellNumber(cell: ExcelJS.CellValue): number | null {
  if (cell == null) return null;
  if (typeof cell === "number") return cell;
  if (typeof cell === "string") {
    const n = Number(cell.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof cell === "object" && cell !== null) {
    const v = (cell as any).result ?? (cell as any).text ?? (cell as any).value;
    return cellNumber(v as ExcelJS.CellValue);
  }
  return null;
}

interface PriceRow {
  desc: string;
  central: string;
  preco: number;
}

async function readSheet(filePath: string): Promise<PriceRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`Aba "${SHEET_NAME}" nao encontrada em ${filePath}`);
  const out: PriceRow[] = [];
  for (let i = 3; i <= ws.rowCount; i++) {
    const r = ws.getRow(i);
    const desc = r.getCell(COL_DESCRICAO).value;
    const central = r.getCell(COL_CENTRAL).value;
    const preco = cellNumber(r.getCell(COL_TABELA_VALIDA).value);
    if (!desc || !central || preco == null || preco <= 0) continue;
    out.push({ desc: String(desc), central: String(central), preco });
  }
  return out;
}

async function buildSkuMap(): Promise<Map<string, string>> {
  const all = await db.select().from(products);
  const map = new Map<string, string>();
  for (const p of all) map.set(normalizeName(p.name), p.sku);
  return map;
}

async function ensureProfile(central: string): Promise<number> {
  const code = `LM-${centralToSlug(central)}`;
  const [existing] = await db.select().from(pricingProfiles).where(eq(pricingProfiles.code, code));
  if (existing) return existing.id;
  const created = await storage.createPricingProfile({
    code,
    label: `Leroy Merlin — ${central}`,
    region: central,
    isDefault: 0,
    active: 1,
  });
  console.log(`   + perfil criado: ${code}`);
  return created.id;
}

async function findDefaultXlsx(): Promise<string> {
  // Procura o arquivo mais recente que comece com "Tabela_Unificada" em attached_assets/.
  // Evita prender no nome com timestamp; quando o usuario reenviar uma versao nova, pega ela.
  const dir = path.resolve("attached_assets");
  const fs = await import("fs/promises");
  try {
    const entries = await fs.readdir(dir);
    const candidates = entries
      .filter(n => /^Tabela_Unificada.*\.xlsx$/i.test(n))
      .map(n => path.join(dir, n));
    if (candidates.length === 0) throw new Error("nenhum arquivo Tabela_Unificada*.xlsx encontrado em attached_assets/");
    // Pega o mais recente por mtime
    const stats = await Promise.all(candidates.map(async p => ({ p, m: (await fs.stat(p)).mtimeMs })));
    stats.sort((a, b) => b.m - a.m);
    return stats[0].p;
  } catch (e) {
    throw new Error(`Caminho do xlsx nao informado e default falhou: ${(e as Error).message}`);
  }
}

async function main() {
  const argPath = process.argv[2];
  const filePath = argPath ? path.resolve(argPath) : await findDefaultXlsx();
  console.log(`Lendo ${filePath}...`);

  const rows = await readSheet(filePath);
  console.log(`  -> ${rows.length} linhas de preco lidas`);
  const skuMap = await buildSkuMap();
  console.log(`  -> ${skuMap.size} produtos no catalogo`);

  const centrais = Array.from(new Set(rows.map(r => r.central))).sort();
  const profileIdByCentral = new Map<string, number>();
  for (const c of centrais) profileIdByCentral.set(c, await ensureProfile(c));

  let upserted = 0;
  const unmatched = new Set<string>();
  for (const r of rows) {
    const sku = skuMap.get(normalizeName(r.desc));
    if (!sku) { unmatched.add(r.desc); continue; }
    const profileId = profileIdByCentral.get(r.central)!;
    await storage.upsertProfilePrice(profileId, sku, r.preco.toFixed(2));
    upserted += 1;
  }

  console.log(`\nResumo:`);
  console.log(`  centrais (perfis): ${centrais.length}`);
  console.log(`  precos importados (upserts): ${upserted}/${rows.length}`);
  if (unmatched.size > 0) {
    console.log(`  produtos sem SKU correspondente (${unmatched.size}):`);
    for (const n of unmatched) console.log(`    - ${n}`);
  }
  // Sentinela contra silent mass-skip: se o casamento por nome falhou em mais de 10%
  // das linhas, alerta com codigo de saida nao-zero para o operador investigar.
  const matchRate = rows.length > 0 ? upserted / rows.length : 1;
  if (matchRate < 0.9) {
    console.error(`\n[WARN] Match rate baixa (${(matchRate * 100).toFixed(1)}%). Possivel renomeacao ou desalinhamento de SKUs. Revise os produtos nao-casados acima.`);
    console.log(`\nFonte: ${SOURCE_LABEL}`);
    process.exit(2);
  }
  console.log(`\nFonte: ${SOURCE_LABEL}`);
  process.exit(0);
}

main().catch(err => {
  console.error("Falha ao importar precos LM:", err);
  process.exit(1);
});
