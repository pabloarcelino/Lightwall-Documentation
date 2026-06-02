import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  FolderOpen,
  CheckCircle2,
  Trash2,
  Target,
  FlaskConical,
  BarChart3,
  ArrowRight,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";
import type { Project } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

type ProjectWithBudget = Project & { budgetTotalCost: number | null };

type CatKey = "paredes_externas" | "paredes_internas" | "muros" | "laje_piso" | "laje_coberta";

interface CategoryAccuracy {
  calc: number;
  real: number | null;
  deviation: number | null;
  accuracy: number | null;
}

interface VdProject {
  projectId: number;
  projectName: string;
  clientName: string | null;
  overallAccuracy: number | null;
  categories: Record<CatKey, CategoryAccuracy>;
}

interface VdCalibrationData {
  hasData: boolean;
  globalAccuracy: number | null;
  projectCount: number;
  categoriesGlobal: Array<{
    key: CatKey;
    label: string;
    accuracy: number | null;
    projectCount: number;
    totalRealArea: number;
  }>;
  projects: VdProject[];
}

// ---------- Helpers de UI ----------

function accuracyTone(accuracy: number | null | undefined): "success" | "warning" | "error" | "neutral" {
  if (accuracy == null) return "neutral";
  if (accuracy >= 90) return "success";
  if (accuracy >= 75) return "warning";
  return "error";
}

const toneClasses: Record<"success" | "warning" | "error" | "neutral" | "info", string> = {
  success: "bg-success-soft text-success border-success/20",
  warning: "bg-warning-soft text-warning border-warning/20",
  error:   "bg-error-soft text-error border-error/20",
  info:    "bg-info-soft text-info border-info/20",
  neutral: "bg-muted text-muted-foreground border-border",
};

const toneTextClasses: Record<"success" | "warning" | "error" | "neutral" | "info", string> = {
  success: "text-success",
  warning: "text-warning",
  error:   "text-error",
  info:    "text-info",
  neutral: "text-muted-foreground",
};

function projectStatusBadge(status: string | null | undefined) {
  switch (status) {
    case "completed":
      return { label: "Concluído", tone: "success" as const };
    case "processing":
      return { label: "Processando", tone: "info" as const };
    case "error":
      return { label: "Erro", tone: "error" as const };
    default:
      return { label: "Rascunho", tone: "neutral" as const };
  }
}

// ---------- Componentes locais ----------

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  Icon: typeof FolderOpen;
  tone?: "default" | "success" | "warning" | "error";
}

function StatCard({ label, value, hint, Icon, tone = "default" }: StatCardProps) {
  const valueTone =
    tone === "success" ? "text-success" :
    tone === "warning" ? "text-warning" :
    tone === "error"   ? "text-error"   :
    "text-foreground";

  return (
    <div className="relative overflow-hidden rounded-xl border border-card-border bg-card p-5 shadow-xs transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide uppercase text-muted-foreground">{label}</span>
        <span className="rounded-md p-1.5 bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className={cn("mt-3 text-3xl font-bold tracking-tight", valueTone)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

// ---------- Página ----------

export default function Dashboard() {
  const { data: projects, isLoading } = useQuery<ProjectWithBudget[]>({ queryKey: ["/api/projects"] });
  const { data: calibration } = useQuery<VdCalibrationData>({ queryKey: ["/api/calibration-vd"] });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Projeto excluído", description: "O projeto foi removido com sucesso" });
      qc.invalidateQueries({ queryKey: ["/api/projects"] });
      qc.invalidateQueries({ queryKey: ["/api/calibration-vd"] });
      setPendingDelete(null);
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao excluir projeto", description: err.message, variant: "destructive" });
      setPendingDelete(null);
    },
  });

  const completedCount = projects?.filter(p => p.status === "completed").length ?? 0;
  const testCount = projects?.filter(p => p.projectType === "teste").length ?? 0;
  const globalAccuracy = calibration?.globalAccuracy ?? null;
  const globalTone = accuracyTone(globalAccuracy);

  return (
    <div className="lw-gradient-bg min-h-full">
      <PageHeader
        title="Dashboard"
        description="Visão geral dos seus orçamentos e da precisão do motor Visão Direta"
        actions={
          <div className="flex items-center gap-2">
            <Link href="/vision-direct">
              <Button variant="outline" className="gap-1.5" data-testid="button-vision-direct">
                <Sparkles className="h-4 w-4 text-warning" /> Modo Visão Direta
                <span className="text-[9px] uppercase tracking-wider font-semibold text-warning bg-warning/15 px-1 py-0.5 rounded">
                  EXP
                </span>
              </Button>
            </Link>
            <Link href="/new-project">
              <Button className="gap-1.5" data-testid="button-new-project">
                <Plus className="h-4 w-4" /> Novo projeto
              </Button>
            </Link>
          </div>
        }
      />

      <div className="container py-8 space-y-8">
        {/* Stats */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Total de projetos"
            value={<span data-testid="text-total-projects">{projects?.length ?? 0}</span>}
            Icon={FolderOpen}
          />
          <StatCard
            label="Concluídos"
            value={<span data-testid="text-completed-count">{completedCount}</span>}
            Icon={CheckCircle2}
          />
          <StatCard
            label="Projetos teste"
            value={<span data-testid="text-test-count">{testCount}</span>}
            Icon={FlaskConical}
          />
          <StatCard
            label="Acurácia global (m²)"
            value={
              globalAccuracy == null ? (
                <span className="text-muted-foreground text-2xl" data-testid="text-global-accuracy">N/A</span>
              ) : (
                <span data-testid="text-global-accuracy">{globalAccuracy.toFixed(1)}%</span>
              )
            }
            hint={calibration?.hasData ? `${calibration.projectCount} projeto(s) teste` : undefined}
            Icon={Target}
            tone={globalTone === "neutral" ? "default" : globalTone}
          />
        </section>

        {/* Precisao por categoria (Vision Direta) */}
        {calibration?.hasData && (
          <section
            className="rounded-xl border border-card-border bg-card shadow-xs overflow-hidden"
            data-testid="card-calibration-vd"
          >
            <div className="px-6 py-5 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Precisão do motor Visão Direta
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Acurácia ponderada por área real (m²) — apenas projetos teste com valores informados
                </p>
              </div>
              <Link href="/calibracao">
                <Button variant="outline" size="sm" className="gap-1" data-testid="button-calibration-details">
                  Detalhes <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <CalKpi
                  label="Acurácia global (m²)"
                  value={calibration.globalAccuracy}
                  formatter={v => `${v.toFixed(1)}%`}
                  tone={accuracyTone(calibration.globalAccuracy)}
                  testId="text-cal-global-accuracy"
                />
                <CalKpi
                  label="Categorias avaliadas"
                  value={calibration.categoriesGlobal.filter(c => c.accuracy != null).length}
                  formatter={v => `${v} / 5`}
                  tone="neutral"
                  testId="text-cal-categories-count"
                />
                <CalKpi
                  label="Projetos teste"
                  value={calibration.projectCount}
                  formatter={v => String(v)}
                  tone="neutral"
                  testId="text-cal-project-count"
                />
              </div>

              {calibration.categoriesGlobal.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-2">
                    Precisão por categoria (m²)
                  </h3>
                  <div className="space-y-1.5">
                    {calibration.categoriesGlobal.map(cat => {
                      const barWidth = cat.accuracy ?? 0;
                      const tone = accuracyTone(cat.accuracy);
                      const barTone =
                        tone === "success" ? "bg-success/70" :
                        tone === "warning" ? "bg-warning/70" :
                        tone === "error"   ? "bg-error/70"   :
                        "bg-muted-foreground/40";
                      return (
                        <div key={cat.key} className="flex items-center gap-3" data-testid={`cal-category-${cat.key}`}>
                          <span className="text-xs w-36 text-muted-foreground truncate">{cat.label}</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div className={cn("h-full rounded-full", barTone)} style={{ width: `${Math.min(barWidth, 100)}%` }} />
                          </div>
                          <span className={cn("text-xs font-medium w-28 text-right", toneTextClasses[tone])}>
                            {cat.accuracy == null
                              ? "—"
                              : `${cat.accuracy.toFixed(1)}% (${cat.projectCount}p)`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Lista de projetos */}
        <section className="rounded-xl border border-card-border bg-card shadow-xs overflow-hidden">
          <div className="px-6 py-5 border-b border-border">
            <h2 className="text-lg font-semibold">Projetos recentes</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Clique em um projeto para visualizar detalhes e orçamento
            </p>
          </div>

          <div>
            {isLoading ? (
              <div className="p-6">
                <LoadingState
                  title="Carregando projetos"
                  message="Aguarde enquanto buscamos sua lista de orçamentos..."
                  testId="state-loading-projects"
                />
              </div>
            ) : projects && projects.length > 0 ? (
              <ul className="divide-y divide-border">
                {projects.map(project => {
                  const status = projectStatusBadge(project.status);
                  const vdProj = calibration?.projects.find(p => p.projectId === project.id);
                  const accuracy = vdProj?.overallAccuracy ?? null;
                  const accTone = accuracyTone(accuracy);

                  return (
                    <li
                      key={project.id}
                      className="group hover:bg-accent/40 transition-colors"
                      data-testid={`card-project-${project.id}`}
                    >
                      <div className="flex items-center gap-3 px-6 py-4">
                        <Link href={`/project/${project.id}`} className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3
                              className="text-base font-semibold text-foreground group-hover:text-primary transition-colors"
                              data-testid={`text-project-name-${project.id}`}
                            >
                              {project.name}
                            </h3>
                            {project.projectType === "teste" && (
                              <Badge
                                variant="outline"
                                className="bg-warning-soft text-warning border-warning/30 font-bold text-[10px] tracking-wider"
                                data-testid={`badge-teste-${project.id}`}
                              >
                                TESTE
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                            {project.clientName && <span>Cliente: <strong className="font-medium text-foreground/80">{project.clientName}</strong></span>}
                            <span>
                              Criado em {project.createdAt ? new Date(project.createdAt).toLocaleDateString("pt-BR") : "N/A"}
                            </span>
                          </div>
                        </Link>

                        <div className="flex items-center gap-2 shrink-0">
                          {accuracy != null && project.projectType === "teste" && (
                            <Badge
                              variant="outline"
                              className={cn("gap-1 text-xs font-semibold border", toneClasses[accTone])}
                              data-testid={`accuracy-project-${project.id}`}
                            >
                              <Target className="h-3 w-3" />
                              {accuracy.toFixed(1)}% (m²)
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={cn("text-xs border", toneClasses[status.tone])}
                            data-testid={`status-project-${project.id}`}
                          >
                            {status.tone === "info" && deleteMutation.isPending === false ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : null}
                            {status.label}
                          </Badge>

                          <AlertDialog
                            open={pendingDelete === project.id}
                            onOpenChange={open => setPendingDelete(open ? project.id : null)}
                          >
                            <AlertDialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-muted-foreground hover:text-error hover:bg-error-soft"
                                aria-label="Excluir projeto"
                                onClick={e => e.stopPropagation()}
                                data-testid={`button-delete-${project.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Excluir projeto?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Esta ação remove o projeto <strong>{project.name}</strong> e seus arquivos
                                  associados. Não é possível desfazer.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel data-testid={`button-cancel-delete-${project.id}`}>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(project.id)}
                                  disabled={deleteMutation.isPending}
                                  className="bg-error text-error-foreground hover:bg-error/90"
                                  data-testid={`button-confirm-delete-${project.id}`}
                                >
                                  {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-10">
                <EmptyState
                  icon={<FolderOpen className="h-12 w-12 text-primary/40" aria-hidden />}
                  title="Nenhum projeto encontrado"
                  message="Comece criando seu primeiro orçamento a partir de uma planta arquitetônica."
                  testId="state-empty-projects"
                  action={
                    <Link href="/new-project">
                      <Button data-testid="button-create-first">
                        <Plus className="h-4 w-4 mr-2" />
                        Criar primeiro projeto
                      </Button>
                    </Link>
                  }
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------- Auxiliares ----------

function CalKpi({
  label,
  value,
  formatter,
  tone,
  testId,
}: {
  label: string;
  value: number | null;
  formatter: (v: number) => string;
  tone: "success" | "warning" | "error" | "neutral";
  testId?: string;
}) {
  const isNa = value == null;
  return (
    <div className="rounded-lg border border-border bg-background p-4 text-center">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className={cn("text-2xl font-bold", isNa ? "text-muted-foreground" : toneTextClasses[tone])} data-testid={testId}>
        {isNa ? "N/A" : formatter(value!)}
      </div>
    </div>
  );
}
