import { useEffect, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProcessingSync } from "./useProcessingSync";

interface FloorImage {
  pavimento: string;
  /** Pode ser data URL de PNG/JPG/WebP ou PDF (application/pdf). */
  image: string;
  /** Mime type explicito quando conhecido — ajuda na escolha do renderer. */
  mimeType?: string;
  isClientSideFallback?: boolean;
}

function isPdfDataUrl(src: string, mimeType?: string): boolean {
  if (mimeType?.includes("pdf")) return true;
  return src.startsWith("data:application/pdf");
}

interface Wall {
  id: string;
  displayLabel?: string;
  classe: "externa" | "interna" | "muro";
  nivel: string;
  bbox?: number[];
  endpoints?: { p1: [number, number]; p2: [number, number] };
  needs_review?: boolean;
  enabled?: boolean;
}

interface PlantaWorkspaceProps {
  floorImages: FloorImage[];
  walls: Wall[];
  sync: ProcessingSync;
  /** Toggles default abertos. */
  showLabels?: boolean;
  showEnvelope?: boolean;
}

const CLASSE_COLOR: Record<string, string> = {
  externa: "#dc2626",
  interna: "#16a34a",
  muro:    "#1d4ed8",
};

export function PlantaWorkspace({
  floorImages,
  walls,
  sync,
  showLabels = true,
  showEnvelope = false,
}: PlantaWorkspaceProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [labelsOn, setLabelsOn] = useState(showLabels);
  const [envelopeOn, setEnvelopeOn] = useState(showEnvelope);

  const activeFloor = floorImages.find(f => f.pavimento === sync.activePavimento) || floorImages[0];
  const activeIsPdf = activeFloor ? isPdfDataUrl(activeFloor.image, activeFloor.mimeType) : false;

  useEffect(() => {
    // Reset dims quando troca imagem.
    setDims(null);
    setPdfError(null);
  }, [activeFloor?.image]);

  // Rendererizacao de imagem normal (PNG/JPG/WebP) — observa o <img>.
  useEffect(() => {
    if (activeIsPdf) return;
    const el = imgRef.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setDims({ w: el.clientWidth, h: el.clientHeight });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeFloor?.image, activeIsPdf]);

  // Rendererizacao de PDF — usa pdfjs-dist pra desenhar a primeira pagina em canvas.
  useEffect(() => {
    if (!activeIsPdf || !activeFloor) return;
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);

    (async () => {
      try {
        const pdfjsLib: any = await import("pdfjs-dist");
        const workerModule: any = await import("pdfjs-dist/build/pdf.worker.mjs?url");
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;

        // Decodifica data URL pra Uint8Array.
        const b64 = activeFloor.image.split(",")[1] || activeFloor.image;
        const bin = atob(b64);
        const data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);

        const loadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(1);

        const canvas = canvasRef.current;
        if (!canvas) return;
        const containerWidth = canvas.parentElement?.clientWidth || 800;
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = Math.min(2.0, containerWidth / baseViewport.width);
        const viewport = page.getViewport({ scale: fitScale });
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = viewport.width * pixelRatio;
        canvas.height = viewport.height * pixelRatio;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
        if (!cancelled) {
          setDims({ w: viewport.width, h: viewport.height });
          setPdfLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setPdfError(err?.message || String(err));
          setPdfLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [activeFloor?.image, activeIsPdf]);

  if (floorImages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-muted/30">
        <p className="text-sm text-muted-foreground">Nenhuma planta anotada disponível</p>
      </div>
    );
  }

  const wallsForPav = walls.filter(w =>
    w.enabled !== false &&
    (sync.activePavimento === "all" || w.nivel === sync.activePavimento)
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-muted/10">
      {/* Tabs de pavimento + toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card">
        {floorImages.length > 1 && (
          <Tabs value={sync.activePavimento} onValueChange={sync.setActivePavimento}>
            <TabsList className="h-8">
              {floorImages.map(f => (
                <TabsTrigger key={f.pavimento} value={f.pavimento} className="text-xs px-3">
                  {f.pavimento === "all" ? "Geral" : f.pavimento}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <Button
            variant={labelsOn ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setLabelsOn(v => !v)}
            data-testid="toggle-labels"
          >
            Labels
          </Button>
          <Button
            variant={envelopeOn ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setEnvelopeOn(v => !v)}
            data-testid="toggle-envelope"
          >
            Envelope
          </Button>
        </div>
      </div>

      {/* Disclaimer fallback */}
      {activeFloor.isClientSideFallback && (
        <div className="px-3 py-1.5 bg-info-soft border-b border-info/30 text-info text-[11px]">
          ⓘ Renderização do servidor falhou — overlay client-side. Algumas labels podem estar deslocadas.
        </div>
      )}

      {/* Planta + overlay SVG */}
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-900">
        <div className="relative inline-block min-w-full">
          {activeIsPdf ? (
            <>
              {pdfLoading && (
                <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
                  Carregando PDF...
                </div>
              )}
              {pdfError && (
                <div className="flex items-center justify-center h-64 text-sm text-error">
                  Erro ao renderizar PDF: {pdfError}
                </div>
              )}
              <canvas
                ref={canvasRef}
                className={cn("block", pdfLoading && "hidden")}
                data-testid={`planta-canvas-${activeFloor.pavimento}`}
              />
            </>
          ) : (
            <img
              ref={imgRef}
              src={activeFloor.image}
              alt={`Planta ${activeFloor.pavimento}`}
              className="block w-full h-auto"
              onLoad={(e) => {
                setDims({ w: e.currentTarget.clientWidth, h: e.currentTarget.clientHeight });
              }}
              data-testid={`planta-img-${activeFloor.pavimento}`}
            />
          )}
          {dims && wallsForPav.length > 0 && (
            <svg
              className="absolute top-0 left-0 pointer-events-none"
              width={dims.w}
              height={dims.h}
              viewBox={`0 0 ${dims.w} ${dims.h}`}
              style={{ width: dims.w, height: dims.h }}
            >
              {wallsForPav.map(w => {
                let x = 0, y = 0, ww = 0, hh = 0;
                if (Array.isArray(w.bbox) && w.bbox.length === 4) {
                  const [ymin, xmin, ymax, xmax] = w.bbox;
                  x = (xmin / 1000) * dims.w;
                  y = (ymin / 1000) * dims.h;
                  ww = ((xmax - xmin) / 1000) * dims.w;
                  hh = ((ymax - ymin) / 1000) * dims.h;
                } else if (w.endpoints) {
                  const px1 = (w.endpoints.p1[0] / 1000) * dims.w;
                  const py1 = (w.endpoints.p1[1] / 1000) * dims.h;
                  const px2 = (w.endpoints.p2[0] / 1000) * dims.w;
                  const py2 = (w.endpoints.p2[1] / 1000) * dims.h;
                  x = Math.min(px1, px2);
                  y = Math.min(py1, py2);
                  ww = Math.abs(px2 - px1);
                  hh = Math.abs(py2 - py1);
                } else {
                  return null;
                }
                const color = CLASSE_COLOR[w.classe] || "#888";
                const isHovered = sync.hoveredId === w.id;
                const isSelected = sync.selectedId === w.id;
                const isOther = (sync.hoveredId || sync.selectedId) && !isHovered && !isSelected;
                const strokeWidth = isSelected ? 5 : isHovered ? 4 : 2.5;
                const opacity = isOther ? 0.25 : 1;
                return (
                  <g key={w.id} className="pointer-events-auto cursor-pointer" style={{ opacity }}>
                    {w.endpoints ? (
                      <line
                        x1={(w.endpoints.p1[0] / 1000) * dims.w}
                        y1={(w.endpoints.p1[1] / 1000) * dims.h}
                        x2={(w.endpoints.p2[0] / 1000) * dims.w}
                        y2={(w.endpoints.p2[1] / 1000) * dims.h}
                        stroke={color}
                        strokeWidth={strokeWidth + 2}
                        strokeLinecap="round"
                        onMouseEnter={() => sync.setHovered(w.id)}
                        onMouseLeave={() => sync.setHovered(null)}
                        onClick={() => sync.setSelected(w.id === sync.selectedId ? null : w.id)}
                      />
                    ) : (
                      <rect
                        x={x} y={y} width={ww} height={hh}
                        fill="none" stroke={color} strokeWidth={strokeWidth}
                        onMouseEnter={() => sync.setHovered(w.id)}
                        onMouseLeave={() => sync.setHovered(null)}
                        onClick={() => sync.setSelected(w.id === sync.selectedId ? null : w.id)}
                      />
                    )}
                    {labelsOn && (
                      <g pointerEvents="none">
                        <rect
                          x={x + ww / 2 - 18} y={y - 14}
                          width="36" height="14"
                          rx="3" ry="3"
                          fill="#ffffff" stroke={color} strokeWidth="1"
                          opacity={0.95}
                        />
                        <text
                          x={x + ww / 2} y={y - 4}
                          textAnchor="middle"
                          fontSize="9" fontFamily="ui-monospace, monospace" fontWeight="700"
                          fill="#111827"
                        >
                          {w.displayLabel || w.id}
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
    </div>
  );
}
