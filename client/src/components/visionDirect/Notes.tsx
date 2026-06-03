import { AlertOctagon, AlertTriangle, XOctagon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PageResult } from "./types";

export interface AuditNote {
  severity: "info" | "warning" | "error";
  message: string;
  pavimento?: string | null;
  pageIndex?: number | null;
  categoria?: string;
}

interface Props {
  pages: PageResult[];
  /** Notes lidos do elementType="audit_notes" (sanity-check). Inclui
   *  warning/error vindos do A3. Renderizados acima das observacoes. */
  auditNotes?: AuditNote[];
}

const CATEGORIA_LABEL: Record<string, string> = {
  paredes_externas: "Paredes externas",
  paredes_internas: "Paredes internas",
  muros: "Muros",
  laje_piso: "Laje piso",
  laje_coberta: "Laje coberta",
  aberturas: "Aberturas",
  geral: "Geral",
};

function severityStyle(s: AuditNote["severity"]) {
  if (s === "error") return { Icon: XOctagon, cls: "text-error", bg: "bg-error/5 border-error/30" };
  if (s === "warning") return { Icon: AlertTriangle, cls: "text-warning", bg: "bg-warning/5 border-warning/30" };
  return { Icon: AlertOctagon, cls: "text-muted-foreground", bg: "" };
}

export function VisionDirectNotes({ pages, auditNotes = [] }: Props) {
  const withNotes = pages.filter((p) => p.observacoes);
  const flagged = auditNotes.filter((n) => n.severity !== "info");
  if (withNotes.length === 0 && flagged.length === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
        <AlertOctagon className="h-3.5 w-3.5 text-warning" />
        Observações da IA
      </h2>

      {flagged.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {flagged.map((n, i) => {
            const { Icon, cls, bg } = severityStyle(n.severity);
            return (
              <li
                key={`flag-${i}`}
                className={cn("text-xs border rounded-md px-2 py-1.5 flex items-start gap-1.5", bg)}
                data-testid={`audit-note-${n.severity}`}
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", cls)} />
                <div className="flex-1 min-w-0">
                  {n.categoria && CATEGORIA_LABEL[n.categoria] && (
                    <strong className={cn("font-semibold mr-1", cls)}>
                      {CATEGORIA_LABEL[n.categoria]}:
                    </strong>
                  )}
                  {n.message}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {withNotes.length > 0 && (
        <ul className="text-xs space-y-1.5">
          {withNotes.map((p) => (
            <li key={p.pageIndex}>
              <strong className="font-mono text-[10px] mr-1">Pag {p.pageIndex} ({p.pavimento}):</strong>
              {p.observacoes}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
