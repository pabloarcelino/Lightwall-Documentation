import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { TakeoffSegment, TakeoffSlab, ProjectPage, Project } from "@shared/schema";

const CATEGORY_LABEL: Record<string, string> = {
  parede_externa: "Paredes Externas",
  parede_interna: "Paredes Internas",
  muro: "Muros",
  laje_piso: "Lajes de Piso",
  laje_cobertura: "Lajes de Cobertura",
};

export interface TakeoffExportInput {
  project: Project;
  pages: ProjectPage[];
  segments: TakeoffSegment[];
  slabs: TakeoffSlab[];
  assumptions: string;
}

export async function exportTakeoffExcel(input: TakeoffExportInput): Promise<Buffer> {
  const { project, segments, slabs, assumptions, pages } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Lightwall";
  wb.created = new Date();

  // Resumo
  const ws = wb.addWorksheet("Resumo");
  ws.addRow(["Projeto", project.name]);
  ws.addRow(["Cliente", project.clientName ?? ""]);
  ws.addRow(["Gerado em", new Date().toLocaleString("pt-BR")]);
  ws.addRow([]);
  ws.addRow(["Categoria", "Quantidade", "Total"]);
  const totals: Record<string, { qty: number; total: number; unit: string }> = {
    parede_externa: { qty: 0, total: 0, unit: "m²" },
    parede_interna: { qty: 0, total: 0, unit: "m²" },
    muro: { qty: 0, total: 0, unit: "m²" },
    laje_piso: { qty: 0, total: 0, unit: "m²" },
    laje_cobertura: { qty: 0, total: 0, unit: "m²" },
  };
  for (const s of segments) {
    const t = totals[s.category];
    if (!t) continue;
    t.qty += 1;
    t.total += (s.areaM2OneFace ?? 0) + (s.areaM2TwoFaces ? s.areaM2TwoFaces - (s.areaM2OneFace ?? 0) : 0);
  }
  for (const sl of slabs) {
    const t = totals[sl.category];
    if (!t) continue;
    t.qty += 1;
    t.total += sl.areaM2Final ?? sl.areaM2Calculated ?? sl.areaM2Declared ?? sl.areaM2Ai ?? 0;
  }
  for (const [cat, t] of Object.entries(totals)) {
    ws.addRow([CATEGORY_LABEL[cat] ?? cat, t.qty, `${t.total.toFixed(2)} ${t.unit}`]);
  }
  ws.columns = [{ width: 28 }, { width: 14 }, { width: 18 }];

  // Per-category sheets
  for (const cat of ["parede_externa", "parede_interna", "muro"] as const) {
    const sheet = wb.addWorksheet(CATEGORY_LABEL[cat]);
    sheet.columns = [
      { header: "Codigo", key: "code", width: 10 },
      { header: "Pavimento", key: "level", width: 16 },
      { header: "Pagina", key: "page", width: 8 },
      { header: "Comp. IA (m)", key: "lai", width: 12 },
      { header: "Comp. Calc. (m)", key: "lcalc", width: 14 },
      { header: "Comp. Final (m)", key: "lfin", width: 14 },
      { header: "Altura (m)", key: "h", width: 10 },
      { header: "Area 1 face (m²)", key: "a1", width: 14 },
      { header: "Area 2 faces (m²)", key: "a2", width: 14 },
      { header: "Confianca", key: "conf", width: 10 },
      { header: "Evidencia", key: "ev", width: 40 },
      { header: "Revisado", key: "rev", width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const s of segments.filter((x) => x.category === cat)) {
      const page = pages.find((p) => p.id === s.pageId);
      sheet.addRow({
        code: s.code ?? `#${s.id}`,
        level: s.level,
        page: page?.pageNumber ?? "",
        lai: round(s.lengthMAi),
        lcalc: round(s.lengthMCalculated),
        lfin: round(s.lengthMFinal ?? s.lengthMCalculated ?? s.lengthMAi),
        h: round(s.heightM),
        a1: round(s.areaM2OneFace),
        a2: round(s.areaM2TwoFaces),
        conf: round(s.confidence),
        ev: s.evidence ?? "",
        rev: s.reviewed ? "Sim" : "Nao",
      });
    }
  }

  const sheetLajes = wb.addWorksheet("Lajes");
  sheetLajes.columns = [
    { header: "Codigo", key: "code", width: 10 },
    { header: "Categoria", key: "cat", width: 18 },
    { header: "Pavimento", key: "level", width: 16 },
    { header: "Pagina", key: "page", width: 8 },
    { header: "Area IA (m²)", key: "ai", width: 14 },
    { header: "Area Declarada (m²)", key: "decl", width: 16 },
    { header: "Area Calculada (m²)", key: "calc", width: 16 },
    { header: "Area Final (m²)", key: "fin", width: 14 },
    { header: "Confianca", key: "conf", width: 10 },
    { header: "Evidencia", key: "ev", width: 40 },
    { header: "Revisado", key: "rev", width: 10 },
  ];
  sheetLajes.getRow(1).font = { bold: true };
  for (const sl of slabs) {
    const page = pages.find((p) => p.id === sl.pageId);
    sheetLajes.addRow({
      code: sl.code ?? `#${sl.id}`,
      cat: CATEGORY_LABEL[sl.category] ?? sl.category,
      level: sl.level,
      page: page?.pageNumber ?? "",
      ai: round(sl.areaM2Ai),
      decl: round(sl.areaM2Declared),
      calc: round(sl.areaM2Calculated),
      fin: round(sl.areaM2Final ?? sl.areaM2Calculated ?? sl.areaM2Declared ?? sl.areaM2Ai),
      conf: round(sl.confidence),
      ev: sl.evidence ?? "",
      rev: sl.reviewed ? "Sim" : "Nao",
    });
  }

  const sheetPrem = wb.addWorksheet("Premissas");
  sheetPrem.addRow(["Premissas de calculo"]);
  sheetPrem.addRow([assumptions || "(sem premissas)"]);
  sheetPrem.addRow([]);
  sheetPrem.addRow(["Aviso", "Quantitativo assistido por IA. Revise antes de usar em orcamento executivo."]);

  const sheetRev = wb.addWorksheet("Revisoes");
  sheetRev.columns = [
    { header: "Codigo", key: "code", width: 10 },
    { header: "Tipo", key: "tipo", width: 16 },
    { header: "Status", key: "status", width: 16 },
    { header: "Observacao", key: "obs", width: 40 },
  ];
  sheetRev.getRow(1).font = { bold: true };
  for (const s of segments) {
    if (s.needsReview || !s.reviewed) {
      sheetRev.addRow({
        code: s.code ?? `S#${s.id}`,
        tipo: CATEGORY_LABEL[s.category] ?? s.category,
        status: s.needsReview ? "Revisar" : "Pendente",
        obs: s.evidence ?? "",
      });
    }
  }
  for (const sl of slabs) {
    if (sl.needsReview || !sl.reviewed) {
      sheetRev.addRow({
        code: sl.code ?? `L#${sl.id}`,
        tipo: CATEGORY_LABEL[sl.category] ?? sl.category,
        status: sl.needsReview ? "Revisar" : "Pendente",
        obs: sl.evidence ?? "",
      });
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function exportTakeoffPdf(input: TakeoffExportInput): Promise<Buffer> {
  const { project, segments, slabs, assumptions, pages } = input;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text(`Relatorio de Quantitativo - ${project.name}`, { align: "left" });
    doc.fontSize(11).fillColor("#666").text(`Cliente: ${project.clientName ?? "-"}`);
    doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`);
    doc.moveDown();
    doc.fillColor("#000");

    doc.fontSize(13).text("Aviso", { underline: true });
    doc.fontSize(10).text(
      "Quantitativo assistido por IA. Revise antes de usar em orcamento executivo.",
    );
    doc.moveDown();

    doc.fontSize(13).text("Resumo", { underline: true });
    const totals = computeTotals(segments, slabs);
    for (const [cat, info] of Object.entries(totals)) {
      doc
        .fontSize(11)
        .text(
          `${CATEGORY_LABEL[cat] ?? cat}: ${info.qty} elementos | ${info.total.toFixed(2)} m²`,
        );
    }
    doc.moveDown();

    doc.fontSize(13).text("Premissas", { underline: true });
    doc.fontSize(10).text(assumptions || "(sem premissas)");
    doc.moveDown();

    for (const cat of ["parede_externa", "parede_interna", "muro"] as const) {
      const list = segments.filter((s) => s.category === cat);
      if (list.length === 0) continue;
      doc.addPage();
      doc.fontSize(14).text(CATEGORY_LABEL[cat]);
      doc.moveDown(0.5);
      doc.fontSize(9);
      for (const s of list) {
        const page = pages.find((p) => p.id === s.pageId);
        doc.text(
          `${s.code ?? "#" + s.id}  pag.${page?.pageNumber ?? "-"}  ${s.level}  comp=${round(
            s.lengthMFinal ?? s.lengthMCalculated ?? s.lengthMAi,
          )}m  h=${round(s.heightM)}m  area1=${round(s.areaM2OneFace)}m²${
            s.areaM2TwoFaces ? `  area2=${round(s.areaM2TwoFaces)}m²` : ""
          }  conf=${round(s.confidence)}  ${s.reviewed ? "[REVISADO]" : "[pend]"}`,
        );
      }
    }

    if (slabs.length > 0) {
      doc.addPage();
      doc.fontSize(14).text("Lajes");
      doc.fontSize(9);
      for (const sl of slabs) {
        const page = pages.find((p) => p.id === sl.pageId);
        doc.text(
          `${sl.code ?? "#" + sl.id}  ${CATEGORY_LABEL[sl.category]}  pag.${page?.pageNumber ?? "-"}  ${sl.level}  area=${round(
            sl.areaM2Final ?? sl.areaM2Calculated ?? sl.areaM2Declared ?? sl.areaM2Ai,
          )}m²  conf=${round(sl.confidence)}  ${sl.reviewed ? "[REVISADO]" : "[pend]"}`,
        );
      }
    }
    doc.end();
  });
}

function round(v: number | null | undefined): string {
  if (v == null) return "-";
  return Number(v).toFixed(2);
}

function computeTotals(segments: TakeoffSegment[], slabs: TakeoffSlab[]) {
  const totals: Record<string, { qty: number; total: number }> = {
    parede_externa: { qty: 0, total: 0 },
    parede_interna: { qty: 0, total: 0 },
    muro: { qty: 0, total: 0 },
    laje_piso: { qty: 0, total: 0 },
    laje_cobertura: { qty: 0, total: 0 },
  };
  for (const s of segments) {
    const t = totals[s.category];
    if (!t) continue;
    t.qty += 1;
    t.total += (s.areaM2OneFace ?? 0) + (s.areaM2TwoFaces ? s.areaM2TwoFaces - (s.areaM2OneFace ?? 0) : 0);
  }
  for (const sl of slabs) {
    const t = totals[sl.category];
    if (!t) continue;
    t.qty += 1;
    t.total += sl.areaM2Final ?? sl.areaM2Calculated ?? sl.areaM2Declared ?? sl.areaM2Ai ?? 0;
  }
  return totals;
}
