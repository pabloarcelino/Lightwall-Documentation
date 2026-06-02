import { useEffect, useState } from "react";
import { Loader2, X, FileText, Sparkles, CircleCheck, CircleAlert, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useProcessingEvents } from "@/components/live-pipeline/useProcessingEvents";
import { useToast } from "@/hooks/use-toast";

interface Props {
  projectId: number;
}

function fmtElapsed(ms: number): string {
  if (ms < 1000) return "0.0s";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

export function VisionDirectLiveView({ projectId }: Props) {
  const { state, connected } = useProcessingEvents({ projectId, enabled: true });
  const { toast } = useToast();
  const [aborting, setAborting] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Timer ao vivo — atualiza a cada 500ms
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const startedAt = state.startedAt;
  const elapsedMs = startedAt ? now - startedAt : 0;

  // Contadores derivados
  const filesOk = Array.from(state.stages.values()).filter(
    (s) => s.label.startsWith("Arquivo") && s.phase === "completed",
  ).length;
  const filesFail = Array.from(state.stages.values()).filter(
    (s) => s.label.startsWith("Arquivo") && s.phase === "failed",
  ).length;
  const aiCallsTotal = state.aiCalls.length;
  const aiCallsRunning = state.aiCalls.filter((c) => c.status === "running").length;
  const imagesRendered = state.renderedImages?.filter((i) => i.status === "ready").length ?? 0;

  // Ultima etapa visivel
  const stagesArr = Array.from(state.stages.values());
  const lastStage = stagesArr[stagesArr.length - 1];
  const currentLabel = lastStage?.label || "Iniciando análise…";

  const handleAbort = async () => {
    if (aborting) return;
    setAborting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/abort`, { method: "POST" });
      if (res.ok) {
        toast({
          title: "Aborto solicitado",
          description: "Aguardando próxima etapa para encerrar...",
        });
      } else {
        toast({
          title: "Erro ao abortar",
          description: `HTTP ${res.status}`,
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Erro de rede",
        description: err?.message || "Falha ao solicitar aborto",
        variant: "destructive",
      });
    } finally {
      setTimeout(() => setAborting(false), 3000);
    }
  };

  return (
    <Card className="p-6 space-y-5">
      {/* Header com spinner + status + timer + cancelar */}
      <div className="flex items-start gap-4">
        <Loader2 className="h-10 w-10 text-primary animate-spin shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold leading-tight mb-1">Analisando planta…</h3>
          <p className="text-sm text-muted-foreground truncate" title={currentLabel}>
            {currentLabel}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {fmtElapsed(elapsedMs)}
            </span>
            <Badge variant="outline" className={cn("text-[10px]", connected ? "border-success/40 text-success" : "border-muted-foreground/30")}>
              {connected ? "Eventos: conectado" : "Eventos: conectando..."}
            </Badge>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAbort}
          disabled={aborting}
          data-testid="abort-analysis"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          {aborting ? "Abortando..." : "Cancelar análise"}
        </Button>
      </div>

      {/* Contadores ao vivo */}
      <div className="grid grid-cols-3 gap-3">
        <CounterCard
          icon={<FileText className="h-4 w-4" />}
          label="Arquivos"
          value={`${filesOk}${filesFail > 0 ? ` · ${filesFail} erro` : ""}`}
        />
        <CounterCard
          icon={<Sparkles className="h-4 w-4" />}
          label="Chamadas IA"
          value={
            aiCallsRunning > 0
              ? `${aiCallsTotal} (${aiCallsRunning} em curso)`
              : String(aiCallsTotal)
          }
        />
        <CounterCard
          icon={<CircleCheck className="h-4 w-4" />}
          label="Imagens geradas"
          value={String(imagesRendered)}
        />
      </div>

      {/* Mini timeline das etapas */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-medium">
          Etapas
        </div>
        {stagesArr.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aguardando primeiras etapas...</p>
        ) : (
          <ol className="space-y-1.5">
            {stagesArr.map((s, idx) => {
              const isLast = idx === stagesArr.length - 1;
              const stillRunning = s.phase === "started";
              const duration = s.completedAt && s.startedAt
                ? `${((s.completedAt - s.startedAt) / 1000).toFixed(1)}s`
                : stillRunning && s.startedAt
                  ? `${((now - s.startedAt) / 1000).toFixed(0)}s...`
                  : null;
              return (
                <li
                  key={s.stage}
                  className={cn(
                    "flex items-center gap-2 text-xs px-2 py-1.5 rounded-md transition",
                    isLast && stillRunning && "bg-primary/5",
                  )}
                >
                  <span className="shrink-0">
                    {s.phase === "started" ? (
                      <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                    ) : s.phase === "failed" ? (
                      <CircleAlert className="h-3.5 w-3.5 text-error" />
                    ) : (
                      <CircleCheck className="h-3.5 w-3.5 text-success" />
                    )}
                  </span>
                  <span className="flex-1 truncate">{s.label}</span>
                  {s.detail && (
                    <span className="text-[10px] text-muted-foreground truncate">
                      {s.detail}
                    </span>
                  )}
                  {duration && (
                    <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                      {duration}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground text-center pt-2 border-t border-border/40">
        Você pode fechar esta página — o resultado aparece quando voltar.
      </p>
    </Card>
  );
}

function CounterCard({
  icon, label, value,
}: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
