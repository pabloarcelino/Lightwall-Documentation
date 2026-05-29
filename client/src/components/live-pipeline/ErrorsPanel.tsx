import { AlertOctagon, AlertTriangle, AlertCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineErrorItem } from "./useProcessingEvents";

interface ErrorsPanelProps {
  errors: PipelineErrorItem[];
  /** Callback ao clicar "Ir pra essa etapa" — passa stage. */
  onGoToStage?: (stage: string) => void;
}

export function ErrorsPanel({ errors, onGoToStage }: ErrorsPanelProps) {
  if (errors.length === 0) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-sm text-success flex items-center gap-2" data-testid="errors-panel-empty">
        <AlertCircle className="h-4 w-4" />
        Nenhum erro ou aviso registrado.
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-error/30 bg-card overflow-hidden" data-testid="errors-panel">
      <header className="px-4 py-3 border-b border-border bg-error/5 flex items-center gap-2">
        <AlertOctagon className="h-4 w-4 text-error" />
        <h3 className="text-sm font-semibold text-foreground">
          {errors.length} {errors.length === 1 ? "evento" : "eventos"} requerem atencao
        </h3>
      </header>
      <ul className="divide-y divide-border max-h-[40vh] overflow-y-auto">
        {errors.map((err, i) => <ErrorRow key={i} err={err} onGoToStage={onGoToStage} />)}
      </ul>
    </section>
  );
}

function ErrorRow({ err, onGoToStage }: { err: PipelineErrorItem; onGoToStage?: (stage: string) => void }) {
  const severity = err.meta?.severity as string | undefined;
  const Icon =
    severity === "error" || !severity ? AlertOctagon :
    severity === "warning" ? AlertTriangle :
    AlertCircle;
  const tone =
    severity === "error" || !severity ? "text-error" :
    severity === "warning" ? "text-warning" :
    "text-muted-foreground";

  const time = new Date(err.when).toLocaleTimeString("pt-BR", { hour12: false });

  return (
    <li className="px-4 py-3 hover:bg-accent/30">
      <div className="flex items-start gap-3">
        <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", tone)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {err.kind}
            </span>
            {err.stage && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                etapa {err.stage}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">{time}</span>
          </div>
          <div className="mt-1 text-sm text-foreground break-words">{err.message}</div>
        </div>
        {err.stage && onGoToStage && (
          <button
            type="button"
            onClick={() => onGoToStage(err.stage!)}
            className="text-[11px] text-primary hover:underline shrink-0 mt-0.5 flex items-center gap-0.5"
            data-testid={`goto-stage-${err.stage}`}
          >
            Ir
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </li>
  );
}
