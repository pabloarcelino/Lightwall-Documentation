import sharp from "sharp";

export interface AnnotatedTile {
  pavimento: string;
  pageIndex: number;
  /** data URL: "data:image/png;base64,..." OR raw base64 */
  image: string;
  summary?: {
    externas?: number;
    internas?: number;
    muros?: number;
    lajePiso?: number;
    lajeCoberta?: number;
  };
}

export interface ConsolidatedOptions {
  /** Maximum width per tile after scaling. Defaults to 1200. */
  tileMaxWidth?: number;
  /** Number of columns in the grid. Defaults to 2. */
  columns?: number;
  /** Title bar height in px. Defaults to 56. */
  titleHeight?: number;
  /** Legend strip height in px. Defaults to 80. */
  legendHeight?: number;
}

const DEFAULT_OPTS: Required<ConsolidatedOptions> = {
  tileMaxWidth: 1200,
  columns: 2,
  titleHeight: 56,
  legendHeight: 80,
};

function dataUrlToBuffer(dataUrlOrBase64: string): Buffer {
  const idx = dataUrlOrBase64.indexOf("base64,");
  const b64 = idx >= 0 ? dataUrlOrBase64.slice(idx + "base64,".length) : dataUrlOrBase64;
  return Buffer.from(b64, "base64");
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&apos;",
  );
}

/** Renders an SVG title bar (white bg, black border, dark text) as a PNG buffer of given size. */
async function renderTitleBar(text: string, width: number, height: number): Promise<Buffer> {
  const fontSize = Math.round(height * 0.45);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#ffffff" stroke="#111827" stroke-width="2"/>
    <text x="${width / 2}" y="${height / 2 + fontSize / 3}" text-anchor="middle"
          font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#111827">
      ${escapeXml(text)}
    </text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Renders the legend strip used at the bottom of the consolidated image. */
async function renderLegend(width: number, height: number): Promise<Buffer> {
  const dotR = Math.round(height * 0.18);
  const fontSize = Math.round(height * 0.32);
  const items = [
    { label: "Vermelho = paredes externas", color: "#dc2626" },
    { label: "Verde = paredes internas", color: "#16a34a" },
    { label: "Azul = muros", color: "#1d4ed8" },
  ];
  const itemWidth = Math.floor(width / items.length);
  const itemSvgs = items
    .map((it, i) => {
      const cx = i * itemWidth + 30 + dotR;
      const cy = height / 2;
      const tx = cx + dotR + 14;
      return `
        <circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${it.color}" stroke="#111827" stroke-width="1"/>
        <text x="${tx}" y="${cy + fontSize / 3}" font-family="Arial, sans-serif"
              font-size="${fontSize}" fill="#111827">${escapeXml(it.label)}</text>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#ffffff" stroke="#111827" stroke-width="2"/>
    ${itemSvgs}
    <text x="${width - 12}" y="${height - 8}" text-anchor="end"
          font-family="Arial, sans-serif" font-size="${Math.round(fontSize * 0.72)}" fill="#6b7280">
      Comprimentos aproximados com base nas cotas do projeto PDF.
    </text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Composes per-pavimento annotated images into a single consolidated PNG
 * (multi-column grid with title bar per tile + legend strip at the bottom),
 * mirroring the layout of a takeoff prancha.
 *
 * Returns a base64-encoded PNG (no data: prefix).
 */
export async function buildConsolidatedAnnotation(
  tiles: AnnotatedTile[],
  opts: ConsolidatedOptions = {},
): Promise<string> {
  if (tiles.length === 0) throw new Error("Sem imagens para consolidar");
  const { tileMaxWidth, columns, titleHeight, legendHeight } = { ...DEFAULT_OPTS, ...opts };

  // Resize each tile to the target width, keep aspect ratio.
  const resized = await Promise.all(
    tiles.map(async (t) => {
      const buf = dataUrlToBuffer(t.image);
      const meta = await sharp(buf).metadata();
      const srcW = meta.width || tileMaxWidth;
      const srcH = meta.height || tileMaxWidth;
      const scale = Math.min(1, tileMaxWidth / srcW);
      const w = Math.max(1, Math.round(srcW * scale));
      const h = Math.max(1, Math.round(srcH * scale));
      const png = await sharp(buf).resize(w, h, { fit: "inside" }).png().toBuffer();
      return { png, w, h, pavimento: t.pavimento, summary: t.summary };
    }),
  );

  const cols = Math.min(columns, resized.length);
  const rows = Math.ceil(resized.length / cols);

  // Each row's height = max tile height in that row + title bar.
  const rowHeights: number[] = [];
  const colWidths: number[] = Array(cols).fill(0);
  for (let r = 0; r < rows; r++) {
    let maxH = 0;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx >= resized.length) continue;
      maxH = Math.max(maxH, resized[idx].h);
      colWidths[c] = Math.max(colWidths[c], resized[idx].w);
    }
    rowHeights.push(maxH + titleHeight);
  }

  const padding = 16;
  const totalW = colWidths.reduce((s, w) => s + w, 0) + padding * (cols + 1);
  const totalH = rowHeights.reduce((s, h) => s + h, 0) + padding * (rows + 1) + legendHeight + padding;

  // Build composite list.
  const composites: sharp.OverlayOptions[] = [];
  let y = padding;
  for (let r = 0; r < rows; r++) {
    let x = padding;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx >= resized.length) {
        x += colWidths[c] + padding;
        continue;
      }
      const tile = resized[idx];
      const sum = tile.summary || {};
      const subtitle = [
        (sum.externas || 0) > 0 ? `${sum.externas} ext` : null,
        (sum.internas || 0) > 0 ? `${sum.internas} int` : null,
        (sum.muros || 0) > 0 ? `${sum.muros} muros` : null,
      ].filter(Boolean).join(" · ");
      const titleText = subtitle ? `${tile.pavimento}  —  ${subtitle}` : tile.pavimento;
      const titleBuf = await renderTitleBar(titleText, colWidths[c], titleHeight);
      composites.push({ input: titleBuf, top: y, left: x });
      composites.push({ input: tile.png, top: y + titleHeight, left: x });
      x += colWidths[c] + padding;
    }
    y += rowHeights[r] + padding;
  }

  const legendBuf = await renderLegend(totalW - padding * 2, legendHeight);
  composites.push({ input: legendBuf, top: y, left: padding });

  const final = await sharp({
    create: {
      width: totalW,
      height: totalH,
      channels: 3,
      background: { r: 245, g: 245, b: 245 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 8 })
    .toBuffer();

  return final.toString("base64");
}
