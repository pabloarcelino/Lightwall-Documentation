import { AlertOctagon } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { PageResult } from "./types";

interface Props {
  pages: PageResult[];
}

export function VisionDirectNotes({ pages }: Props) {
  const withNotes = pages.filter((p) => p.observacoes);
  if (withNotes.length === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
        <AlertOctagon className="h-3.5 w-3.5 text-warning" />
        Observações da IA
      </h2>
      <ul className="text-xs space-y-1.5">
        {withNotes.map((p) => (
          <li key={p.pageIndex}>
            <strong className="font-mono text-[10px] mr-1">Pag {p.pageIndex} ({p.pavimento}):</strong>
            {p.observacoes}
          </li>
        ))}
      </ul>
    </Card>
  );
}
