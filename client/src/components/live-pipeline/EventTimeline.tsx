import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Image as ImageIcon, AlertTriangle, Info, AlertOctagon, CheckCircle2, Loader2, AlertCircle, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { AiCallCard } from "./AiCallCard";
import { STAGE_CATALOG } from "./LiveStepper";
import type {
  ProcessingState,
  PipelineEvent,
  AiCallEvent,
  StageEvent,
  PdfSplitEvent,
  ImageRenderEvent,
  CvSubstepEvent,
  AuditFindingEvent,
} from "./useProcessingEvents";

type EventKindFilter = "all" | "ai_call" | "stage" | "image_render" | "cv_substep" | "pdf_split" | "audit_finding";

interface EventTimelineProps {
  state: ProcessingState;
  /** Quando true, dropa qualquer evento que nao seja erro/falha. */
  errorsOnly?: boolean;
  /** Auto-scroll pra ponta sempre que chegar evento novo. */
  autoScroll?: boolean;
  onImageClick?: (img: ImageRenderEvent) => void;
}

function inferStage(e: PipelineEvent): string {
  const kind = (e.kind ?? "ai_call") as PipelineEvent["kind"];
  if (kind === "stage") return (e as StageEvent).stage;
  if (kind === "cv_substep") return "3.4";
  if (kind === "image_render") return "7.5";
  if (kind === "pdf_split") return "0.5";
  if (kind === "audit_finding") return (e as AuditFindingEvent).stage ?? "6.5";
  // ai_call — heuristica via promptVersion
  const aev = e as AiCallEvent;
  const pv = aev.promptVersion || "";
  if (pv.startsWith("classifyAndExtract")) return "1";
  if (pv.startsWith("characterizeProject")) return "1.5";
  if (pv.startsWith("extractGeometry")) return "3";
  if (pv.startsWith("verify")) return "3.5";
  if (pv.startsWith("globalCrossValidation") || pv.startsWith("globalValidation")) return "4.6";
  if (pv.startsWith("description") || pv.startsWith("describe")) return "8";
  if (pv.startsWith("sectionInfo")) return "0.5";
  if (pv.startsWith("buildingType")) return "1";
  return "?";
}

function eventTime(e: PipelineEvent): number { return e.timestamp; }

function isErrorEvent(e: PipelineEvent): boolean {
  const kind = (e.kind ?? "ai_call") as PipelineEvent["kind"];
  if (kind === "audit_finding") {
    const fev = e as AuditFindingEvent;
    return fev.severity === "warning" || fev.severity === "error";
  }
  return (e as { phase?: string }).phase === "failed";
}

export function EventTimeline({ state, errorsOnly = false, autoScroll = true, onImageClick }: EventTimelineProps) {
  const [filter, setFilter] = useState<EventKindFilter>("all");
  const [localErrorsOnly, setLocalErrorsOnly] = useState(errorsOnly);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    return state.events.filter(e => {
      if (localErrorsOnly && !isErrorEvent(e)) return false;
      if (filter === "all") return true;
      const k = (e.kind ?? "ai_call") as string;
      return k === filter;
    });
  }, [state.events, filter, localErrorsOnly]);

  const grouped = useMemo(() => {
    const map = new Map<string, PipelineEvent[]>();
    for (const e of filtered) {
      const st = inferStage(e);
      if (!map.has(st)) map.set(st, []);
      map.get(st)!.push(e);
    }
    // ordena os eventos dentro de cada grupo cronologicamente
    for (const list of map.values()) list.sort((a, b) => eventTime(a) - eventTime(b));
    // ordena os grupos pela ordem do catalogo, com etapas desconhecidas no final
    const catalogOrder = new Map(STAGE_CATALOG.map((c, i) => [c.stage, i]));
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ia = catalogOrder.get(a) ?? 999;
      const ib = catalogOrder.get(b) ?? 999;
      return ia - ib;
    });
  }, [filtered]);

  useEffect(() => {
    if (!autoScroll || !containerRef.current) return;
    const el = containerRef.current;
    el.scrollTop = el.scrollHeight;
  }, [autoScroll, filtered.length]);

  const kindChips: Array<{ key: EventKindFilter; label: string }> = [
    { key: "all", label: "Todos" },
    { key: "stage", label: "Etapas" },
    { key: "ai_call", label: "IA" },
    { key: "image_render", label: "Imagens" },
    { key: "cv_substep", label: "CV" },
    { key: "pdf_split", label: "PDF" },
    { key: "audit_finding", label: "Auditoria" },
  ];

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {kindChips.map(c => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                filter === c.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-accent",
              )}
              data-testid={`timeline-filter-${c.key}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={localErrorsOnly}
            onChange={(e) => setLocalErrorsOnly(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Apenas erros
        </label>
      </header>

      <div ref={containerRef} className="max-h-[60vh] overflow-y-auto px-4 py-3 space-y-4">
        {grouped.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {state.events.length === 0
              ? "Nenhum evento registrado ainda. Inicie o processamento para ver o passo a passo."
              : "Nenhum evento corresponde aos filtros atuais."}
          </div>
        ) : (
          grouped.map(([stage, events]) => {
            const catalog = STAGE_CATALOG.find(c => c.stage === stage);
            const stageState = state.stages.get(stage);
            return (
              <details key={stage} id={`stage-${stage}`} open className="group">
                <summary className="cursor-pointer list-none flex items-center gap-2 py-2 px-2 -mx-2 rounded hover:bg-accent/30">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground tabular-nums">
                    Etapa {stage}
                  </span>
                  <span className="text-sm font-semibold">{catalog?.label ?? stageState?.label ?? "Etapa"}</span>
                  <span className="text-[11px] text-muted-foreground ml-1">({events.length})</span>
                  {stageState?.phase === "failed" && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-error">
                      <AlertCircle className="h-3 w-3" /> Falha
                    </span>
                  )}
                </summary>
                <div className="mt-1 ml-2 pl-3 border-l border-border space-y-1.5">
                  {events.map((e, i) => <EventRow key={`${stage}-${i}`} event={e} state={state} onImageClick={onImageClick} />)}
                </div>
              </details>
            );
          })
        )}
      </div>
    </section>
  );
}

function EventRow({ event, state, onImageClick }: { event: PipelineEvent; state: ProcessingState; onImageClick?: (img: ImageRenderEvent) => void }) {
  const kind = (event.kind ?? "ai_call") as string;

  if (kind === "ai_call") {
    const aev = event as AiCallEvent;
    const call = state.aiCalls.find(c => c.callId === aev.callId);
    if (!call) return null;
    // mostra so o evento terminal (completed/failed) — o started ja virou running
    if (aev.phase === "started" && call.status !== "running") return null;
    return <AiCallCard call={call} flat />;
  }

  if (kind === "stage") {
    const sev = event as StageEvent;
    const Icon = sev.phase === "completed" ? CheckCircle2 : sev.phase === "failed" ? AlertCircle : Loader2;
    const tone = sev.phase === "completed" ? "text-success" : sev.phase === "failed" ? "text-error" : "text-primary";
    return (
      <div className="flex items-center gap-2 text-xs px-2 py-1">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", tone, sev.phase === "started" && "animate-spin")} />
        <span className="font-medium">{sev.phase === "started" ? "Iniciado" : sev.phase === "completed" ? "Concluido" : "Falhou"}</span>
        {sev.detail && <span className="text-muted-foreground truncate">{sev.detail}</span>}
        {sev.errorMessage && <span className="text-error truncate">{sev.errorMessage}</span>}
      </div>
    );
  }

  if (kind === "pdf_split") {
    const pev = event as PdfSplitEvent;
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground px-2 py-0.5">
        <FileText className="h-3 w-3 shrink-0" />
        <span className="font-mono">{pev.fileName || `file ${pev.fileId}`}</span>
        <span>pag {pev.pageIndex + 1}{pev.totalPages ? `/${pev.totalPages}` : ""}</span>
        <span className={cn(
          "ml-auto",
          pev.phase === "completed" ? "text-success" : pev.phase === "failed" ? "text-error" : "",
        )}>
          {pev.phase === "completed" ? "OK" : pev.phase === "failed" ? "ERRO" : "..."}
        </span>
      </div>
    );
  }

  if (kind === "cv_substep") {
    const cev = event as CvSubstepEvent;
    const pct = cev.progressPct ?? (cev.phase === "completed" ? 100 : cev.phase === "started" ? 0 : 0);
    return (
      <div className="flex items-center gap-2 text-[11px] px-2 py-1">
        <Cpu className="h-3 w-3 shrink-0 text-primary" />
        <span className="font-mono uppercase tracking-wider">{cev.substep}</span>
        {cev.pavimento && <span className="text-muted-foreground">{cev.pavimento}</span>}
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[60px] max-w-[200px]">
          <div
            className={cn("h-full transition-all", cev.phase === "failed" ? "bg-error" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-muted-foreground tabular-nums">{pct.toFixed(0)}%</span>
        {cev.detail && <span className="text-muted-foreground truncate">{cev.detail}</span>}
        {cev.errorMessage && <span className="text-error truncate">{cev.errorMessage}</span>}
      </div>
    );
  }

  if (kind === "image_render") {
    const iev = event as ImageRenderEvent;
    if (iev.phase === "started") {
      return (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground px-2 py-1">
          <Loader2 className="h-3 w-3 animate-spin shrink-0 text-primary" />
          <ImageIcon className="h-3 w-3 shrink-0" />
          <span>Renderizando {iev.pavimento} (pg {iev.pageIndex + 1})...</span>
        </div>
      );
    }
    if (iev.phase === "failed") {
      return (
        <div className="flex items-center gap-2 text-[11px] text-error px-2 py-1">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>Falha em {iev.pavimento} pg {iev.pageIndex + 1}: {iev.errorMessage ?? "erro desconhecido"}</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => iev.imageUrl && onImageClick?.(iev)}
          className="h-14 w-20 rounded border border-border overflow-hidden hover:ring-2 hover:ring-primary transition shrink-0 bg-muted"
          disabled={!iev.imageUrl}
          title="Abrir em tamanho real"
        >
          {iev.imageUrl ? (
            <img src={iev.imageUrl} alt={`${iev.pavimento} pg ${iev.pageIndex + 1}`} className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-5 w-5 mx-auto text-muted-foreground" />
          )}
        </button>
        <div className="min-w-0">
          <div className="text-xs font-medium">{iev.pavimento}</div>
          <div className="text-[11px] text-muted-foreground">pagina {iev.pageIndex + 1}{iev.byteSize ? ` • ${(iev.byteSize / 1024).toFixed(0)} KB` : ""}</div>
        </div>
      </div>
    );
  }

  if (kind === "audit_finding") {
    const fev = event as AuditFindingEvent;
    const Icon = fev.severity === "error" ? AlertOctagon : fev.severity === "warning" ? AlertTriangle : Info;
    const tone = fev.severity === "error" ? "text-error" : fev.severity === "warning" ? "text-warning" : "text-muted-foreground";
    return (
      <div className="flex items-start gap-2 text-[11px] px-2 py-1">
        <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", tone)} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("font-mono text-[10px] uppercase tracking-wider", tone)}>{fev.severity}</span>
            <span className="text-foreground font-medium">{fev.code}</span>
          </div>
          <div className="text-muted-foreground">{fev.message}</div>
        </div>
      </div>
    );
  }

  return null;
}
