import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, FolderOpen, Calendar, CheckCircle, Settings, Trash2, BookOpen, Package, LogOut, User, Target, FlaskConical, TrendingUp, TrendingDown, BarChart3, ArrowRight, Users, HelpCircle } from "lucide-react";
import { Link } from "wouter";
import type { Project } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { LightwallBrand } from "@/components/LightwallLogo";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/ui/states";
import { queryClient } from "@/lib/queryClient";

type ProjectWithBudget = Project & { budgetTotalCost: number | null };

interface CalibrationData {
  hasData: boolean;
  avgAccuracy: number | null;
  avgAreaAccuracy: number | null;
  avgDeviation: number | null;
  projectCount: number;
  categories: Array<{ category: string; label: string; avgCost: number; avgProportion: number; avgErrorContribution: number; projectsWithZero: number }>;
  patterns: string[];
  projects: Array<{
    projectId: number;
    projectName: string;
    realCost: number;
    calcCost: number;
    accuracy: number;
    areaAccuracy: number | null;
    deviation: number;
  }>;
}

export default function Dashboard() {
  const { data: projects, isLoading } = useQuery<ProjectWithBudget[]>({
    queryKey: ["/api/projects"],
  });
  const { data: currentUser } = useQuery<{ username: string; displayName: string | null; role: string }>({
    queryKey: ["/api/auth/me"],
  });
  const { data: calibration } = useQuery<CalibrationData>({
    queryKey: ["/api/calibration"],
  });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    queryClient.setQueryData(["/api/auth/me"], null);
    queryClient.invalidateQueries();
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erro ao excluir");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Projeto excluido", description: "O projeto foi removido com sucesso" });
      qc.invalidateQueries({ queryKey: ["/api/projects"] });
      setDeletingId(null);
    },
    onError: () => {
      toast({ title: "Erro", description: "Erro ao excluir projeto", variant: "destructive" });
      setDeletingId(null);
    },
  });

  return (
    <div className="min-h-screen lw-gradient-bg">
      <PageHeader>
        <div className="flex items-center justify-between">
          <LightwallBrand />
          <div className="flex gap-2">
            <Link href="/guia">
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-[hsl(189,100%,42%)] dark:hover:text-[hsl(189,100%,50%)]" data-testid="button-guia">
                <HelpCircle className="h-4 w-4" />
                Guia
              </Button>
            </Link>
            <Link href="/catalogo">
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-[hsl(189,100%,42%)] dark:hover:text-[hsl(189,100%,50%)]" data-testid="button-catalogo">
                <Package className="h-4 w-4" />
                Catalogo
              </Button>
            </Link>
            <Link href="/metodologia">
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-[hsl(189,100%,42%)] dark:hover:text-[hsl(189,100%,50%)]" data-testid="button-metodologia">
                <BookOpen className="h-4 w-4" />
                Metodologia
              </Button>
            </Link>
            <Link href="/settings">
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-[hsl(189,100%,42%)] dark:hover:text-[hsl(189,100%,50%)]" data-testid="button-settings">
                <Settings className="h-4 w-4" />
                Config
              </Button>
            </Link>
            {currentUser?.role === "admin" && (
              <Link href="/usuarios">
                <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-[hsl(189,100%,42%)] dark:hover:text-[hsl(189,100%,50%)]" data-testid="button-usuarios">
                  <Users className="h-4 w-4" />
                  Usuarios
                </Button>
              </Link>
            )}
            <Link href="/new-project">
              <Button size="sm" className="gap-2" data-testid="button-new-project">
                <Plus className="h-4 w-4" />
                Novo Projeto
              </Button>
            </Link>
            <div className="w-px h-6 bg-border mx-1" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:inline" data-testid="text-current-user">
                <User className="h-3 w-3 inline mr-1" />
                {currentUser?.displayName || currentUser?.username || ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                aria-label="Sair"
                className="text-muted-foreground hover:text-red-500"
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </PageHeader>

      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="glass-stat rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">Total de Projetos</span>
              <FolderOpen className="h-4 w-4 lw-text-accent opacity-60" />
            </div>
            <div className="text-3xl font-bold" data-testid="text-total-projects">{projects?.length || 0}</div>
          </div>
          <div className="glass-stat rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">Concluidos</span>
              <CheckCircle className="h-4 w-4 lw-text-accent opacity-60" />
            </div>
            <div className="text-3xl font-bold" data-testid="text-completed-count">
              {projects?.filter((p) => p.status === "completed").length || 0}
            </div>
          </div>
          <div className="glass-stat rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">Projetos Teste</span>
              <FlaskConical className="h-4 w-4 lw-text-accent opacity-60" />
            </div>
            <div className="text-3xl font-bold" data-testid="text-test-count">
              {projects?.filter((p) => p.projectType === "teste").length || 0}
            </div>
          </div>
          <div className="glass-stat rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">Acuracia Global (m²)</span>
              <Target className="h-4 w-4 lw-text-accent opacity-60" />
            </div>
            {(() => {
              if (!calibration?.hasData || calibration.avgAreaAccuracy == null) {
                return <div className="text-xl font-bold text-muted-foreground" data-testid="text-global-accuracy">N/A</div>;
              }
              const avg = calibration.avgAreaAccuracy;
              return (
                <div>
                  <div className={`text-3xl font-bold ${avg >= 90 ? "text-emerald-600" : avg >= 70 ? "text-amber-600" : "text-red-600"}`} data-testid="text-global-accuracy">
                    {avg.toFixed(1)}%
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{calibration.projectCount} projeto(s) teste</p>
                </div>
              );
            })()}
          </div>
        </div>

        {calibration?.hasData && (
          <div className="glass-panel rounded-xl border border-white/20 dark:border-white/5 lw-glow" data-testid="card-calibration">
            <div className="px-6 py-5 border-b border-white/10 dark:border-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 lw-text-accent" />
                    Calibracao do Sistema
                  </h2>
                  <p className="text-sm text-muted-foreground">{calibration.projectCount} projeto(s) teste</p>
                </div>
                <Link href="/calibracao">
                  <Button variant="outline" size="sm" className="gap-1" data-testid="button-calibration-details">
                    Detalhes <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Acuracia Media (m²)</p>
                  {calibration.avgAreaAccuracy != null ? (
                    <p className={`text-2xl font-bold ${calibration.avgAreaAccuracy >= 90 ? "text-emerald-600" : calibration.avgAreaAccuracy >= 70 ? "text-amber-600" : "text-red-600"}`} data-testid="text-cal-avg-accuracy">
                      {calibration.avgAreaAccuracy.toFixed(1)}%
                    </p>
                  ) : (
                    <p className="text-2xl font-bold text-muted-foreground" data-testid="text-cal-avg-accuracy">N/A</p>
                  )}
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Desvio Medio</p>
                  {calibration.avgDeviation != null ? (
                    <>
                      <p className="text-2xl font-bold flex items-center justify-center gap-1" data-testid="text-cal-avg-deviation">
                        {calibration.avgDeviation > 0 ? (
                          <TrendingUp className="h-4 w-4 text-amber-600" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-blue-600" />
                        )}
                        <span className={calibration.avgDeviation > 0 ? "text-amber-600" : "text-blue-600"}>
                          {calibration.avgDeviation > 0 ? "+" : ""}{calibration.avgDeviation.toFixed(1)}%
                        </span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">{calibration.avgDeviation > 0 ? "superestimando" : "subestimando"}</p>
                    </>
                  ) : (
                    <p className="text-2xl font-bold text-muted-foreground" data-testid="text-cal-avg-deviation">N/A</p>
                  )}
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Projetos Analisados</p>
                  <p className="text-2xl font-bold" data-testid="text-cal-project-count">{calibration.projectCount}</p>
                </div>
              </div>

              {calibration.categories.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Erro por Categoria (contribuicao media)</p>
                  <div className="space-y-2">
                    {calibration.categories.map(cat => {
                      const maxErr = Math.max(...calibration.categories.map(c => Math.abs(c.avgErrorContribution)));
                      const barWidth = maxErr > 0 ? (Math.abs(cat.avgErrorContribution) / maxErr) * 100 : 0;
                      const isOver = cat.avgErrorContribution > 0;
                      return (
                        <div key={cat.category} className="flex items-center gap-2" data-testid={`cal-category-${cat.category}`}>
                          <span className="text-xs w-28 text-muted-foreground truncate">{cat.label}</span>
                          <div className="flex-1 h-4 bg-muted/30 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${isOver ? "bg-gradient-to-r from-amber-500/60 to-amber-500/30" : "bg-gradient-to-r from-red-500/60 to-red-500/30"}`}
                              style={{ width: `${Math.min(barWidth, 100)}%` }}
                            />
                          </div>
                          <span className={`text-xs font-medium w-20 text-right ${isOver ? "text-amber-500" : "text-red-400"}`}>
                            {isOver ? "+" : ""}R$ {Math.abs(cat.avgErrorContribution).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {calibration.patterns.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Padroes Identificados</p>
                  <div className="space-y-1">
                    {calibration.patterns.slice(0, 3).map((pattern, i) => (
                      <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5" data-testid={`cal-pattern-${i}`}>
                        <span className="text-amber-500 mt-0.5">•</span>
                        {pattern}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="glass-panel rounded-xl border border-white/20 dark:border-white/5 lw-glow">
          <div className="px-6 py-5 border-b border-white/10 dark:border-white/5">
            <h2 className="text-lg font-semibold">Projetos Recentes</h2>
            <p className="text-sm text-muted-foreground">Clique em um projeto para visualizar detalhes e orcamento</p>
          </div>
          <div className="p-6">
            {isLoading ? (
              <LoadingState
                title="Carregando projetos"
                message="Aguarde enquanto buscamos sua lista de orcamentos..."
                testId="state-loading-projects"
              />
            ) : projects && projects.length > 0 ? (
              <div className="space-y-3">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="glass-card rounded-xl overflow-hidden"
                    data-testid={`card-project-${project.id}`}
                  >
                    <div className="flex items-center justify-between p-5">
                      <Link href={`/project/${project.id}`} className="flex-1 cursor-pointer">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-semibold" data-testid={`text-project-name-${project.id}`}>
                              {project.name}
                            </h3>
                            {project.projectType === "teste" && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-600 border border-amber-500/30" data-testid={`badge-teste-${project.id}`}>
                                TESTE
                              </span>
                            )}
                          </div>
                          {project.clientName && (
                            <p className="text-sm text-muted-foreground">Cliente: {project.clientName}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Criado em: {project.createdAt ? new Date(project.createdAt).toLocaleDateString("pt-BR") : "N/A"}
                          </p>
                        </div>
                      </Link>
                      <div className="flex items-center gap-3">
                        {project.projectType === "teste" && calibration?.projects && (() => {
                          const calProj = calibration.projects.find(p => p.projectId === project.id);
                          if (!calProj) return null;
                          if (calProj.areaAccuracy === null) return null;
                          const accuracy = calProj.areaAccuracy;
                          return (
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-bold ${accuracy >= 90 ? "bg-emerald-500/15 text-emerald-600" : accuracy >= 70 ? "bg-amber-500/15 text-amber-600" : "bg-red-500/15 text-red-600"}`}
                              data-testid={`accuracy-project-${project.id}`}
                            >
                              <Target className="h-3 w-3 inline mr-1" />
                              {accuracy.toFixed(1)}% (m²)
                            </span>
                          );
                        })()}
                        <span
                          data-testid={`status-project-${project.id}`}
                          className={`px-3 py-1 rounded-full text-xs font-medium backdrop-blur-sm ${
                            project.status === "completed"
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                              : project.status === "processing"
                                ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20"
                                : project.status === "error"
                                  ? "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20"
                                  : "bg-gray-500/15 text-gray-600 dark:text-gray-400 border border-gray-500/20"
                          }`}
                        >
                          {project.status === "completed" ? "Concluido" : project.status === "processing" ? "Processando" : project.status === "error" ? "Erro" : "Rascunho"}
                        </span>
                        {deletingId === project.id ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteMutation.mutate(project.id); }}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-confirm-delete-${project.id}`}
                            >
                              {deleteMutation.isPending ? "..." : "Sim"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeletingId(null); }}
                              data-testid={`button-cancel-delete-${project.id}`}
                            >
                              Nao
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeletingId(project.id); }}
                            data-testid={`button-delete-${project.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<FolderOpen className="h-12 w-12 mb-3 lw-text-accent opacity-40" aria-hidden="true" />}
                title="Nenhum projeto encontrado"
                message=""
                testId="state-empty-projects"
                action={
                  <Link href="/new-project">
                    <Button data-testid="button-create-first">
                      <Plus className="h-4 w-4 mr-2" />
                      Criar Primeiro Projeto
                    </Button>
                  </Link>
                }
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
