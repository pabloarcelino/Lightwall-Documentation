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

interface VdCategoryGlobal {
  key: CatKey;
  label: string;
  accuracy: number | null;
  projectCount: number;
  totalRealArea: number;
  totalCalcArea: number;
  deviation: number | null;
}

interface VdCalibrationData {
  hasData: boolean;
  globalAccuracy: number | null;
  projectCount: number;
  categoriesGlobal: VdCategoryGlobal[];
  projects: VdProject[];
}

const CATEGORY_ORDER: CatKey[] = [
  "paredes_externas",
  "paredes_internas",
  "muros",
  "laje_piso",
  "laje_coberta",
];

function fmtM2(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} m²`;
}

// ---------- Helpers de UI ----------

function accuracyTone(accuracy: number | null | undefined): "success" | "warning" | "error" | "neutral" {
  if (accuracy == null) return "neutral";
  if (accuracy >= 50) return "success";
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
          <section data-testid="card-calibration-vd" className="space-y-4">
            <div className="flex items-end justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Precisão do motor Visão Direta
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Comparação m² extraído × m² real informado nos projetos teste
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Hero da acuracia global */}
              <HeroAccuracyCard
                accuracy={calibration.globalAccuracy}
                projectCount={calibration.projectCount}
                categoriesEvaluated={calibration.categoriesGlobal.filter(c => c.accuracy != null).length}
              />

              {/* Grid de categorias */}
              <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {CATEGORY_ORDER.map(key => {
                  const cat = calibration.categoriesGlobal.find(c => c.key === key);
                  if (!cat) return null;
                  return <CategoryAccuracyCard key={key} cat={cat} />;
                })}
              </div>
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

function HeroAccuracyCard({
  accuracy,
  projectCount,
  categoriesEvaluated,
}: {
  accuracy: number | null;
  projectCount: number;
  categoriesEvaluated: number;
}) {
  const tone = accuracyTone(accuracy);
  const ringTone =
    tone === "success" ? "from-success/30 to-success/0" :
    tone === "warning" ? "from-warning/30 to-warning/0" :
    tone === "error"   ? "from-error/30 to-error/0"     :
    "from-muted-foreground/20 to-muted-foreground/0";
  return (
    <div className="lg:col-span-5 rounded-xl border border-card-border bg-card shadow-xs overflow-hidden relative">
      <div className={cn("absolute inset-0 bg-gradient-to-br pointer-events-none", ringTone)} />
      <div className="relative p-6 flex flex-col h-full">
        <div className="flex items-center gap-2 text-xs font-medium tracking-wide uppercase text-muted-foreground">
          <Target className="h-3.5 w-3.5" />
          Acurácia global ponderada
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <span
            className={cn("text-6xl font-extrabold tracking-tight tabular-nums", toneTextClasses[tone])}
            data-testid="text-cal-global-accuracy"
          >
            {accuracy == null ? "N/A" : accuracy.toFixed(1)}
          </span>
          {accuracy != null && <span className={cn("text-2xl font-bold", toneTextClasses[tone])}>%</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
          Média de todas as categorias avaliadas, ponderada pela área real (m²) de cada uma.
        </p>
        <div className="mt-auto pt-4 grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Projetos teste</div>
            <div className="text-xl font-bold mt-0.5" data-testid="text-cal-project-count">{projectCount}</div>
          </div>
          <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Categorias</div>
            <div className="text-xl font-bold mt-0.5" data-testid="text-cal-categories-count">
              {categoriesEvaluated}<span className="text-sm text-muted-foreground"> / 5</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryAccuracyCard({ cat }: { cat: VdCategoryGlobal }) {
  const tone = accuracyTone(cat.accuracy);
  const noData = cat.accuracy == null;
  const dotTone =
    tone === "success" ? "bg-success" :
    tone === "warning" ? "bg-warning" :
    tone === "error"   ? "bg-error"   :
    "bg-muted-foreground/40";
  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-xs p-3.5 flex flex-col gap-2 transition-shadow hover:shadow-md",
        noData ? "border-card-border opacity-70" : "border-card-border",
      )}
      data-testid={`cal-category-${cat.key}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn("h-2 w-2 rounded-full shrink-0", dotTone)} />
          <span className="text-xs font-medium text-foreground truncate">{cat.label}</span>
        </div>
        {!noData && (
          <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
            {cat.projectCount}p
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1">
        <span className={cn("text-2xl font-bold tabular-nums", toneTextClasses[tone])}>
          {noData ? "—" : cat.accuracy!.toFixed(1)}
        </span>
        {!noData && <span className={cn("text-xs font-semibold", toneTextClasses[tone])}>%</span>}
      </div>

      {!noData && (
        <div className="pt-1 border-t border-border/60 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
          <span className="text-muted-foreground">Extraído</span>
          <span className="text-right font-mono tabular-nums">{fmtM2(cat.totalCalcArea)}</span>
          <span className="text-muted-foreground">Real</span>
          <span className="text-right font-mono tabular-nums">{fmtM2(cat.totalRealArea)}</span>
          {cat.deviation != null && (
            <>
              <span className="text-muted-foreground">Desvio</span>
              <span
                className={cn(
                  "text-right font-mono tabular-nums",
                  cat.deviation > 0 ? "text-warning" : cat.deviation < 0 ? "text-info" : "",
                )}
              >
                {cat.deviation > 0 ? "+" : ""}{cat.deviation.toFixed(1)}%
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
