import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  CircleDollarSign,
  Clock,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AiCallState } from "./useProcessingEvents";

const PROMPT_LABEL: Record<string, string> = {
  classifyAndExtract: "Classificacao + tabelas",
  classifyAndExtractTables_v1: "Classificacao + tabelas",
  characterizeProject_v1: "Caracterizacao do projeto",
  extractGeometry: "Extracao de geometria",
  extractGeometryParallel_v1: "Extracao de geometria",
  extractTables: "Extracao de tabelas",
  globalCrossValidation_v1: "Validacao cruzada",
  globalValidation: "Validacao global",
  description: "Descricao do projeto",
  sectionInfo: "Pe-direito (cortes)",
  buildingType: "Tipo de edificacao",
};

export function modelChip(model: string | undefined | null): { label: string; tone: "primary" | "secondary" | "neutral" } {
  if (!model) return { label: "—", tone: "neutral" };
  const m = model.toLowerCase();
  if (m.startsWith("openai:") || m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) {
    return { label: model.replace(/^openai:/, ""), tone: "secondary" };
  }
  if (m.startsWith("gemini-")) return { label: model, tone: "primary" };
  return { label: model, tone: "neutral" };
}

export function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

export function formatTokens(n?: number): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatUsd(usd?: number): string {
  if (usd == null) return "—";
  if (usd < 0.01) return `< US$ 0.01`;
  return `US$ ${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

interface AiCallCardProps {
  call: AiCallState;
  /** Quando true, exibe sem borda/divider (uso em listas com bordas externas). */
  flat?: boolean;
}

export function AiCallCard({ call, flat }: AiCallCardProps) {
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
    <div
      className={cn(
        "px-3 py-2.5 flex items-start gap-3",
        !flat && "border border-border rounded-lg bg-card",
      )}
      data-testid={`ai-call-${call.callId}`}
    >
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
            <span className="text-[10px] text-muted-foreground">pagina {call.pageId}</span>
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
  );
}
