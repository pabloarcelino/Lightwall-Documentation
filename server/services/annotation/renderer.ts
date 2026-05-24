import sharp from "sharp";

/**
 * Renderer deterministico de plantas anotadas. Substitui a geracao anterior
 * por IA de pintura (`server/replit_integrations/image/client.ts → editImage`)
 * que produzia anotacoes inconsistentes (IDs duplicados, retangulos
 * envolvendo comodos, unidades misturadas, etc.).
 *
 * Recebe:
 *  - Imagem base (PNG/JPG ou PDF — PDFs sao rasterizados em alta DPI).
 *  - Lista de paredes e lajes com `bbox` normalizado 0-1000.
 *  - Labels ja atribuidos por assignDisplayLabels() (globalmente unicos).
 *
 * Produz: PNG anotado com retangulos coloridos por classe, labels textuais
 * e legenda no rodape. Custo zero (sem chamada IA), ~100-500ms por imagem.
 */

// ============================================================
// Tipos publicos
// ============================================================

export interface RenderableWall {
  id: string;
  displayLabel?: string;
  classe: "externa" | "interna" | "muro";
  comprimento_m?: number;
  altura_m?: number;
  bbox?: [number, number, number, number]; // ymin, xmin, ymax, xmax (0-1000)
}

export interface RenderableSlab {
  id: string;
  displayLabel?: string;
  classe: "piso" | "coberta" | "radier";
  area_m2?: number;
  bbox?: [number, number, number, number];
}

export interface RenderOptions {
  /** Largura maxima da imagem renderizada (px). Default 2048. */
  maxWidth?: number;
  /** Texto opcional do pavimento exibido no canto superior. */
  pavimentoLabel?: string;
  /** Mostrar legenda no rodape. Default true. */
  showLegend?: boolean;
}

export interface RenderResult {
  pngBuffer: Buffer;
  widthPx: number;
  heightPx: number;
  rendered: { walls: number; slabs: number };
}

// ============================================================
// Constantes visuais
// ============================================================

const COLORS = {
  externa: "#dc2626", // vermelho (--error)
  interna: "#16a34a", // verde (--success)
  muro:    "#1d4ed8", // azul
  piso:    "#10b981", // verde-agua
  coberta: "#f97316", // laranja
  radier:  "#a855f7", // roxo (raro)
} as const;

const CLASSE_PT: Record<string, string> = {
  externa: "Externa",
  interna: "Interna",
  muro:    "Muro",
  piso:    "Laje piso",
  coberta: "Laje coberta",
  radier:  "Laje radier",
};

const DEFAULT_OPTS: Required<RenderOptions> = {
  maxWidth: 2048,
  pavimentoLabel: "",
  showLegend: true,
};

// ============================================================
// Util: rasteriza buffer (PNG/JPG/PDF) em PNG raster
// ============================================================

async function ensureRaster(
  buffer: Buffer,
  mimeType: string,
  pageIndex: number,
  maxWidth: number,
): Promise<{ buf: Buffer; width: number; height: number }> {
  if (mimeType === "application/pdf") {
    // Rasteriza a pagina alvo do PDF em alta resolucao via pdf-to-png-converter.
    // Importado dinamicamente para que o servidor suba mesmo se a dep nao
    // estiver instalada (a anotacao falha graciosamente neste caso).
    // viewportScale ~3 produz ~216 DPI para folhas A3 — suficiente pra cotas pequenas.
    let pdfToPng: (typeof import("pdf-to-png-converter"))["pdfToPng"];
    try {
      ({ pdfToPng } = await import("pdf-to-png-converter"));
    } catch (e: any) {
      throw new Error(
        `pdf-to-png-converter nao instalado. Rode 'npm install' no servidor. (${e?.message || e})`,
      );
    }
    const pages = await pdfToPng(buffer, {
      viewportScale: 3,
      pagesToProcess: [pageIndex + 1], // pdf-to-png usa 1-based
      disableFontFace: false,
      useSystemFonts: false,
    });
    const first = pages[0];
    if (!first || !first.content) {
      throw new Error(`pdf-to-png: pagina ${pageIndex + 1} nao retornou conteudo`);
    }
    const pngContent: Buffer = first.content;
    // Re-resize para respeitar maxWidth se o raster passou disso
    const meta = await sharp(pngContent).metadata();
    const w = meta.width ?? 0;
    if (w > maxWidth) {
      const buf = await sharp(pngContent).resize({ width: maxWidth }).png().toBuffer();
      const m = await sharp(buf).metadata();
      return { buf, width: m.width ?? maxWidth, height: m.height ?? 0 };
    }
    return { buf: pngContent, width: w, height: meta.height ?? 0 };
  }

  // Imagem raster: garante PNG e respeita maxWidth.
  const img = sharp(buffer, { failOn: "none" });
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  if (w > maxWidth) {
    const buf = await img.resize({ width: maxWidth }).png().toBuffer();
    const m = await sharp(buf).metadata();
    return { buf, width: m.width ?? maxWidth, height: m.height ?? 0 };
  }
  const buf = await img.png().toBuffer();
  return { buf, width: w, height: meta.height ?? 0 };
}

// ============================================================
// SVG: utilidades
// ============================================================

function escXml(s: string): string {
  return String(s).replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&apos;",
  );
}

function fmt(n: number): string {
  return Number(n || 0).toFixed(2).replace(".", ",");
}

interface BoxPx {
  x: number;
  y: number;
  w: number;
  h: number;
}

function bboxToPx(
  bbox: [number, number, number, number],
  imgW: number,
  imgH: number,
): BoxPx {
  const [ymin, xmin, ymax, xmax] = bbox;
  const x = (xmin / 1000) * imgW;
  const y = (ymin / 1000) * imgH;
  const w = ((xmax - xmin) / 1000) * imgW;
  const h = ((ymax - ymin) / 1000) * imgH;
  return { x, y, w, h };
}

// ============================================================
// SVG overlay
// ============================================================

function buildSvgOverlay(
  walls: RenderableWall[],
  slabs: RenderableSlab[],
  width: number,
  height: number,
  opts: Required<RenderOptions>,
): string {
  // Espessura/fonte escalonadas pela largura
  const stroke = Math.max(3, Math.round(width / 600));
  const labelFs = Math.max(11, Math.round(width / 140));
  const labelPad = Math.max(3, Math.round(labelFs * 0.35));

  // Lajes PRIMEIRO (fill translúcido) — ficam atrás das paredes
  const slabShapes: string[] = [];
  const slabLabels: string[] = [];
  for (const s of slabs) {
    if (!s.bbox) continue;
    const { x, y, w, h } = bboxToPx(s.bbox, width, height);
    const color = COLORS[s.classe] ?? COLORS.piso;
    slabShapes.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-opacity="0.7" stroke-width="${Math.max(1, stroke - 1)}" stroke-dasharray="${stroke * 2},${stroke}"/>`,
    );
    slabLabels.push(renderLabel(s.displayLabel || s.id, `${fmt(s.area_m2 || 0)} m²`, x + w / 2, y + h / 2, color, labelFs, labelPad, "center"));
  }

  // Paredes (stroke colorido, sem fill)
  const wallShapes: string[] = [];
  const wallLabels: string[] = [];
  for (const w of walls) {
    if (!w.bbox) continue;
    const px = bboxToPx(w.bbox, width, height);
    const color = COLORS[w.classe] ?? COLORS.externa;
    wallShapes.push(
      `<rect x="${px.x.toFixed(1)}" y="${px.y.toFixed(1)}" width="${px.w.toFixed(1)}" height="${px.h.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round"/>`,
    );
    // Anchor label: acima da parede se for horizontal, ao lado se vertical
    const horizontal = px.w >= px.h;
    const anchorX = horizontal ? px.x + px.w / 2 : px.x + px.w + labelFs * 0.6;
    const anchorY = horizontal ? px.y - labelFs * 0.6 : px.y + px.h / 2;
    wallLabels.push(
      renderLabel(
        w.displayLabel || w.id,
        `${fmt(w.comprimento_m || 0)} m`,
        anchorX,
        anchorY,
        color,
        labelFs,
        labelPad,
        horizontal ? "center" : "start",
      ),
    );
  }

  // Pavimento no canto superior esquerdo
  const pavLabel = opts.pavimentoLabel
    ? `<g><rect x="20" y="20" rx="6" ry="6" width="${opts.pavimentoLabel.length * labelFs * 0.65 + 24}" height="${labelFs * 2}" fill="#ffffff" stroke="#111827" stroke-width="1.5"/>
        <text x="32" y="${20 + labelFs * 1.3}" font-family="Arial, sans-serif" font-size="${labelFs}" font-weight="700" fill="#111827">${escXml(opts.pavimentoLabel)}</text></g>`
    : "";

  // Legenda no rodapé (gerada por código, conta os elementos visíveis)
  const legend = opts.showLegend ? buildLegend(walls, slabs, width, height, labelFs) : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <g>${slabShapes.join("\n")}</g>
  <g>${wallShapes.join("\n")}</g>
  <g>${slabLabels.join("\n")}</g>
  <g>${wallLabels.join("\n")}</g>
  ${pavLabel}
  ${legend}
</svg>`;
}

function renderLabel(
  line1: string,
  line2: string,
  cx: number,
  cy: number,
  color: string,
  fontSize: number,
  pad: number,
  align: "center" | "start",
): string {
  const w = Math.max(line1.length, line2.length) * fontSize * 0.6 + pad * 2;
  const h = fontSize * 2.5 + pad * 2;
  const x = align === "center" ? cx - w / 2 : cx;
  const y = cy - h / 2;
  const textAnchor = align === "center" ? "middle" : "start";
  const tx = align === "center" ? cx : cx + pad;
  const ty1 = y + pad + fontSize * 1.0;
  const ty2 = ty1 + fontSize * 1.15;
  return `<g>
    <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" ry="4" fill="#ffffff" stroke="${color}" stroke-width="1.5"/>
    <text x="${tx.toFixed(1)}" y="${ty1.toFixed(1)}" text-anchor="${textAnchor}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#111827">${escXml(line1)}</text>
    <text x="${tx.toFixed(1)}" y="${ty2.toFixed(1)}" text-anchor="${textAnchor}" font-family="Arial, sans-serif" font-size="${Math.round(fontSize * 0.85)}" fill="#374151">${escXml(line2)}</text>
  </g>`;
}

function buildLegend(
  walls: RenderableWall[],
  slabs: RenderableSlab[],
  width: number,
  height: number,
  fontSize: number,
): string {
  const ext = walls.filter((w) => w.classe === "externa").length;
  const int = walls.filter((w) => w.classe === "interna").length;
  const muros = walls.filter((w) => w.classe === "muro").length;
  const piso = slabs.filter((s) => s.classe === "piso" || s.classe === "radier").length;
  const coberta = slabs.filter((s) => s.classe === "coberta").length;

  const items: Array<{ label: string; color: string; count: number }> = [];
  if (ext)     items.push({ label: "Externas",      color: COLORS.externa, count: ext });
  if (int)     items.push({ label: "Internas",      color: COLORS.interna, count: int });
  if (muros)   items.push({ label: "Muros",         color: COLORS.muro,    count: muros });
  if (piso)    items.push({ label: "Laje piso",     color: COLORS.piso,    count: piso });
  if (coberta) items.push({ label: "Laje coberta",  color: COLORS.coberta, count: coberta });

  if (items.length === 0) return "";

  const lh = Math.round(fontSize * 2.4);
  const padX = 20;
  const itemW = Math.floor((width - padX * 2) / items.length);
  const dotR = Math.round(fontSize * 0.45);
  const y = height - lh - 14;

  const itemSvgs = items
    .map((it, i) => {
      const x = padX + i * itemW;
      const cx = x + dotR + 6;
      const cy = y + lh / 2;
      const tx = cx + dotR + 10;
      const ty = cy + fontSize / 3;
      return `
        <circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${it.color}" stroke="#111827" stroke-width="1"/>
        <text x="${tx}" y="${ty.toFixed(1)}" font-family="Arial, sans-serif" font-size="${Math.round(fontSize * 0.95)}" fill="#111827">${escXml(it.label)}: <tspan font-weight="700">${it.count}</tspan></text>`;
    })
    .join("");

  return `<g>
    <rect x="${padX - 6}" y="${y}" width="${width - padX * 2 + 12}" height="${lh}" rx="6" ry="6" fill="#ffffff" stroke="#111827" stroke-width="1.5" fill-opacity="0.95"/>
    ${itemSvgs}
  </g>`;
}

// ============================================================
// API publica
// ============================================================

export async function renderAnnotatedImage(
  baseImageBuffer: Buffer,
  baseMimeType: string,
  pageIndex: number,
  walls: RenderableWall[],
  slabs: RenderableSlab[],
  opts: RenderOptions = {},
): Promise<RenderResult> {
  const optsRes = { ...DEFAULT_OPTS, ...opts };
  const t0 = Date.now();

  const raster = await ensureRaster(baseImageBuffer, baseMimeType, pageIndex, optsRes.maxWidth);

  const svg = buildSvgOverlay(walls, slabs, raster.width, raster.height, optsRes);

  const png = await sharp(raster.buf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png({ compressionLevel: 8 })
    .toBuffer();

  const elapsed = Date.now() - t0;
  const wallsRendered = walls.filter((w) => !!w.bbox).length;
  const slabsRendered = slabs.filter((s) => !!s.bbox).length;
  console.log(
    `[ANOTACAO] ${optsRes.pavimentoLabel || "pagina " + pageIndex} renderizada em ${elapsed}ms ` +
    `(${wallsRendered}/${walls.length} paredes, ${slabsRendered}/${slabs.length} lajes, ${raster.width}x${raster.height}px)`,
  );

  return {
    pngBuffer: png,
    widthPx: raster.width,
    heightPx: raster.height,
    rendered: { walls: wallsRendered, slabs: slabsRendered },
  };
}
