import { CheckCircle2, AlertCircle, Loader2, Circle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProcessingState, StageState } from "./useProcessingEvents";

export interface StepperEntry {
  stage: string;
  label: string;
  /** Descrição curta (≤ 80 chars) sobre o que essa etapa faz. */
  description: string;
  /** Etapas que aceitam reprocesso granular (sem refazer pipeline inteira). */
  reprocessable?: boolean;
}

export const STAGE_CATALOG: StepperEntry[] = [
  { stage: "0.5", label: "Pre-flight", reprocessable: true,
    description: "Inspeciona o arquivo: PDF vs imagem, vetor vs raster, recomenda modo de extração." },
  { stage: "1",   label: "Classificação",
    description: "Identifica que tipo de página é cada uma (planta baixa, corte, fachada) e extrai tabelas." },
  { stage: "1.5", label: "Caracterização", reprocessable: true,
    description: "Identifica tipologia, programa, padrão e ranges esperados pra calibrar prompts seguintes." },
  { stage: "2.5", label: "Vetor Nativo",
    description: "Lê geometria direto do PDF vetorial — escala via cotas. Bônus em PDFs com cotas confiáveis." },
  { stage: "3",   label: "Geometria",
    description: "Extrai paredes, lajes e cantos das plantas via IA (Gemini Pro), por pavimento em paralelo." },
  { stage: "3.4", label: "CV",
    description: "Pipeline OpenCV opcional (cv-service Python). Quando rodando, refina endpoints de paredes." },
  { stage: "3.5", label: "Verificação",
    description: "Inventário focado: extrai eixos (p1→p2) reais das paredes pra renderização correta." },
  { stage: "3.7", label: "Topologia",
    description: "Detecta envelope da edificação e classifica paredes (externa/interna/muro) por point-in-polygon." },
  { stage: "4",   label: "Fusão",
    description: "Cruza dados de todas as páginas, deduplica, reclassifica por score, gera lajes padrão." },
  { stage: "4.5", label: "Val. Geom.",
    description: "Remove paredes/lajes com dimensões implausíveis (espessura, comprimento fora do range)." },
  { stage: "4.6", label: "Val. Global",
    description: "Validação IA cruzada — checa consistência entre vistas (planta, corte, fachada)." },
  { stage: "5",   label: "Quantitativos",
    description: "Calcula painéis necessários por pavimento aplicando regras Lightwall (2P/SP/dimensões)." },
  { stage: "6",   label: "Catálogo",
    description: "Aplica perfil de preços ao catálogo: custos de painéis externos, internos, muros, lajes." },
  { stage: "6.5", label: "Auto-Auditoria",
    description: "SelfCheck determinístico: verifica perímetro × área, esquadrias × paredes, ranges típicos." },
  { stage: "7",   label: "Validação",
    description: "Identifica inconsistências críticas, médias e baixas pra revisão humana." },
  { stage: "7.5", label: "Imagens", reprocessable: true,
    description: "Renderiza a planta anotada (faixas vermelhas/verdes) usando endpoints + thickness." },
  { stage: "8",   label: "Descrição", reprocessable: true,
    description: "IA gera prosa descritiva do projeto: identificação, ambientes, padrão, áreas." },
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
    <TooltipProvider delayDuration={120}>
      <div
        className="w-full rounded-xl border border-card-border bg-card"
        data-testid="live-stepper"
      >
        <div className="flex flex-wrap items-stretch gap-1.5 px-2 py-2">
          {STAGE_CATALOG.map((entry) => {
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
            const isActive = status === "started";
            const isFailed = status === "failed";
            // Pílula ativa: ampla com descrição inline. Demais: compacta com
            // ícone + número + label curto. Falhada: também ampla pra surfar erro.
            const expanded = isActive || isFailed;
            return (
              <Tooltip key={entry.stage}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => (onSelect ?? defaultSelect)(entry.stage)}
                    className={cn(
                      "group relative flex items-center gap-1.5 rounded-md border transition-all",
                      expanded ? "flex-col items-start px-2.5 py-1.5 max-w-[20rem] flex-1 basis-[16rem]" : "px-2 py-1",
                      ringTone,
                      isActive && "shadow-[0_0_0_2px_rgba(24,156,217,0.15)]",
                    )}
                    data-testid={`stage-pill-${entry.stage}`}
                  >
                    <div className="flex items-center gap-1.5 w-full">
                      <Icon
                        className={cn(
                          "h-3 w-3 shrink-0",
                          isActive && "animate-spin",
                        )}
                      />
                      <span className="text-[9px] font-mono tabular-nums uppercase tracking-wider opacity-70">
                        {entry.stage}
                      </span>
                      <span className={cn(
                        "text-[11px] font-medium truncate",
                        !expanded && "max-w-[5.5rem]",
                      )}>
                        {entry.label}
                      </span>
                      {entry.reprocessable && status !== "pending" && onReprocess && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onReprocess(entry.stage); }}
                          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 hover:bg-accent"
                          title={`Reprocessar etapa ${entry.stage}`}
                          data-testid={`reprocess-${entry.stage}`}
                        >
                          <RotateCcw className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                    {/* Descrição inline quando ativa. Detail do erro quando failed. */}
                    {isActive && (
                      <span className="text-[10px] text-current/80 line-clamp-2 w-full leading-tight pl-4">
                        {entry.description}
                      </span>
                    )}
                    {isFailed && s?.errorMessage && (
                      <span className="text-[10px] text-current/80 line-clamp-2 w-full leading-tight pl-4">
                        {s.errorMessage}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                  <div className="font-semibold mb-1">Etapa {entry.stage} — {entry.label}</div>
                  <div className="opacity-90">{entry.description}</div>
                  {s?.detail && <div className="mt-1.5 pt-1.5 border-t border-border/40 opacity-80">{s.detail}</div>}
                  {s?.errorMessage && <div className="mt-1.5 pt-1.5 border-t border-border/40 text-error">{s.errorMessage}</div>}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
