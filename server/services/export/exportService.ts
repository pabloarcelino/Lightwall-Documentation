import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import fs from "fs";
import fsPromises from "fs/promises";
import type {
  QuantitativeResult,
  TechnicalAlert,
} from "../calculation/engine";
import type { Assumption } from "../calculation/assumptions";

// Material list shape used by the export service. Mirrors the structure produced
// in routes.ts ("materials.complementaryMaterials") and consumed below.
export interface MaterialList {
  complementaryMaterials: Array<{
    material: string;
    description?: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
  }>;
  totalCost: number;
}

export interface BudgetExportData {
  projectName: string;
  clientName?: string;
  date: Date;
  quantitatives: QuantitativeResult;
  materials: MaterialList;
  alerts: TechnicalAlert[];
  assumptions: Assumption[];
}

export async function exportToExcel(
  data: BudgetExportData,
  outputPath: string,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();

  const summarySheet = workbook.addWorksheet("Resumo");
  summarySheet.columns = [
    { header: "Item", key: "item", width: 40 },
    { header: "Valor", key: "value", width: 20 },
  ];

  summarySheet.addRows([
    { item: "Projeto", value: data.projectName },
    { item: "Cliente", value: data.clientName || "N/A" },
    { item: "Data", value: data.date.toLocaleDateString("pt-BR") },
    { item: "", value: "" },
    { item: "TOTAIS", value: "" },
    {
      item: "Area Total de Paredes (m2)",
      value: data.quantitatives.totals.totalWallArea.toFixed(2),
    },
    {
      item: "Area Total de Lajes (m2)",
      value: data.quantitatives.totals.totalSlabArea.toFixed(2),
    },
    {
      item: "Total de Paineis 2P",
      value: data.quantitatives.totals.totalPanels2P,
    },
    {
      item: "TOTAL DE PAINEIS",
      value: data.quantitatives.totals.totalPanels,
    },
  ]);

  const wallsSheet = workbook.addWorksheet("Paredes");
  wallsSheet.columns = [
    { header: "Tipo", key: "type", width: 20 },
    { header: "Area Bruta (m2)", key: "grossArea", width: 18 },
    { header: "Area Esquadrias (m2)", key: "openingsArea", width: 20 },
    { header: "Area Liquida (m2)", key: "netArea", width: 18 },
    { header: "Proporcao Esquadrias (%)", key: "openingsRatio", width: 25 },
    { header: "Perda (%)", key: "loss", width: 12 },
    { header: "Area com Perda (m2)", key: "areaWithLoss", width: 20 },
    { header: "Paineis 2P", key: "panels2P", width: 15 },
  ];

  wallsSheet.addRows([
    {
      type: "Externas",
      grossArea: data.quantitatives.walls.external.grossArea.toFixed(2),
      openingsArea:
        data.quantitatives.walls.external.openingsArea.toFixed(2),
      netArea: data.quantitatives.walls.external.netArea.toFixed(2),
      openingsRatio: (
        data.quantitatives.walls.external.openingsRatio * 100
      ).toFixed(1),
      loss: (
        data.quantitatives.walls.external.lossCoefficient * 100
      ).toFixed(0),
      areaWithLoss:
        data.quantitatives.walls.external.areaWithLoss.toFixed(2),
      panels2P: data.quantitatives.walls.external.panels2P,
    },
    {
      type: "Internas",
      grossArea: data.quantitatives.walls.internal.grossArea.toFixed(2),
      openingsArea:
        data.quantitatives.walls.internal.openingsArea.toFixed(2),
      netArea: data.quantitatives.walls.internal.netArea.toFixed(2),
      openingsRatio: (
        data.quantitatives.walls.internal.openingsRatio * 100
      ).toFixed(1),
      loss: (
        data.quantitatives.walls.internal.lossCoefficient * 100
      ).toFixed(0),
      areaWithLoss:
        data.quantitatives.walls.internal.areaWithLoss.toFixed(2),
      panels2P: data.quantitatives.walls.internal.panels2P,
    },
  ]);

  const slabsSheet = workbook.addWorksheet("Lajes");
  slabsSheet.columns = [
    { header: "Tipo", key: "type", width: 20 },
    { header: "Area Total (m2)", key: "totalArea", width: 18 },
    { header: "Perda (%)", key: "loss", width: 12 },
    { header: "Area com Perda (m2)", key: "areaWithLoss", width: 20 },
    { header: "Paineis 2P", key: "panels2P", width: 15 },
  ];

  slabsSheet.addRows([
    {
      type: "Piso",
      totalArea: data.quantitatives.slabs.floor.totalArea.toFixed(2),
      loss: (data.quantitatives.slabs.floor.lossCoefficient * 100).toFixed(0),
      areaWithLoss:
        data.quantitatives.slabs.floor.areaWithLoss.toFixed(2),
      panels2P: data.quantitatives.slabs.floor.panels2P,
    },
    {
      type: "Cobertura",
      totalArea: data.quantitatives.slabs.roof.totalArea.toFixed(2),
      loss: (data.quantitatives.slabs.roof.lossCoefficient * 100).toFixed(0),
      areaWithLoss: data.quantitatives.slabs.roof.areaWithLoss.toFixed(2),
      panels2P: data.quantitatives.slabs.roof.panels2P,
    },
  ]);

  const materialsSheet = workbook.addWorksheet("Materiais");
  materialsSheet.columns = [
    { header: "Material", key: "name", width: 40 },
    { header: "Unidade", key: "unit", width: 12 },
    { header: "Quantidade", key: "quantity", width: 15 },
    { header: "Referencia", key: "reference", width: 35 },
  ];

  materialsSheet.addRows(data.materials.complementaryMaterials);

  if (data.alerts.length > 0) {
    const alertsSheet = workbook.addWorksheet("Alertas");
    alertsSheet.columns = [
      { header: "Nivel", key: "level", width: 15 },
      { header: "Mensagem", key: "message", width: 60 },
      { header: "Elementos Afetados", key: "elements", width: 30 },
    ];

    alertsSheet.addRows(
      data.alerts.map((alert) => ({
        level: alert.level.toUpperCase(),
        message: alert.message,
        elements: alert.affectedElements.join(", "),
      })),
    );
  }

  if (data.assumptions.length > 0) {
    const assumptionsSheet = workbook.addWorksheet("Premissas");
    assumptionsSheet.columns = [
      { header: "Campo", key: "field", width: 20 },
      { header: "Valor", key: "value", width: 15 },
      { header: "Unidade", key: "unit", width: 12 },
      { header: "Descricao", key: "description", width: 50 },
      { header: "Aplicado a", key: "appliedTo", width: 30 },
    ];

    assumptionsSheet.addRows(
      data.assumptions.map((assumption) => ({
        field: assumption.field,
        value: assumption.value,
        unit: assumption.unit,
        description: assumption.description,
        appliedTo: assumption.appliedTo.join(", "),
      })),
    );
  }

  await workbook.xlsx.writeFile(outputPath);
}

export async function exportToPDF(
  data: BudgetExportData,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(outputPath);

    doc.pipe(stream);

    doc.fontSize(20).text("Orcamento Lightwall", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Projeto: ${data.projectName}`);
    if (data.clientName) {
      doc.text(`Cliente: ${data.clientName}`);
    }
    doc.text(`Data: ${data.date.toLocaleDateString("pt-BR")}`);
    doc.moveDown();

    doc
      .fontSize(10)
      .fillColor("red")
      .text(
        "ATENCAO: Este orcamento foi gerado automaticamente e deve ser validado por um profissional qualificado antes de ser utilizado.",
        { align: "center" },
      );
    doc.fillColor("black");
    doc.moveDown();

    doc.fontSize(14).text("Resumo de Quantitativos", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(
      `Area Total de Paredes: ${data.quantitatives.totals.totalWallArea.toFixed(2)} m2`,
    );
    doc.text(
      `Area Total de Lajes: ${data.quantitatives.totals.totalSlabArea.toFixed(2)} m2`,
    );
    doc.text(
      `Total de Paineis 2P: ${data.quantitatives.totals.totalPanels2P} un`,
    );
    doc
      .fontSize(12)
      .text(
        `TOTAL DE PAINEIS: ${data.quantitatives.totals.totalPanels} un`,
      );
    doc.moveDown();

    doc.fontSize(14).text("Paredes", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text("Paredes Externas:");
    doc.text(
      `  Area Liquida: ${data.quantitatives.walls.external.netArea.toFixed(2)} m2`,
    );
    doc.text(
      `  Paineis 2P: ${data.quantitatives.walls.external.panels2P} un`,
    );
    doc.moveDown(0.5);
    doc.text("Paredes Internas:");
    doc.text(
      `  Area Liquida: ${data.quantitatives.walls.internal.netArea.toFixed(2)} m2`,
    );
    doc.text(
      `  Paineis 2P: ${data.quantitatives.walls.internal.panels2P} un`,
    );
    doc.moveDown();

    doc.fontSize(14).text("Lajes", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(
      `Piso: ${data.quantitatives.slabs.floor.totalArea.toFixed(2)} m2 - ${data.quantitatives.slabs.floor.panels2P} paineis 2P`,
    );
    doc.text(
      `Cobertura: ${data.quantitatives.slabs.roof.totalArea.toFixed(2)} m2 - ${data.quantitatives.slabs.roof.panels2P} paineis 2P`,
    );
    doc.moveDown();

    doc
      .fontSize(14)
      .text("Materiais Complementares", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    for (const material of data.materials.complementaryMaterials) {
      doc.text(`${material.material}: ${material.quantity} ${material.unit}`);
    }
    doc.moveDown();

    if (data.alerts.length > 0) {
      doc.addPage();
      doc.fontSize(14).text("Alertas Tecnicos", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10);
      for (const alert of data.alerts) {
        const color =
          alert.level === "critical"
            ? "red"
            : alert.level === "warning"
              ? "orange"
              : "blue";
        doc
          .fillColor(color)
          .text(`[${alert.level.toUpperCase()}] ${alert.message}`);
        doc.fillColor("black");
      }
      doc.moveDown();
    }

    if (data.assumptions.length > 0) {
      doc.addPage();
      doc.fontSize(14).text("Premissas Aplicadas", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10);
      for (const assumption of data.assumptions) {
        doc.text(
          `${assumption.description}: ${assumption.value} ${assumption.unit}`,
        );
      }
    }

    doc.end();

    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}

export async function exportToJSON(
  data: BudgetExportData,
  outputPath: string,
): Promise<void> {
  const jsonData = {
    project: {
      name: data.projectName,
      client: data.clientName,
      date: data.date.toISOString(),
    },
    quantitatives: data.quantitatives,
    materials: data.materials,
    alerts: data.alerts,
    assumptions: data.assumptions,
  };

  await fsPromises.writeFile(
    outputPath,
    JSON.stringify(jsonData, null, 2),
    "utf-8",
  );
}
