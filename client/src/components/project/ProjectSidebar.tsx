import { useState } from "react";
import {
  Info, Layers, BookOpen, Download, Trash2, FileText, Activity, ChevronDown,
  Clock, CircleDollarSign, Cpu, Fingerprint, Mail, AlertTriangle,
  Building2, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SidebarSectionProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  badge?: string | number;
  defaultOpen?: boolean;
  /** Quando true, render do conteúdo é adiado até abrir (perf pra modais pesados como Metodologia). */
  lazy?: boolean;
  children: React.ReactNode;
}

function SidebarSection({ icon: Icon, title, badge, defaultOpen = false, lazy = false, children }: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-accent/30 transition-colors text-left"
        data-testid={`sidebar-toggle-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium flex-1">{title}</span>
        {badge !== undefined && badge !== "" && (
          <span className="text-[10px] font-mono tabular-nums bg-muted text-muted-foreground rounded px-1.5 py-0.5">
            {badge}
          </span>
        )}
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-3 pb-3 text-sm">
          {lazy ? children : children}
        </div>
      )}
    </div>
  );
}

export interface ProjectSidebarProps {
  // Dados do projeto
  projectName: string;
  clientName?: string;
  clientEmail?: string | null;
  buildingType?: string;
  projectType?: "teste" | "real";
  fingerprint?: string | null;

  // Telemetria
  elapsedMs?: number | null;
  costUsd?: number | null;
  tokens?: number | null;

  // Disponibilidade de conteúdo
  hasBudget: boolean;
  hasExtractedData: boolean;
  isProcessing: boolean;

  // Conteúdos das seções
  filesContent?: React.ReactNode;
  inspectorContent?: React.ReactNode;
  liveContent?: React.ReactNode;
  descriptionContent?: React.ReactNode;
  stagesContent?: React.ReactNode;
  methodologyContent?: React.ReactNode;
  exportContent?: React.ReactNode;

  // Ações
  onDelete?: () => void;
}

function formatElapsed(ms: number | null | undefined): string | null {
  if (ms == null || ms < 0) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function formatUsd(usd: number | null | undefined): string | null {
  if (usd == null || usd <= 0) return null;
  if (usd < 0.01) return "< US$ 0.01";
  return `US$ ${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

function formatTokens(n: number | null | undefined): string | null {
  if (n == null || n <= 0) return null;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function ProjectSidebar({
  projectName,
  clientName,
  clientEmail,
  buildingType,
  projectType,
  fingerprint,
  elapsedMs,
  costUsd,
  tokens,
  hasBudget,
  hasExtractedData,
  isProcessing,
  filesContent,
  inspectorContent,
  liveContent,
  descriptionContent,
  stagesContent,
  methodologyContent,
  exportContent,
  onDelete,
}: ProjectSidebarProps) {
  const elapsedStr = formatElapsed(elapsedMs);
  const costStr = formatUsd(costUsd);
  const tokensStr = formatTokens(tokens);

  return (
    <aside
      className="w-[320px] shrink-0 border-l border-border bg-card/40 backdrop-blur flex flex-col h-full overflow-hidden"
      data-testid="project-sidebar"
    >
      {/* Header da sidebar */}
      <div className="px-3 py-2.5 border-b border-border bg-card/60">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Navegador do projeto</div>
        <div className="text-sm font-semibold truncate mt-0.5" title={projectName}>{projectName}</div>
      </div>

      {/* Conteúdo scrollável */}
      <div className="flex-1 overflow-y-auto">

        {/* RESUMO — sempre primeiro e aberto */}
        <SidebarSection icon={Info} title="Resumo" defaultOpen>
          <dl className="space-y-1.5 text-xs">
            {clientName && (
              <div className="flex items-start gap-2">
                <User className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-[10px] uppercase tracking-wider">Cliente</dt>
                  <dd className="font-medium truncate">{clientName}</dd>
                  {clientEmail && (
                    <a href={`mailto:${clientEmail}`} className="text-[11px] text-primary hover:underline flex items-center gap-1 mt-0.5">
                      <Mail className="h-3 w-3" />
                      <span className="truncate">{clientEmail}</span>
                    </a>
                  )}
                </div>
              </div>
            )}
            {buildingType && (
              <div className="flex items-start gap-2">
                <Building2 className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-[10px] uppercase tracking-wider">Edificação</dt>
                  <dd className="font-medium capitalize">{buildingType}{projectType === "teste" && " · projeto teste"}</dd>
                </div>
              </div>
            )}
            {fingerprint && (
              <div className="flex items-start gap-2">
                <Fingerprint className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-[10px] uppercase tracking-wider">Fingerprint</dt>
                  <dd className="font-mono text-[10px] truncate" title={fingerprint}>{fingerprint.slice(0, 16)}…</dd>
                </div>
              </div>
            )}
          </dl>
        </SidebarSection>

        {/* TELEMETRIA — só mostra quando há valores */}
        {(elapsedStr || costStr || tokensStr) && (
          <SidebarSection icon={Activity} title="Telemetria" defaultOpen>
            <div className="grid grid-cols-3 gap-1.5">
              {elapsedStr && (
                <div className="rounded border border-border bg-background/60 px-2 py-1.5">
                  <Clock className="h-3 w-3 text-muted-foreground mb-0.5" />
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Tempo</div>
                  <div className="text-xs font-bold tabular-nums">{elapsedStr}</div>
                </div>
              )}
              {costStr && (
                <div className="rounded border border-border bg-background/60 px-2 py-1.5">
                  <CircleDollarSign className="h-3 w-3 text-success mb-0.5" />
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Custo IA</div>
                  <div className="text-xs font-bold tabular-nums">{costStr}</div>
                </div>
              )}
              {tokensStr && (
                <div className="rounded border border-border bg-background/60 px-2 py-1.5">
                  <Cpu className="h-3 w-3 text-muted-foreground mb-0.5" />
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Tokens</div>
                  <div className="text-xs font-bold tabular-nums">{tokensStr}</div>
                </div>
              )}
            </div>
          </SidebarSection>
        )}

        {/* INSPECTOR — paredes/lajes/auditoria (só completed) */}
        {inspectorContent && (
          <SidebarSection icon={Layers} title="Inspeção" defaultOpen>
            {inspectorContent}
          </SidebarSection>
        )}

        {/* PIPELINE AO VIVO — durante processing */}
        {isProcessing && liveContent && (
          <SidebarSection icon={Activity} title="Pipeline ao vivo">
            {liveContent}
          </SidebarSection>
        )}

        {/* ANÁLISE IA */}
        <SidebarSection icon={Info} title="Análise IA" badge={hasBudget ? undefined : "—"}>
          {hasBudget && descriptionContent ? descriptionContent : (
            <div className="text-xs text-muted-foreground italic py-2">
              Descrição IA aparece após o processamento.
            </div>
          )}
        </SidebarSection>

        {/* ARQUIVOS */}
        <SidebarSection icon={FileText} title="Arquivos">
          {filesContent ?? (
            <div className="text-xs text-muted-foreground italic py-2">
              Sem arquivos enviados ainda.
            </div>
          )}
        </SidebarSection>

        {/* ETAPAS — detalhes técnicos */}
        <SidebarSection icon={Layers} title="Etapas técnicas" badge={hasExtractedData ? undefined : "—"}>
          {hasExtractedData && stagesContent ? stagesContent : (
            <div className="text-xs text-muted-foreground italic py-2">
              Dados das etapas aparecem após o processamento.
            </div>
          )}
        </SidebarSection>

        {/* METODOLOGIA */}
        <SidebarSection icon={BookOpen} title="Metodologia" lazy>
          {methodologyContent}
        </SidebarSection>

        {/* EXPORTAR */}
        <SidebarSection icon={Download} title="Exportar" badge={hasBudget ? undefined : "—"}>
          {hasBudget && exportContent ? exportContent : (
            <div className="text-xs text-muted-foreground italic py-2">
              Disponível após o processamento.
            </div>
          )}
        </SidebarSection>

        {/* ZONA DE PERIGO */}
        {onDelete && (
          <SidebarSection icon={AlertTriangle} title="Zona de perigo">
            <Button
              variant="destructive"
              size="sm"
              className="w-full gap-2"
              onClick={onDelete}
              data-testid="sidebar-delete-project"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir projeto
            </Button>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Esta ação não pode ser desfeita.
            </p>
          </SidebarSection>
        )}
      </div>
    </aside>
  );
}
