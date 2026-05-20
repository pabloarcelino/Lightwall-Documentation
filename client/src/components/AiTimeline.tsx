import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  CircleDollarSign,
  Clock,
  Cpu,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TokenUsage {
  input?: number;
  output?: number;
  thinking?: number;
  total?: number;
  cached?: number;
}

interface AiEventBase {
  callId: string;
  projectId: number;
  pageId?: number | null;
  promptVersion: string;
  model: string;
  inputSummary: string;
  timestamp: number;
}

type AiEvent =
  | (AiEventBase & { phase: "started" })
  | (AiEventBase & { phase: "completed"; durationMs: number; usage?: TokenUsage; costUsd?: number })
  | (AiEventBase & { phase: "failed"; durationMs: number; errorMessage: string });

interface AiCall extends AiEventBase {
  status: "running" | "completed" | "failed";
  durationMs?: number;
  usage?: TokenUsage;
  costUsd?: number;
  errorMessage?: string;
}

interface AiTimelineProps {
  projectId: number | string;
  /** Quando true, abre o SSE e consome eventos. False permite "congelar" o feed. */
  enabled?: boolean;
  /** Limite de itens exibidos (mais antigos sao colapsados em "+N anteriores"). */
  maxItems?: number;
  className?: string;
}

const PROMPT_LABEL: Record<string, string> = {
  classifyAndExtract: "Classificação + tabelas",
  extractGeometry:    "Extração de geometria",
  extractTables:      "Extração de tabelas",
  globalCrossValidation_v1: "Validação cruzada",
  globalValidation:   "Validação global",
  description:        "Descrição do projeto",
  sectionInfo:        "Pé-direito (cortes)",
  buildingType:       "Tipo de edificação",
};

function modelChip(model: string): { label: string; tone: "primary" | "secondary" | "neutral" } {
  const m = model.toLowerCase();
  if (m.startsWith("openai:") || m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) {
    return { label: model.replace(/^openai:/, ""), tone: "secondary" };
  }
  if (m.startsWith("gemini-")) return { label: model, tone: "primary" };
  return { label: model, tone: "neutral" };
}

function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function formatTokens(n?: number): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatUsd(usd?: number): string {
  if (usd == null) return "—";
  if (usd < 0.01) return `< US$ 0.01`;
  return `US$ ${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

export function AiTimeline({ projectId, enabled = true, maxItems = 50, className }: AiTimelineProps) {
  const [calls, setCalls] = useState<AiCall[]>([]);
  const [connected, setConnected] = useState(false);
  const lastIdRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(`/api/projects/${projectId}/ai-events`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const handler = (raw: MessageEvent) => {
      try {
        const event: AiEvent = JSON.parse(raw.data);
        setCalls(prev => upsertCall(prev, event, lastIdRef.current));
      } catch { /* ignora payload mal formado */ }
    };
    es.addEventListener("started",   handler);
    es.addEventListener("completed", handler);
    es.addEventListener("failed",    handler);

    return () => {
      es.removeEventListener("started",   handler);
      es.removeEventListener("completed", handler);
      es.removeEventListener("failed",    handler);
      es.close();
      setConnected(false);
    };
  }, [projectId, enabled]);

  const totals = useMemo(() => {
    let inT = 0, outT = 0, thT = 0, totalT = 0, costUsd = 0;
    let completed = 0, running = 0, failed = 0;
    for (const c of calls) {
      if (c.status === "running") running++;
      else if (c.status === "completed") completed++;
      else failed++;
      if (c.usage) {
        inT    += c.usage.input    ?? 0;
        outT   += c.usage.output   ?? 0;
        thT    += c.usage.thinking ?? 0;
        totalT += c.usage.total ?? ((c.usage.input ?? 0) + (c.usage.output ?? 0) + (c.usage.thinking ?? 0));
      }
      costUsd += c.costUsd ?? 0;
    }
    return { inT, outT, thT, totalT, costUsd, completed, running, failed };
  }, [calls]);

  const visible = calls.slice(-maxItems);
  const hiddenCount = Math.max(0, calls.length - visible.length);

  return (
    <section
      className={cn("rounded-xl border border-card-border bg-card overflow-hidden", className)}
      data-testid="ai-timeline"
    >
      <header className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">Atividade da IA</h3>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px] tracking-wider uppercase rounded-full px-2 py-0.5",
                connected ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
              )}
              aria-label={connected ? "Conectado" : "Desconectado"}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  connected ? "bg-success animate-pulse" : "bg-muted-foreground",
                )}
              />
              {connected ? "Ao vivo" : "Offline"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Cada chamada feita aos modelos durante o processamento, com modelo, tokens e custo estimado.
          </p>
        </div>
        <Totals
          totalTokens={totals.totalT}
          costUsd={totals.costUsd}
          running={totals.running}
          completed={totals.completed}
          failed={totals.failed}
        />
      </header>

      {/* Detalhe de tokens */}
      <div className="px-5 py-3 border-b border-border grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <TokenStat label="Entrada"   icon={<Cpu className="h-3.5 w-3.5" />}   value={totals.inT} />
        <TokenStat label="Saída"     icon={<Cpu className="h-3.5 w-3.5" />}   value={totals.outT} />
        <TokenStat label="Thinking"  icon={<Brain className="h-3.5 w-3.5" />} value={totals.thT} />
        <TokenStat label="Total"     icon={<Cpu className="h-3.5 w-3.5" />}   value={totals.totalT} highlight />
      </div>

      {/* Lista */}
      <div className="max-h-[480px] overflow-y-auto">
        {visible.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Nenhuma chamada registrada ainda. Inicie o processamento do projeto para ver eventos em tempo real.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {hiddenCount > 0 && (
              <li className="px-5 py-2 text-[11px] text-muted-foreground bg-muted/40">
                +{hiddenCount} chamada{hiddenCount > 1 ? "s" : ""} anterior{hiddenCount > 1 ? "es" : ""} omitida{hiddenCount > 1 ? "s" : ""}
              </li>
            )}
            {visible.map(call => (
              <CallRow key={call.callId} call={call} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Totals({
  totalTokens,
  costUsd,
  running,
  completed,
  failed,
}: { totalTokens: number; costUsd: number; running: number; completed: number; failed: number }) {
  return (
    <div className="hidden md:flex items-center gap-3 shrink-0">
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Custo</div>
        <div className="text-base font-bold text-foreground flex items-center justify-end gap-1.5">
          <CircleDollarSign className="h-4 w-4 text-success" />
          {formatUsd(costUsd)}
        </div>
      </div>
      <div className="h-9 w-px bg-border" />
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Tokens</div>
        <div className="text-base font-bold text-foreground">{formatTokens(totalTokens)}</div>
      </div>
      <div className="h-9 w-px bg-border" />
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Chamadas</div>
        <div className="text-base font-bold text-foreground flex items-center justify-end gap-1.5">
          <span>{completed + failed + running}</span>
          {running > 0 && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />}
          {failed > 0 && <span className="text-error text-xs">({failed} erro{failed > 1 ? "s" : ""})</span>}
        </div>
      </div>
    </div>
  );
}

function TokenStat({
  label,
  value,
  icon,
  highlight,
}: { label: string; value: number; icon: React.ReactNode; highlight?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border px-3 py-2 flex items-center justify-between gap-2",
        highlight ? "bg-primary/5 border-primary/20" : "bg-background",
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="uppercase tracking-wider text-[10px] font-medium">{label}</span>
      </div>
      <span className={cn("font-mono tabular-nums text-sm font-semibold", highlight && "text-primary")}>
        {formatTokens(value)}
      </span>
    </div>
  );
}

function CallRow({ call }: { call: AiCall }) {
  const chip = modelChip(call.model);
  const chipTone =
    chip.tone === "primary" ? "bg-primary/10 text-primary border-primary/20" :
    chip.tone === "secondary" ? "bg-secondary/10 text-secondary border-secondary/20" :
    "bg-muted text-muted-foreground border-border";

  const promptLabel = PROMPT_LABEL[call.promptVersion] ?? call.promptVersion;
  const StatusIcon =
    call.status === "running"   ? Loader2 :
    call.status === "completed" ? CheckCircle2 : AlertCircle;
  const statusTone =
    call.status === "running"   ? "text-primary" :
    call.status === "completed" ? "text-success" : "text-error";

  return (
    <li className="px-5 py-3 hover:bg-accent/40 transition-colors" data-testid={`ai-call-${call.callId}`}>
      <div className="flex items-start gap-3">
        <StatusIcon
          className={cn(
            "h-4 w-4 mt-0.5 shrink-0",
            statusTone,
            call.status === "running" && "animate-spin",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground">{promptLabel}</span>
            <span
              className={cn("inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded border", chipTone)}
              title={`Modelo: ${call.model}`}
            >
              {chip.label}
            </span>
            {call.pageId != null && (
              <span className="text-[10px] text-muted-foreground">página {call.pageId}</span>
            )}
            <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(call.durationMs)}
            </span>
          </div>

          <div className="mt-1 text-xs text-muted-foreground truncate">{call.inputSummary}</div>

          {(call.usage || call.costUsd != null || call.errorMessage) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {call.usage && (
                <>
                  <span><strong className="text-foreground">{formatTokens(call.usage.input)}</strong> in</span>
                  <span><strong className="text-foreground">{formatTokens(call.usage.output)}</strong> out</span>
                  {(call.usage.thinking ?? 0) > 0 && (
                    <span className="flex items-center gap-1">
                      <Brain className="h-3 w-3 text-primary" />
                      <strong className="text-foreground">{formatTokens(call.usage.thinking)}</strong> thinking
                    </span>
                  )}
                </>
              )}
              {call.costUsd != null && (
                <span className="flex items-center gap-1">
                  <CircleDollarSign className="h-3 w-3 text-success" />
                  <strong className="text-foreground">{formatUsd(call.costUsd)}</strong>
                </span>
              )}
              {call.errorMessage && (
                <span className="text-error">{call.errorMessage}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------- Reducer helpers ----------

function upsertCall(prev: AiCall[], event: AiEvent, seenIds: Set<string>): AiCall[] {
  if (event.phase === "started") {
    if (seenIds.has(event.callId)) return prev;
    seenIds.add(event.callId);
    return [...prev, {
      callId: event.callId,
      projectId: event.projectId,
      pageId: event.pageId,
      promptVersion: event.promptVersion,
      model: event.model,
      inputSummary: event.inputSummary,
      timestamp: event.timestamp,
      status: "running",
    }];
  }

  // completed / failed — encontra existente ou cria
  const idx = prev.findIndex(c => c.callId === event.callId);
  const base: AiCall = idx >= 0
    ? { ...prev[idx] }
    : {
        callId: event.callId,
        projectId: event.projectId,
        pageId: event.pageId,
        promptVersion: event.promptVersion,
        model: event.model,
        inputSummary: event.inputSummary,
        timestamp: event.timestamp,
        status: "running",
      };

  if (event.phase === "completed") {
    base.status = "completed";
    base.durationMs = event.durationMs;
    base.usage = event.usage;
    base.costUsd = event.costUsd;
  } else {
    base.status = "failed";
    base.durationMs = event.durationMs;
    base.errorMessage = event.errorMessage;
  }

  if (idx >= 0) {
    const next = prev.slice();
    next[idx] = base;
    return next;
  }
  return [...prev, base];
}
