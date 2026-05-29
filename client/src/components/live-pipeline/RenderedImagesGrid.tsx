import { useState } from "react";
import { Image as ImageIcon, Loader2, AlertCircle, X, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RenderedImage } from "./useProcessingEvents";

interface RenderedImagesGridProps {
  images: RenderedImage[];
}

export function RenderedImagesGrid({ images }: RenderedImagesGridProps) {
  const [openImg, setOpenImg] = useState<RenderedImage | null>(null);

  if (images.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
        <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
        <div className="text-sm text-muted-foreground">As plantas anotadas aparecem aqui assim que sao geradas.</div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="rendered-images-grid">
        {images.map((img, i) => (
          <ImageCard key={`${img.pavimento}-${img.pageIndex}-${i}`} img={img} onOpen={() => img.imageUrl && setOpenImg(img)} />
        ))}
      </div>
      {openImg && <Lightbox img={openImg} onClose={() => setOpenImg(null)} />}
    </>
  );
}

function ImageCard({ img, onOpen }: { img: RenderedImage; onOpen: () => void }) {
  const isRendering = img.status === "rendering";
  const isFailed = img.status === "failed";
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!img.imageUrl}
      className={cn(
        "group relative aspect-[4/3] rounded-lg border overflow-hidden bg-muted text-left transition",
        isFailed ? "border-error/40" : "border-border hover:ring-2 hover:ring-primary",
      )}
      data-testid={`image-card-${img.pavimento}-${img.pageIndex}`}
    >
      {img.imageUrl ? (
        <img src={img.imageUrl} alt={img.pavimento} className="w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          {isRendering && <Loader2 className="h-6 w-6 animate-spin text-primary" />}
          {isFailed && <AlertCircle className="h-6 w-6 text-error" />}
          {!isRendering && !isFailed && <ImageIcon className="h-6 w-6 text-muted-foreground" />}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 to-transparent text-white">
        <div className="text-xs font-semibold truncate">{img.pavimento}</div>
        <div className="text-[10px] opacity-80">pagina {img.pageIndex + 1}{img.byteSize ? ` • ${(img.byteSize / 1024).toFixed(0)} KB` : ""}</div>
      </div>
      {isRendering && (
        <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded font-medium">
          renderizando…
        </div>
      )}
      {isFailed && (
        <div className="absolute top-2 right-2 bg-error text-white text-[10px] px-1.5 py-0.5 rounded font-medium" title={img.errorMessage}>
          erro
        </div>
      )}
    </button>
  );
}

function Lightbox({ img, onClose }: { img: RenderedImage; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
      onClick={onClose}
      data-testid="image-lightbox"
    >
      <div className="relative max-w-[95vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-10 right-0 text-white hover:text-primary transition"
          aria-label="Fechar"
        >
          <X className="h-6 w-6" />
        </button>
        {img.imageUrl && (
          <a
            href={img.imageUrl}
            download={`${img.pavimento}-pg${img.pageIndex + 1}.png`}
            className="absolute -top-10 right-10 text-white hover:text-primary transition"
            title="Baixar"
            onClick={e => e.stopPropagation()}
          >
            <Download className="h-6 w-6" />
          </a>
        )}
        <img src={img.imageUrl} alt={img.pavimento} className="max-w-full max-h-[90vh] object-contain rounded shadow-2xl" />
        <div className="mt-2 text-white text-sm">
          <span className="font-semibold">{img.pavimento}</span>
          <span className="opacity-70 ml-2">pagina {img.pageIndex + 1}</span>
        </div>
      </div>
    </div>
  );
}
