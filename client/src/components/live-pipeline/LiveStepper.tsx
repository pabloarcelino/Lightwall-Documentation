import { CheckCircle2, AlertCircle, Loader2, Circle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProcessingState, StageState } from "./useProcessingEvents";

export interface StepperEntry {
  stage: string;
  label: string;
  /** Etapas que aceitam reprocesso granular (sem refazer pipeline inteira). */
  reprocessable?: boolean;
}

export const STAGE_CATALOG: StepperEntry[] = [
  { stage: "0.5", label: "Pre-flight", reprocessable: true },
  { stage: "1",   label: "Classificacao" },
  { stage: "1.5", label: "Caracterizacao", reprocessable: true },
  { stage: "2.5", label: "Vetor Nativo" },
  { stage: "3",   label: "Geometria" },
  { stage: "3.4", label: "CV" },
  { stage: "3.5", label: "Verificacao" },
  { stage: "3.7", label: "Topologia" },
  { stage: "4",   label: "Fusao" },
  { stage: "4.5", label: "Val. Geom." },
  { stage: "4.6", label: "Val. Global" },
  { stage: "5",   label: "Quantitativos" },
  { stage: "6",   label: "Catalogo" },
  { stage: "6.5", label: "Auto-Auditoria" },
  { stage: "7",   label: "Validacao" },
  { stage: "7.5", label: "Imagens", reprocessable: true },
  { stage: "8",   label: "Descricao", reprocessable: true },
];

interface LiveStepperProps {
  state: ProcessingState;
  /** Quando o usuario clica numa pilula. Default: scroll pra ancora #stage-{stage}. */
  onSelect?: (stage: string) => void;
  /** Quando o usuario pede reprocesso. Sem handler, o botao nao aparece. */
  onReprocess?: (stage: string) => void;
}

type PillStatus = "pending" | "started" | "completed" | "failed";

function pillStatus(stageState: StageState | undefined): PillStatus {
  if (!stageState) return "pending";
  if (stageState.phase === "started") return "started";
  if (stageState.phase === "completed") return "completed";
  if (stageState.phase === "failed") return "failed";
  return "pending";
}

function defaultSelect(stage: string) {
  const el = document.getElementById(`stage-${stage}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function LiveStepper({ state, onSelect, onReprocess }: LiveStepperProps) {
  return (
    <div
      className="w-full overflow-x-auto rounded-xl border border-card-border bg-card"
      data-testid="live-stepper"
    >
      <div className="flex items-stretch min-w-max px-3 py-3 gap-2">
        {STAGE_CATALOG.map((entry, idx) => {
          const s = state.stages.get(entry.stage);
          const status = pillStatus(s);
          const Icon = status === "started" ? Loader2 :
                       status === "completed" ? CheckCircle2 :
                       status === "failed" ? AlertCircle :
                       Circle;
          const ringTone =
            status === "started" ? "border-primary bg-primary/10 text-primary" :
            status === "completed" ? "border-success/40 bg-success/10 text-success" :
            status === "failed" ? "border-error/50 bg-error/10 text-error" :
            "border-border bg-muted/30 text-muted-foreground";
          return (
            <div key={entry.stage} className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => (onSelect ?? defaultSelect)(entry.stage)}
                className={cn(
                  "group relative flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 min-w-[8.5rem] text-left transition-all",
                  ringTone,
                  status === "started" && "shadow-[0_0_0_3px_rgba(24,156,217,0.15)]",
                )}
                data-testid={`stage-pill-${entry.stage}`}
                title={s?.detail || s?.errorMessage || entry.label}
              >
                <div className="flex items-center gap-1.5 w-full">
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      status === "started" && "animate-spin",
                    )}
                  />
                  <span className="text-[10px] font-mono tabular-nums uppercase tracking-wider opacity-80">
                    {entry.stage}
                  </span>
                  {entry.reprocessable && status !== "pending" && onReprocess && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onReprocess(entry.stage); }}
                      className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 hover:bg-accent"
                      title={`Reprocessar etapa ${entry.stage}`}
                      data-testid={`reprocess-${entry.stage}`}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <span className="text-xs font-semibold truncate w-full">{entry.label}</span>
                {s?.detail && (
                  <span className="text-[10px] text-current/70 truncate w-full">{s.detail}</span>
                )}
              </button>
              {idx < STAGE_CATALOG.length - 1 && (
                <div className={cn(
                  "h-px w-3 shrink-0",
                  status === "completed" ? "bg-success/40" : "bg-border",
                )} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
