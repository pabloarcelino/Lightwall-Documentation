import { useState, useEffect } from "react";
import { Activity, CircleCheck, CircleAlert, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PipelineEvent {
  id: number;
  projectId: number;
  kind: string;
  stage: string | null;
  phase: string | null;
  payload: any;
  createdAt: string;
}

interface Props {
  projectId: number;
}

interface StageRow {
  stage: string;
  label: string;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  errorMessage?: string;
  detail?: string;
}

function aggregateStages(events: PipelineEvent[]): StageRow[] {
  const map = new Map<string, StageRow>();
  for (const ev of events) {
    if (ev.kind !== "stage" || !ev.stage) continue;
    const ts = new Date(ev.createdAt).getTime();
    const cur: StageRow = map.get(ev.stage) ?? {
      stage: ev.stage,
      label: ev.payload?.label || ev.stage,
    };
    if (ev.phase === "started") cur.startedAt = ts;
    if (ev.phase === "completed") cur.completedAt = ts;
    if (ev.phase === "failed") {
      cur.failedAt = ts;
      cur.errorMessage = ev.payload?.errorMessage;
    }
    if (ev.payload?.label) cur.label = ev.payload.label;
    if (ev.payload?.detail) cur.detail = ev.payload.detail;
    map.set(ev.stage, cur);
  }
  return Array.from(map.values()).sort((a, b) => {
    const ta = a.startedAt ?? a.completedAt ?? a.failedAt ?? 0;
    const tb = b.startedAt ?? b.completedAt ?? b.failedAt ?? 0;
    return ta - tb;
  });
}

function fmtDuration(start?: number, end?: number): string {
  if (!start || !end) return "—";
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

export function VisionDirectPipelineTimeline({ projectId }: Props) {
  const [events, setEvents] = useState<PipelineEvent[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/pipeline-events`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setEvents(Array.isArray(data) ? data : []))
      .catch(() => setEvents([]));
  }, [projectId]);

  const stages = events ? aggregateStages(events) : [];
  if (stages.length === 0) return null;

  const totalMs = stages.reduce((sum, s) => {
    if (!s.startedAt || !(s.completedAt ?? s.failedAt)) return sum;
    return sum + ((s.completedAt ?? s.failedAt ?? 0) - s.startedAt);
  }, 0);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full p-3 flex items-center gap-2 hover:bg-muted/30 transition text-left"
        data-testid="toggle-timeline"
      >
        <Activity className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold flex-1">Pipeline timing por etapa</h2>
        <span className="text-xs text-muted-foreground font-mono">
          {stages.length} etapas · {fmtDuration(0, totalMs)} total
        </span>
        <span className="text-xs text-muted-foreground">{open ? "▼" : "▶"}</span>
      </button>
      {open && (
        <div className="border-t border-border p-3">
          <ol className="space-y-1.5">
            {stages.map((s) => {
              const isError = !!s.failedAt;
              const isDone = !!s.completedAt;
              const isRunning = !!s.startedAt && !isDone && !isError;
              const duration = fmtDuration(s.startedAt, s.completedAt ?? s.failedAt);
              return (
                <li
                  key={s.stage}
                  className={cn(
                    "flex items-start gap-2 text-xs px-2 py-1.5 rounded-md",
                    isError && "bg-error/5",
                  )}
                >
                  <span className="shrink-0 mt-0.5">
                    {isError ? (
                      <CircleAlert className="h-3.5 w-3.5 text-error" />
                    ) : isRunning ? (
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <CircleCheck className="h-3.5 w-3.5 text-success" />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{s.label}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {s.stage}
                      </span>
                    </div>
                    {s.detail && (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {s.detail}
                      </p>
                    )}
                    {s.errorMessage && (
                      <p className="text-[10px] text-error truncate mt-0.5">
                        {s.errorMessage}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                    {duration}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Card>
  );
}
