import { useMemo } from "react";
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  AlertTriangle,
  CircleDollarSign,
  Clock,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ProjectStatus = "completed" | "processing" | "error" | "draft";

interface ProcessingHeaderProps {
  status: ProjectStatus;
  /** Custo IA acumulado em USD. */
  costUsd?: number;
  /** Tempo de processamento total em ms. */
  elapsedMs?: number;
  /** Numero de paredes detectadas no projeto. */
  wallCount: number;
  /** Numero de lajes detectadas. */
  slabCount: number;
  /** Resumo das etapas (mostradas como stepper horizontal). */
  steps: Array<{ step: number; label: string; status: "done" | "running" | "error" | "pending" }>;
  /** True quando ha annotationErrors ou audit_notes severity=error. */
  hasFailures: boolean;
  /** Callback ao clicar num passo do stepper — abre drawer tecnico filtrado. */
  onStepClick?: (step: number) => void;
  /** Callback do botao "Mostrar detalhes" do drawer tecnico. */
  onToggleDrawer?: () => void;
  drawerOpen?: boolean;
}

function formatElapsed(ms?: number): string {
  if (!ms || ms <= 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function formatUsd(usd?: number): string {
  if (usd == null) return "—";
  if (usd < 0.01) return "< US$ 0.01";
  return `US$ ${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

export function ProcessingHeader({
  status,
  costUsd,
  elapsedMs,
  wallCount,
  slabCount,
  steps,
  hasFailures,
  onStepClick,
  onToggleDrawer,
  drawerOpen,
}: ProcessingHeaderProps) {
  const statusMeta = useMemo(() => {
    if (status === "processing") {
      return { label: "Processando", tone: "warning" as const, Icon: Loader2, spin: true };
    }
    if (status === "error") {
      return { label: "Falha", tone: "error" as const, Icon: AlertCircle, spin: false };
    }
    if (status === "completed" && hasFailures) {
      return { label: "Concluído com avisos", tone: "warning" as const, Icon: AlertTriangle, spin: false };
    }
    if (status === "completed") {
      return { label: "Processado", tone: "success" as const, Icon: CheckCircle2, spin: false };
    }
    return { label: "Rascunho", tone: "neutral" as const, Icon: Clock, spin: false };
  }, [status, hasFailures]);

  const toneClasses = {
    success: "bg-success-soft text-success border-success/30",
    warning: "bg-warning-soft text-warning border-warning/30",
    error:   "bg-error-soft text-error border-error/30",
    neutral: "bg-muted text-muted-foreground border-border",
  } as const;

  return (
    <div className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-border">
      <div className="px-4 py-3 flex flex-wrap items-center gap-3">
        {/* Status pill */}
        <div
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
            toneClasses[statusMeta.tone],
          )}
          data-testid="processing-status-pill"
        >
          <statusMeta.Icon className={cn("h-3.5 w-3.5", statusMeta.spin && "animate-spin")} />
          {statusMeta.label}
        </div>

        {/* KPIs */}
        <div className="flex items-center gap-3 ml-1">
          <KpiPill icon={CircleDollarSign} label="Custo IA" value={formatUsd(costUsd)} />
          <KpiPill icon={Clock} label="Tempo" value={formatElapsed(elapsedMs)} />
          <KpiPill icon={Layers} label="Paredes" value={`${wallCount}`} hint={`${slabCount} lajes`} />
        </div>

        <div className="flex-1" />

        {/* Stepper compacto + toggle drawer */}
        <Stepper steps={steps} onClick={onStepClick} />

        {onToggleDrawer && (
          <button
            onClick={onToggleDrawer}
            className={cn(
              "ml-2 text-xs px-2.5 py-1 rounded-md border transition-colors",
              drawerOpen
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:bg-accent",
            )}
            data-testid="toggle-technical-drawer"
          >
            {drawerOpen ? "Ocultar detalhes" : "Detalhes técnicos"}
          </button>
        )}
      </div>
    </div>
  );
}

function KpiPill({
  icon: Icon,
  label,
  value,
  hint,
}: { icon: typeof CircleDollarSign; label: string; value: string; hint?: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1 text-xs">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="leading-tight">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="font-semibold text-foreground">
          {value}
          {hint && <span className="ml-1 text-[10px] text-muted-foreground font-normal">({hint})</span>}
        </div>
      </div>
    </div>
  );
}

interface StepperProps {
  steps: ProcessingHeaderProps["steps"];
  onClick?: (step: number) => void;
}

function Stepper({ steps, onClick }: StepperProps) {
  if (steps.length === 0) return null;
  return (
    <div
      className="flex items-center gap-0.5 px-1 py-0.5 rounded-md bg-background border border-border max-w-full overflow-x-auto"
      role="list"
      aria-label="Etapas do processamento"
    >
      {steps.map(s => {
        const cls =
          s.status === "done"    ? "bg-success/20 text-success" :
          s.status === "running" ? "bg-warning/30 text-warning animate-pulse" :
          s.status === "error"   ? "bg-error/30 text-error" :
                                   "bg-muted text-muted-foreground";
        const Icon =
          s.status === "done"    ? CheckCircle2 :
          s.status === "running" ? Loader2 :
          s.status === "error"   ? AlertCircle :
                                   Clock;
        return (
          <button
            key={`${s.step}-${s.label}`}
            onClick={() => onClick?.(s.step)}
            className={cn(
              "inline-flex items-center justify-center h-6 min-w-6 px-1 rounded text-[10px] font-mono font-bold transition-colors hover:opacity-80 cursor-pointer",
              cls,
            )}
            title={`Etapa ${s.step} — ${s.label} (${s.status})`}
            data-testid={`stepper-${s.step}`}
            role="listitem"
          >
            <Icon className={cn("h-3 w-3 mr-0.5", s.status === "running" && "animate-spin")} />
            {s.step}
          </button>
        );
      })}
    </div>
  );
}
