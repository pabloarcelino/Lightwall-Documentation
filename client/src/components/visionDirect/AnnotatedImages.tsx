import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PageResult } from "./types";

interface Props {
  pages: PageResult[];
}

export function VisionDirectAnnotatedImages({ pages }: Props) {
  if (!pages.some((p) => p.annotatedImage || p.originalImage)) return null;

  return (
    <Card>
      <div className="p-3 border-b border-border flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Planta anotada (gerada pela IA)</h2>
        <Badge variant="outline" className="text-[10px] ml-auto">
          gemini-2.5-flash-image
        </Badge>
      </div>
      <div className="p-3 space-y-4">
        {pages.map((p) => (
          <div key={`img-${p.pageIndex}`} className="space-y-2">
            {pages.length > 1 && (
              <div className="text-xs font-mono text-muted-foreground">
                Página {p.pageIndex} — {p.pavimento}
              </div>
            )}
            {p.annotatedImage ? (
              <div className="rounded-lg border border-border overflow-hidden bg-black/40">
                <img
                  src={p.annotatedImage}
                  alt={`Planta anotada — pag ${p.pageIndex}`}
                  className="w-full h-auto max-h-[80vh] object-contain"
                  data-testid={`annotated-img-${p.pageIndex}`}
                />
              </div>
            ) : p.originalImage ? (
              <div className="rounded-lg border border-warning/30 overflow-hidden bg-black/40 relative">
                <img
                  src={p.originalImage}
                  alt={`Planta original — pag ${p.pageIndex}`}
                  className="w-full h-auto max-h-[80vh] object-contain"
                />
                <div className="absolute top-2 left-2 bg-warning/90 text-warning-foreground text-[10px] uppercase tracking-wider px-2 py-1 rounded">
                  Anotação IA falhou — mostrando original
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
