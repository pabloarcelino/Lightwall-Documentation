import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PdfViewerProps {
  url: string;
  className?: string;
  compact?: boolean;
}

export default function PdfViewer({ url, className = "", compact = false }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        const workerModule = await import("pdfjs-dist/build/pdf.worker.mjs?url");
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;

        const loadingTask = pdfjsLib.getDocument({
          url,
          isEvalSupported: false,
        });
        const pdf = await loadingTask.promise;
        if (!cancelled) {
          setPdfDoc(pdf);
          setTotalPages(pdf.numPages);
          setCurrentPage(1);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError("Erro ao carregar PDF");
          console.error("PDF load error:", err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [url]);

  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDoc || !canvasRef.current || !containerRef.current) return;

    try {
      const page = await pdfDoc.getPage(pageNum);
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const baseViewport = page.getViewport({ scale: 1 });
      const containerWidth = container.clientWidth || 400;
      const containerHeight = container.clientHeight || 600;

      let fitScale: number;
      if (compact) {
        fitScale = containerWidth / baseViewport.width;
      } else {
        const scaleX = containerWidth / baseViewport.width;
        const scaleY = containerHeight / baseViewport.height;
        fitScale = Math.min(scaleX, scaleY);
      }

      const finalScale = fitScale * scale;
      const viewport = page.getViewport({ scale: finalScale });

      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = viewport.width * pixelRatio;
      canvas.height = viewport.height * pixelRatio;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise;
    } catch (err) {
      console.error("PDF render error:", err);
    }
  }, [pdfDoc, scale, compact]);

  useEffect(() => {
    if (pdfDoc) {
      renderPage(currentPage);
    }
  }, [pdfDoc, currentPage, renderPage]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (compact) {
    return (
      <div ref={containerRef} className={`overflow-hidden ${className}`}>
        <canvas ref={canvasRef} className="w-full" />
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex items-center justify-center gap-2 py-2 px-4 bg-slate-100 dark:bg-slate-800 border-b shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          disabled={currentPage <= 1}
          data-testid="button-pdf-prev-page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm" data-testid="text-pdf-page-info">
          {currentPage} / {totalPages}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
          disabled={currentPage >= totalPages}
          data-testid="button-pdf-next-page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="w-px h-5 bg-slate-300 dark:bg-slate-600 mx-1" />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setScale(s => Math.max(0.25, s - 0.25))}
          disabled={scale <= 0.25}
          data-testid="button-pdf-zoom-out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-xs w-12 text-center" data-testid="text-pdf-zoom">
          {Math.round(scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setScale(s => Math.min(4, s + 0.25))}
          disabled={scale >= 4}
          data-testid="button-pdf-zoom-in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
      </div>
      <div ref={containerRef} className="flex-1 overflow-auto flex items-start justify-center p-4 bg-slate-200 dark:bg-slate-950">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
