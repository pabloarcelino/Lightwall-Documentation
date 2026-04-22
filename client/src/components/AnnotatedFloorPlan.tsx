import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff, Sparkles, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Wall {
  id: string;
  classe: "externa" | "interna" | "muro";
  comprimento_m: number;
  altura_m?: number;
  enabled?: boolean;
  bbox?: [number, number, number, number];
  page_index?: number;
}

interface ProjectFile {
  id: string;
  originalName?: string;
  fileType?: string;
}

interface Props {
  projectId: number;
  walls: Wall[];
  files: ProjectFile[];
  highlightedWallId: string | null;
  onHoverWall: (wallId: string | null) => void;
  onClickWall: (wallId: string) => void;
  preGeneratedImage?: string;
  preGeneratedSummary?: any;
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

interface PageRendererProps {
  file: ProjectFile;
  pageIndex: number;
  walls: Wall[];
  colorMap: Map<string, string>;
  highlightedWallId: string | null;
  onHoverWall: (id: string | null) => void;
  onClickWall: (id: string) => void;
  showLabels: boolean;
}

function PageRenderer({ file, pageIndex, walls, colorMap, highlightedWallId, onHoverWall, onClickWall, showLabels }: PageRendererProps) {
  const isPdf = file.fileType === "pdf" || /\.pdf$/i.test(file.originalName || "");
  const fileUrl = `/api/files/${file.id}/content`;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        const workerModule = await import("pdfjs-dist/build/pdf.worker.mjs?url");
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;
        const loadingTask = pdfjsLib.getDocument({ url: fileUrl, isEvalSupported: false });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(Math.min(pageIndex + 1, pdf.numPages));
        const containerW = containerRef.current?.clientWidth || 800;
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = Math.min(2.0, containerW / baseViewport.width);
        const viewport = page.getViewport({ scale: fitScale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = viewport.width * pixelRatio;
        canvas.height = viewport.height * pixelRatio;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
        if (!cancelled) {
          setDims({ w: viewport.width, h: viewport.height });
          setLoading(false);
        }
      } catch (err: any) {
        console.error("PDF render error:", err);
        if (!cancelled) {
          setError("Erro ao carregar PDF");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [fileUrl, pageIndex, isPdf]);

  return (
    <div ref={containerRef} className="relative w-full overflow-auto bg-slate-50 dark:bg-slate-900 rounded-md border border-slate-200 dark:border-slate-700">
      {loading && isPdf && (
        <div className="flex items-center justify-center h-64 text-sm text-slate-500">Carregando...</div>
      )}
      {error && (
        <div className="flex items-center justify-center h-64 text-sm text-red-500">{error}</div>
      )}
      <div className="relative inline-block">
        {isPdf ? (
          <canvas ref={canvasRef} data-testid={`canvas-annotated-page-${pageIndex}`} />
        ) : (
          <img
            src={fileUrl}
            alt="Planta"
            className="block max-w-full h-auto"
            data-testid={`img-annotated-page-${pageIndex}`}
            onLoad={(e) => {
              const img = e.currentTarget;
              setDims({ w: img.clientWidth, h: img.clientHeight });
              setLoading(false);
            }}
            onError={() => { setError("Erro ao carregar imagem"); setLoading(false); }}
          />
        )}
        {dims && (
          <svg
            className="absolute top-0 left-0 pointer-events-none"
            width={dims.w}
            height={dims.h}
            viewBox={`0 0 ${dims.w} ${dims.h}`}
            style={{ width: dims.w, height: dims.h }}
          >
            {walls.filter(w => w.bbox).map((w) => {
              const [ymin, xmin, ymax, xmax] = w.bbox!;
              const x = (xmin / 1000) * dims.w;
              const y = (ymin / 1000) * dims.h;
              const width = ((xmax - xmin) / 1000) * dims.w;
              const height = ((ymax - ymin) / 1000) * dims.h;
              const color = colorMap.get(w.id) || "#3b82f6";
              const isHighlighted = highlightedWallId === w.id;
              const isDimmed = highlightedWallId && highlightedWallId !== w.id;
              const enabled = w.enabled !== false;
              const opacity = isDimmed ? 0.18 : (enabled ? 1 : 0.4);
              return (
                <g
                  key={w.id}
                  className="pointer-events-auto cursor-pointer"
                  onMouseEnter={() => onHoverWall(w.id)}
                  onMouseLeave={() => onHoverWall(null)}
                  onClick={() => onClickWall(w.id)}
                  data-testid={`overlay-wall-${w.id}`}
                  style={{ opacity }}
                >
                  <rect
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill={color}
                    fillOpacity={isHighlighted ? 0.55 : 0.32}
                    stroke={color}
                    strokeWidth={isHighlighted ? 3 : 2}
                  />
                  {showLabels && (
                    <g>
                      <rect
                        x={x + width / 2 - 14}
                        y={y + height / 2 - 9}
                        width={28}
                        height={18}
                        rx={3}
                        fill={color}
                      />
                      <text
                        x={x + width / 2}
                        y={y + height / 2 + 4}
                        textAnchor="middle"
                        fill="white"
                        fontSize={11}
                        fontWeight={700}
                        style={{ userSelect: "none" }}
                      >
                        {w.id}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

export default function AnnotatedFloorPlan({ projectId, walls, files, highlightedWallId, onHoverWall, onClickWall, preGeneratedImage, preGeneratedSummary }: Props) {
  const [showLabels, setShowLabels] = useState(true);
  const { toast } = useToast();
  const [aiImage, setAiImage] = useState<string | null>(preGeneratedImage || null);
  const [aiSummary, setAiSummary] = useState<any>(preGeneratedSummary || null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (preGeneratedImage) {
      setAiImage(preGeneratedImage);
      setAiSummary(preGeneratedSummary || null);
    }
  }, [preGeneratedImage, preGeneratedSummary]);

  const generateAiImage = async () => {
    setAiLoading(true);
    setAiImage(null);
    setAiSummary(null);
    try {
      const res = await apiRequest("POST", `/api/projects/${projectId}/annotated-image`, {});
      const json = await res.json();
      setAiImage(json.image);
      setAiSummary(json.summary || null);
      toast({ title: "Imagem anotada gerada", description: "A IA pintou os elementos identificados." });
    } catch (e: any) {
      toast({ title: "Falha ao gerar imagem", description: e?.message || "Erro desconhecido", variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  const colorMap = useMemo(() => assignColors(walls), [walls]);

  const wallsWithBbox = useMemo(() => walls.filter(w => Array.isArray(w.bbox) && w.bbox.length === 4), [walls]);

  const pageGroups = useMemo(() => {
    const groups = new Map<number, Wall[]>();
    for (const w of wallsWithBbox) {
      const pi = w.page_index ?? 0;
      if (!groups.has(pi)) groups.set(pi, []);
      groups.get(pi)!.push(w);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [wallsWithBbox]);

  const targetFile = useMemo(() => {
    if (!files || files.length === 0) return null;
    return files.find(f => {
      const isPdf = f.fileType === "pdf" || /\.pdf$/i.test(f.originalName || "");
      const isImage = f.fileType === "image" || /\.(png|jpe?g|webp)$/i.test(f.originalName || "");
      return isPdf || isImage;
    }) || files[0];
  }, [files]);

  if (!targetFile) return null;
  if (wallsWithBbox.length === 0) {
    return (
      <Card data-testid="card-annotated-floorplan-empty">
        <CardHeader>
          <CardTitle className="text-base">Planta Anotada</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">
            A IA ainda nao retornou as coordenadas das paredes para esta extracao. Reanalise o projeto para visualizar paredes coloridas sobrepostas na planta original.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-annotated-floorplan">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">Planta com Paredes Sobrepostas</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLabels(s => !s)}
              data-testid="button-toggle-wall-labels"
            >
              {showLabels ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
              {showLabels ? "Ocultar IDs" : "Mostrar IDs"}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={generateAiImage}
              disabled={aiLoading}
              data-testid="button-generate-ai-annotated"
            >
              {aiLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              {aiLoading ? "Gerando..." : (preGeneratedImage ? "Regenerar imagem (IA)" : "Gerar imagem anotada (IA)")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {(aiLoading || aiImage) && (
          <div className="rounded-md border border-cyan-300 dark:border-cyan-800 bg-slate-50 dark:bg-slate-900 p-3" data-testid="container-ai-annotated">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-cyan-700 dark:text-cyan-300 flex items-center gap-1">
                <Sparkles className="h-4 w-4" /> Planta anotada pela IA
              </p>
              {aiImage && (
                <a
                  href={aiImage}
                  download={`planta-anotada-${projectId}.png`}
                  className="inline-flex items-center text-xs text-cyan-700 dark:text-cyan-300 hover:underline"
                  data-testid="link-download-ai-annotated"
                >
                  <Download className="h-3 w-3 mr-1" /> Baixar
                </a>
              )}
            </div>
            {aiLoading ? (
              <div className="flex items-center justify-center h-48 text-sm text-slate-500">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" /> A IA esta gerando a imagem anotada (~10-30s)...
              </div>
            ) : aiImage ? (
              <div className="space-y-3">
                <img
                  src={aiImage}
                  alt="Planta anotada pela IA"
                  className="block w-full h-auto rounded"
                  data-testid="img-ai-annotated"
                />
                {aiSummary && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-xs" data-testid="grid-ai-summary">
                    {([
                      { key: "ext", label: "Externas", color: "#06b6d4", count: aiSummary.externas, metric: `${Number(aiSummary.comprimento_externas_m || 0).toFixed(1)}m`, paineis: aiSummary.paineis?.externas },
                      { key: "int", label: "Internas", color: "#f97316", count: aiSummary.internas, metric: `${Number(aiSummary.comprimento_internas_m || 0).toFixed(1)}m`, paineis: aiSummary.paineis?.internas },
                      { key: "muros", label: "Muros", color: "#a855f7", count: aiSummary.muros, metric: `${Number(aiSummary.comprimento_muros_m || 0).toFixed(1)}m`, paineis: aiSummary.paineis?.muros },
                      { key: "piso", label: "Laje Piso", color: "#10b981", count: aiSummary.lajePiso, metric: `${Number(aiSummary.area_piso_m2 || 0).toFixed(1)}m²`, paineis: aiSummary.paineis?.lajePiso },
                      { key: "coberta", label: "Laje Coberta", color: "#ef4444", count: aiSummary.lajeCoberta, metric: `${Number(aiSummary.area_coberta_m2 || 0).toFixed(1)}m²`, paineis: aiSummary.paineis?.lajeCoberta },
                    ]).map(it => (
                      <div key={it.key} className="rounded border border-slate-200 dark:border-slate-700 p-2 bg-white dark:bg-slate-950" data-testid={`summary-${it.key}`}>
                        <div className="flex items-center gap-1 mb-1">
                          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: it.color }} />
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{it.label}</span>
                        </div>
                        <div className="text-slate-600 dark:text-slate-400">{it.count} item(s) — {it.metric}</div>
                        {typeof it.paineis === "number" && (
                          <div className="text-slate-500 mt-0.5">{it.paineis} paineis</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
        {pageGroups.map(([pi, pageWalls]) => (
          <div key={pi}>
            {pageGroups.length > 1 && (
              <p className="text-xs text-slate-500 mb-2" data-testid={`text-page-label-${pi}`}>
                Pagina {pi + 1} - {pageWalls.length} parede(s)
              </p>
            )}
            <PageRenderer
              file={targetFile}
              pageIndex={pi}
              walls={pageWalls}
              colorMap={colorMap}
              highlightedWallId={highlightedWallId}
              onHoverWall={onHoverWall}
              onClickWall={onClickWall}
              showLabels={showLabels}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
