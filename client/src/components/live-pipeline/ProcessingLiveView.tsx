import { useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { CircleDollarSign, Cpu, Clock } from "lucide-react";
import { useProcessingEvents } from "./useProcessingEvents";
import { LiveStepper } from "./LiveStepper";
import { EventTimeline } from "./EventTimeline";
import { RenderedImagesGrid } from "./RenderedImagesGrid";
import { ErrorsPanel } from "./ErrorsPanel";
import { formatUsd, formatTokens, formatDuration } from "./AiCallCard";

interface ProcessingLiveViewProps {
  projectId: number | string;
  /** Quando true, abre SSE pra eventos novos. False = apenas historico. */
  isActive?: boolean;
  /** Callback ao usuario pedir reprocesso por etapa. */
  onReprocess?: (stage: string) => void;
}

export function ProcessingLiveView({ projectId, isActive = true, onReprocess }: ProcessingLiveViewProps) {
  const { toast } = useToast();

  const handleSseExhausted = useCallback(() => {
    // chamado quando o stream desistir apos N retries — o caller (ProjectDetails)
    // pode preferir mostrar toast. Aqui delegamos pro toast local.
    toast({
      title: "Conexao com o servidor perdida",
      description: "O processamento pode continuar no servidor. Tente reconectar.",
      variant: "destructive",
      duration: 1000 * 60 * 30,
      action: (
        <ToastAction altText="Reconectar agora" onClick={() => reconnect()}>
          Reconectar agora
        </ToastAction>
      ),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const { state, connected, exhausted: _exhausted, reconnect } = useProcessingEvents({
    projectId,
    enabled: true,
    onSseExhausted: handleSseExhausted,
  });

  const elapsed = useMemo(() => {
    if (!state.startedAt) return 0;
    const end = state.finishedAt ?? Date.now();
    return end - state.startedAt;
  }, [state.startedAt, state.finishedAt]);

  const handleGoToStage = useCallback((stage: string) => {
    const el = document.getElementById(`stage-${stage}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      if (el.tagName.toLowerCase() === "details") (el as HTMLDetailsElement).open = true;
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Header de metricas ao vivo */}
      <header className="rounded-xl border border-card-border bg-card px-4 py-3 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-success animate-pulse" : "bg-muted-foreground"}`} />
          <span className="text-xs font-medium uppercase tracking-wider">
            {isActive ? (connected ? "Ao vivo" : "Reconectando") : "Historico"}
          </span>
        </div>
        <div className="h-6 w-px bg-border" />
        <Metric icon={<Clock className="h-3.5 w-3.5" />} label="Tempo" value={state.startedAt ? formatDuration(elapsed) : "—"} />
        <Metric icon={<Cpu className="h-3.5 w-3.5" />} label="Tokens" value={formatTokens(state.totalTokens)} />
        <Metric icon={<CircleDollarSign className="h-3.5 w-3.5 text-success" />} label="Custo" value={formatUsd(state.totalCostUsd)} highlight />
        <div className="ml-auto text-[11px] text-muted-foreground">
          {state.aiCalls.length} chamada{state.aiCalls.length !== 1 ? "s" : ""} • {state.renderedImages.filter(i => i.status === "ready").length}/{state.renderedImages.length} imagens
        </div>
      </header>

      {/* Stepper horizontal ao vivo */}
      <LiveStepper state={state} onReprocess={onReprocess} />

      {/* Erros, se houver */}
      {state.errors.length > 0 && (
        <ErrorsPanel errors={state.errors} onGoToStage={handleGoToStage} />
      )}

      {/* Imagens renderizadas */}
      <section>
        <h3 className="text-sm font-semibold mb-2 px-1">Plantas anotadas geradas</h3>
        <RenderedImagesGrid images={state.renderedImages} />
      </section>

      {/* Timeline detalhada de eventos */}
      <section>
        <h3 className="text-sm font-semibold mb-2 px-1">Linha do tempo</h3>
        <EventTimeline state={state} />
      </section>
    </div>
  );
}

function Metric({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${highlight ? "text-success" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
