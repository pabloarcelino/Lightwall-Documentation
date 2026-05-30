import { useCallback, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { CircleDollarSign, Cpu, Clock, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [aborting, setAborting] = useState(false);

  const handleAbort = useCallback(async () => {
    setAborting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/abort`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({
        title: "Aborto solicitado",
        description: "O pipeline vai parar na próxima fronteira de etapa (pode levar alguns segundos).",
      });
      setConfirmAbort(false);
    } catch (err: any) {
      toast({ title: "Falha ao abortar", description: err?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setAborting(false);
    }
  }, [projectId, toast]);

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

  // SSE so abre quando o pipeline esta de fato rodando. Quando isActive=false
  // (projeto ja completado), so hidratamos via GET /pipeline-events e nao
  // mantemos stream aberto — evita reconnect loop que disparava 429 quando
  // o servidor termina o broadcast.
  const { state, connected, exhausted: _exhausted, reconnect } = useProcessingEvents({
    projectId,
    enabled: isActive,
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
        <div className="ml-auto flex items-center gap-3">
          <div className="text-[11px] text-muted-foreground">
            {state.aiCalls.length} chamada{state.aiCalls.length !== 1 ? "s" : ""} • {state.renderedImages.filter(i => i.status === "ready").length}/{state.renderedImages.length} imagens
          </div>
          {isActive && !state.finishedAt && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmAbort(true)}
              data-testid="abort-pipeline"
              className="gap-1.5"
            >
              <X className="h-3.5 w-3.5" />
              Abortar
            </Button>
          )}
        </div>
      </header>

      {/* Confirmacao de aborto */}
      <Dialog open={confirmAbort} onOpenChange={(v) => !v && !aborting && setConfirmAbort(false)}>
        <DialogContent className="max-w-md">
          <DialogTitle>Abortar processamento?</DialogTitle>
          <p className="text-sm text-muted-foreground mt-2">
            O pipeline vai parar assim que terminar a etapa atual (pode levar alguns segundos —
            até ~2 minutos se uma chamada Gemini estiver no meio).
            Os dados parciais ficarão salvos mas o projeto será marcado como erro até reprocessar.
          </p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setConfirmAbort(false)} disabled={aborting}>
              Continuar processando
            </Button>
            <Button variant="destructive" onClick={handleAbort} disabled={aborting} data-testid="abort-confirm">
              {aborting ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Abortando…</> : "Sim, abortar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
