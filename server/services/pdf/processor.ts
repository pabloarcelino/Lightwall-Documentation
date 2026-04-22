import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";

export interface ProcessedPage {
  pageNumber: number;
  imagePath: string;
  width: number;
  height: number;
}

export async function convertPdfToImages(
  pdfPath: string,
  outputDir: string,
): Promise<ProcessedPage[]> {
  try {
    await fs.mkdir(outputDir, { recursive: true });

    const pdfBytes = await fs.readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const pages: ProcessedPage[] = [];
    const pageCount = pdfDoc.getPageCount();

    console.log(`Processando ${pageCount} paginas do PDF...`);

    for (let i = 0; i < pageCount; i++) {
      const pageNumber = i + 1;

      const singlePagePdf = await PDFDocument.create();
      const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [i]);
      singlePagePdf.addPage(copiedPage);

      const tempPdfBytes = await singlePagePdf.save();
      const tempPdfPath = path.join(
        outputDir,
        `temp_page_${pageNumber}.pdf`,
      );
      await fs.writeFile(tempPdfPath, tempPdfBytes);

      const imagePath = path.join(outputDir, `page_${pageNumber}.png`);

      const page = copiedPage;
      const { width, height } = page.getSize();

      console.log(`Pagina ${pageNumber} preparada: ${width}x${height}`);

      pages.push({
        pageNumber,
        imagePath,
        width,
        height,
      });

      await fs.unlink(tempPdfPath).catch(() => {});
    }

    return pages;
  } catch (error) {
    console.error("Erro ao processar PDF:", error);
    throw error;
  }
}

export async function validatePdfFile(filePath: string): Promise<boolean> {
  try {
    const buffer = await fs.readFile(filePath);
    const pdfDoc = await PDFDocument.load(buffer);
    return pdfDoc.getPageCount() > 0;
  } catch {
    return false;
  }
}

export async function processImageFile(
  imagePath: string,
  outputPath: string,
): Promise<{ width: number; height: number }> {
  try {
    const image = sharp(imagePath);
    const metadata = await image.metadata();

    await image
      .png({ compressionLevel: 6 })
      .resize({
        width: Math.min(metadata.width || 2048, 2048),
        height: Math.min(metadata.height || 2048, 2048),
        fit: "inside",
        withoutEnlargement: true,
      })
      .toFile(outputPath);

    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
    };
  } catch (error) {
    console.error("Erro ao processar imagem:", error);
    throw error;
  }
}
