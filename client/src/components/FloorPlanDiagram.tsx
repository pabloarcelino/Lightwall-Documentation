import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Map as MapIcon } from "lucide-react";

interface Wall {
  id: string;
  nivel: string;
  classe: "externa" | "interna" | "muro";
  comprimento_m: number;
  altura_m: number;
  enabled: boolean;
  esquadrias: Array<{ tipo: string; codigo: string; largura_m: number; altura_m: number }>;
}

interface Props {
  walls: Wall[];
  highlightedWallId: string | null;
  onHoverWall: (wallId: string | null) => void;
  onClickWall: (wallId: string) => void;
}

const EXT_COLORS = [
  "#0ea5e9", "#0284c7", "#0369a1", "#075985",
  "#06b6d4", "#0891b2", "#0e7490", "#155e75",
  "#14b8a6", "#0d9488", "#0f766e", "#115e59",
];

const INT_COLORS = [
  "#f97316", "#ea580c", "#c2410c", "#9a3412",
  "#eab308", "#ca8a04", "#a16207", "#854d0e",
  "#f59e0b", "#d97706", "#b45309", "#92400e",
];

const MURO_COLORS = [
  "#a855f7", "#9333ea", "#7e22ce", "#6b21a8",
  "#d946ef", "#c026d3", "#a21caf", "#86198f",
];

function assignColors(walls: Wall[]): Map<string, string> {
  const colorMap = new Map<string, string>();
  let extIdx = 0;
  let intIdx = 0;
  let muroIdx = 0;
  for (const wall of walls) {
    if (wall.classe === "externa") {
      colorMap.set(wall.id, EXT_COLORS[extIdx % EXT_COLORS.length]);
      extIdx++;
    } else if (wall.classe === "muro") {
      colorMap.set(wall.id, MURO_COLORS[muroIdx % MURO_COLORS.length]);
      muroIdx++;
    } else {
      colorMap.set(wall.id, INT_COLORS[intIdx % INT_COLORS.length]);
      intIdx++;
    }
  }
  return colorMap;
}

interface LayoutRect {
  wallId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  isExternal: boolean;
}

function generateLayout(walls: Wall[]): LayoutRect[] {
  const enabledWalls = walls.filter(w => w.enabled && w.classe !== "muro");
  const extWalls = enabledWalls.filter(w => w.classe === "externa");
  const intWalls = enabledWalls.filter(w => w.classe === "interna");

  if (extWalls.length === 0 && intWalls.length === 0) return [];

  const PADDING = 40;
  const WALL_THICKNESS = 8;
  const INT_WALL_THICKNESS = 5;
  const CANVAS = 500;
  const INNER = CANVAS - PADDING * 2;

  const rects: LayoutRect[] = [];

  if (extWalls.length === 0) {
    let y = PADDING + 20;
    const maxLen = Math.max(...intWalls.map(w => w.comprimento_m), 1);
    const sc = (INNER - 40) / maxLen;
    for (const wall of intWalls) {
      rects.push({
        wallId: wall.id, x: PADDING + 20, y,
        width: Math.max(wall.comprimento_m * sc, 20), height: INT_WALL_THICKNESS,
        label: wall.id, isExternal: false,
      });
      y += 28;
    }
    return rects;
  }

  const sorted = [...extWalls].sort((a, b) => b.comprimento_m - a.comprimento_m);
  const top: Wall[] = [];
  const right: Wall[] = [];
  const bottom: Wall[] = [];
  const left: Wall[] = [];
  const buckets = [top, right, bottom, left];

  for (const wall of sorted) {
    const lengths = buckets.map(b => b.reduce((s, w) => s + w.comprimento_m, 0));
    const minIdx = lengths.indexOf(Math.min(...lengths));
    buckets[minIdx].push(wall);
  }

  const hLen = Math.max(top.reduce((s, w) => s + w.comprimento_m, 0), bottom.reduce((s, w) => s + w.comprimento_m, 0), 1);
  const vLen = Math.max(right.reduce((s, w) => s + w.comprimento_m, 0), left.reduce((s, w) => s + w.comprimento_m, 0), hLen * 0.5);

  const scaleH = (INNER - WALL_THICKNESS * 2) / hLen;
  const scaleV = (INNER - WALL_THICKNESS * 2) / vLen;
  const scale = Math.min(scaleH, scaleV);

  const rectW = hLen * scale + WALL_THICKNESS * 2;
  const rectH = vLen * scale + WALL_THICKNESS * 2;
  const ox = PADDING + (INNER - rectW) / 2;
  const oy = PADDING + (INNER - rectH) / 2;

  let offset = ox;
  for (const wall of top) {
    const wLen = wall.comprimento_m * scale;
    rects.push({ wallId: wall.id, x: offset, y: oy, width: wLen, height: WALL_THICKNESS, label: wall.id, isExternal: true });
    offset += wLen;
  }

  let offsetY = oy;
  const rx = ox + rectW - WALL_THICKNESS;
  for (const wall of right) {
    const wLen = wall.comprimento_m * scale;
    rects.push({ wallId: wall.id, x: rx, y: offsetY, width: WALL_THICKNESS, height: wLen, label: wall.id, isExternal: true });
    offsetY += wLen;
  }

  offset = ox + rectW;
  const by = oy + rectH - WALL_THICKNESS;
  for (const wall of bottom) {
    const wLen = wall.comprimento_m * scale;
    offset -= wLen;
    rects.push({ wallId: wall.id, x: offset, y: by, width: wLen, height: WALL_THICKNESS, label: wall.id, isExternal: true });
  }

  offsetY = oy + rectH;
  for (const wall of left) {
    const wLen = wall.comprimento_m * scale;
    offsetY -= wLen;
    rects.push({ wallId: wall.id, x: ox, y: offsetY, width: WALL_THICKNESS, height: wLen, label: wall.id, isExternal: true });
  }

  if (intWalls.length > 0) {
    const innerW = rectW - WALL_THICKNESS * 2;
    const innerH = rectH - WALL_THICKNESS * 2;
    const sx = ox + WALL_THICKNESS;
    const sy = oy + WALL_THICKNESS;
    const intScale = Math.min(scale, innerW / (hLen || 1));

    const horizontalWalls = intWalls.filter((_, i) => i % 2 === 0);
    const verticalWalls = intWalls.filter((_, i) => i % 2 === 1);

    const hSpacing = innerH / (horizontalWalls.length + 1);
    horizontalWalls.forEach((wall, i) => {
      const wLen = Math.min(wall.comprimento_m * intScale, innerW * 0.85);
      const xOff = sx + (innerW - wLen) * ((i + 1) / (horizontalWalls.length + 1));
      rects.push({
        wallId: wall.id, x: xOff,
        y: sy + hSpacing * (i + 1) - INT_WALL_THICKNESS / 2,
        width: wLen, height: INT_WALL_THICKNESS,
        label: wall.id, isExternal: false,
      });
    });

    const vSpacing = innerW / (verticalWalls.length + 1);
    verticalWalls.forEach((wall, i) => {
      const wLen = Math.min(wall.comprimento_m * intScale, innerH * 0.85);
      const yOff = sy + (innerH - wLen) * ((i + 1) / (verticalWalls.length + 1));
      rects.push({
        wallId: wall.id,
        x: sx + vSpacing * (i + 1) - INT_WALL_THICKNESS / 2, y: yOff,
        width: INT_WALL_THICKNESS, height: wLen,
        label: wall.id, isExternal: false,
      });
    });
  }

  return rects;
}

export default function FloorPlanDiagram({ walls, highlightedWallId, onHoverWall, onClickWall }: Props) {
  const colorMap = useMemo(() => assignColors(walls), [walls]);
  const layout = useMemo(() => generateLayout(walls), [walls]);

  if (walls.length === 0) return null;

  const enabledWalls = walls.filter(w => w.enabled);
  const extWalls = enabledWalls.filter(w => w.classe === "externa");
  const intWalls = enabledWalls.filter(w => w.classe === "interna");
  const muroWalls = enabledWalls.filter(w => w.classe === "muro");

  const svgWidth = 500;
  const svgHeight = 500;

  const allX = layout.map(r => r.x + r.width);
  const allY = layout.map(r => r.y + r.height);
  const maxX = Math.max(...allX, svgWidth);
  const maxY = Math.max(...allY, svgHeight);
  const viewBox = `0 0 ${Math.max(maxX + 20, svgWidth)} ${Math.max(maxY + 20, svgHeight)}`;

  return (
    <Card data-testid="floor-plan-diagram">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MapIcon className="h-5 w-5" />
          Planta Esquematica
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 border rounded-lg bg-white dark:bg-slate-900 p-2 min-h-[300px]">
            <svg
              viewBox={viewBox}
              className="w-full h-auto"
              style={{ maxHeight: "450px" }}
              data-testid="svg-floor-plan"
            >
              <defs>
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" strokeWidth="0.5" opacity="0.5" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />

              {layout.map((rect) => {
                const isHighlighted = highlightedWallId === rect.wallId;
                const color = colorMap.get(rect.wallId) || "#94a3b8";
                const opacity = highlightedWallId && !isHighlighted ? 0.3 : 1;

                return (
                  <g
                    key={rect.wallId}
                    onMouseEnter={() => onHoverWall(rect.wallId)}
                    onMouseLeave={() => onHoverWall(null)}
                    onClick={() => onClickWall(rect.wallId)}
                    style={{ cursor: "pointer" }}
                    data-testid={`plan-wall-${rect.wallId}`}
                  >
                    <rect
                      x={rect.x}
                      y={rect.y}
                      width={rect.width}
                      height={rect.height}
                      fill={color}
                      stroke={isHighlighted ? "#000" : "rgba(0,0,0,0.2)"}
                      strokeWidth={isHighlighted ? 2.5 : 0.5}
                      opacity={opacity}
                      rx={1}
                    />
                    {isHighlighted && (
                      <rect
                        x={rect.x - 2}
                        y={rect.y - 2}
                        width={rect.width + 4}
                        height={rect.height + 4}
                        fill="none"
                        stroke="#000"
                        strokeWidth={1.5}
                        strokeDasharray="4 2"
                        rx={2}
                      />
                    )}
                    <text
                      x={rect.x + rect.width / 2}
                      y={rect.y + rect.height / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={rect.isExternal ? "10" : "8"}
                      fontWeight="bold"
                      fill="#fff"
                      style={{ pointerEvents: "none", textShadow: "0 0 3px rgba(0,0,0,0.8)" }}
                    >
                      {rect.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="lg:w-56 space-y-3" data-testid="plan-legend">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Externas ({extWalls.length})</p>
              <div className="space-y-1">
                {extWalls.map(wall => (
                  <div
                    key={wall.id}
                    className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                      highlightedWallId === wall.id ? "bg-slate-100 dark:bg-slate-800 ring-1 ring-primary" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                    onMouseEnter={() => onHoverWall(wall.id)}
                    onMouseLeave={() => onHoverWall(null)}
                    onClick={() => onClickWall(wall.id)}
                    data-testid={`legend-wall-${wall.id}`}
                  >
                    <span
                      className="w-3 h-3 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: colorMap.get(wall.id) }}
                    />
                    <span className="font-medium">{wall.id}</span>
                    <span className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-[10px] font-semibold leading-none">EXT</span>
                    <span className="text-muted-foreground ml-auto">{wall.comprimento_m}m</span>
                  </div>
                ))}
              </div>
            </div>

            {intWalls.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Internas ({intWalls.length})</p>
                <div className="space-y-1">
                  {intWalls.map(wall => (
                    <div
                      key={wall.id}
                      className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                        highlightedWallId === wall.id ? "bg-slate-100 dark:bg-slate-800 ring-1 ring-primary" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      }`}
                      onMouseEnter={() => onHoverWall(wall.id)}
                      onMouseLeave={() => onHoverWall(null)}
                      onClick={() => onClickWall(wall.id)}
                      data-testid={`legend-wall-${wall.id}`}
                    >
                      <span
                        className="w-3 h-3 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: colorMap.get(wall.id) }}
                      />
                      <span className="font-medium">{wall.id}</span>
                      <span className="px-1 py-0.5 rounded bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 text-[10px] font-semibold leading-none">INT</span>
                      <span className="text-muted-foreground ml-auto">{wall.comprimento_m}m</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {muroWalls.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Muros ({muroWalls.length})</p>
                <div className="space-y-1">
                  {muroWalls.map(wall => (
                    <div
                      key={wall.id}
                      className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                        highlightedWallId === wall.id ? "bg-slate-100 dark:bg-slate-800 ring-1 ring-primary" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      }`}
                      onMouseEnter={() => onHoverWall(wall.id)}
                      onMouseLeave={() => onHoverWall(null)}
                      onClick={() => onClickWall(wall.id)}
                      data-testid={`legend-wall-${wall.id}`}
                    >
                      <span
                        className="w-3 h-3 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: colorMap.get(wall.id) }}
                      />
                      <span className="font-medium">{wall.id}</span>
                      <span className="px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-[10px] font-semibold leading-none">MURO</span>
                      <span className="text-muted-foreground ml-auto">{wall.comprimento_m}m</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 italic">Muros nao aparecem no esquema (apenas no Editor).</p>
              </div>
            )}

            <div className="pt-2 border-t text-[10px] text-muted-foreground">
              <p>Diagrama esquematico proporcional.</p>
              <p>Clique numa parede para ir ao editor.</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
