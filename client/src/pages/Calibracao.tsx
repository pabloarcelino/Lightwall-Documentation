import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useState, Fragment } from "react";
import {
  BarChart3,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Target,
  AlertTriangle,
  CheckCircle2,
  Minus,
  Pencil,
  Save,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Link } from "wouter";
import { LightwallBrand } from "@/components/LightwallLogo";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CategoryData {
  cost: number;
  panels: number;
  area: number;
}

interface CategoryDeviation {
  calcArea: number;
  realArea: number | null;
  deviation: number | null;
  accuracy: number | null;
}

interface ProjectDetail {
  projectId: number;
  projectName: string;
  clientName: string;
  realCost: number;
  calcCost: number;
  originalCalcCost: number | null;
  accuracy: number;
  costAccuracy: number;
  areaAccuracy: number | null;
  deviation: number;
  categories: Record<string, CategoryData>;
  categoryDeviations: Record<string, CategoryDeviation>;
  categoryContributions: Record<string, number>;
  hasRealAreas: boolean;
  hasManualEdits: boolean;
  originalVsEdited: Record<string, unknown> | null;
  apiReliability: { score: number; level: string } | null;
  processedAt: string;
}

interface CategoryStat {
  category: string;
  label: string;
  avgCost: number;
  avgProportion: number;
  avgErrorContribution: number;
  avgAreaDeviation: number | null;
  avgAreaAccuracy: number | null;
  projectsWithZero: number;
  projectsWithRealArea: number;
}

interface CalibrationData {
  hasData: boolean;
  avgAccuracy: number;
  avgCostAccuracy: number;
  avgAreaAccuracy: number | null;
  avgDeviation: number;
  projectCount: number;
  projectsWithAreas: number;
  categories: CategoryStat[];
  patterns: string[];
  projects: ProjectDetail[];
}

const catKeys = ["paredes_externas", "paredes_internas", "muros", "laje_piso", "laje_coberta"] as const;
const categoryLabels: Record<string, string> = {
  paredes_externas: "Par. Externas",
  paredes_internas: "Par. Internas",
  muros: "Muros",
  laje_piso: "Laje Piso",
  laje_coberta: "Laje Coberta",
};
const categoryLabelsFull: Record<string, string> = {
  paredes_externas: "Paredes Externas",
  paredes_internas: "Paredes Internas",
  muros: "Muros",
  laje_piso: "Laje de Piso",
  laje_coberta: "Laje Coberta",
};
const catToApiField: Record<string, string> = {
  paredes_externas: "realAreaExt",
  paredes_internas: "realAreaInt",
  muros: "realAreaMuros",
  laje_piso: "realAreaPiso",
  laje_coberta: "realAreaCoberta",
};

function AccuracyBadge({ accuracy }: { accuracy: number }) {
  const color = accuracy >= 90 ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/20"
    : accuracy >= 70 ? "bg-amber-500/15 text-amber-600 border-amber-500/20"
    : "bg-red-500/15 text-red-600 border-red-500/20";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${color}`}>
      {accuracy.toFixed(1)}%
    </span>
  );
}

function DeviationText({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const color = Math.abs(value) < 5 ? "text-emerald-600" : value > 0 ? "text-amber-600" : "text-blue-600";
  const Icon = Math.abs(value) < 5 ? Minus : value > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {value > 0 ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

export default function Calibracao() {
  const { data: calibration, isLoading } = useQuery<CalibrationData>({
    queryKey: ["/api/calibration"],
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());
  const [editingProject, setEditingProject] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const updateMutation = useMutation({
    mutationFn: async ({ projectId, data }: { projectId: number; data: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/projects/${projectId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calibration"] });
      toast({ title: "Areas reais atualizadas" });
      setEditingProject(null);
    },
    onError: () => {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    },
  });

  function startEdit(proj: ProjectDetail) {
    setEditingProject(proj.projectId);
    const vals: Record<string, string> = {};
    for (const cat of catKeys) {
      const realArea = proj.categoryDeviations?.[cat]?.realArea;
      vals[cat] = realArea !== null && realArea !== undefined && realArea > 0 ? realArea.toString() : "";
    }
    setEditValues(vals);
  }

  function saveEdit(projectId: number) {
    const data: Record<string, unknown> = {};
    for (const cat of catKeys) {
      const val = editValues[cat]?.trim();
      data[catToApiField[cat]] = val ? parseFloat(val) : null;
    }
    updateMutation.mutate({ projectId, data });
  }

  function toggleExpand(projectId: number) {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  return (
    <div className="min-h-screen lw-gradient-bg">
      <header className="glass-header border-b border-white/20 dark:border-white/5 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <LightwallBrand />
            <Link href="/">
              <Button variant="outline" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="h-6 w-6 lw-text-accent" />
          <div>
            <h1 className="text-2xl font-bold">Calibracao do Sistema</h1>
            <p className="text-sm text-muted-foreground">Acuracia por m² — comparacao entre area calculada e area real por tipo de elemento</p>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Carregando dados de calibracao...</div>
        ) : !calibration?.hasData ? (
          <Card>
            <CardContent className="text-center py-16">
              <Target className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground mb-2">Nenhum dado de calibracao disponivel</p>
              <p className="text-sm text-muted-foreground">Processe projetos do tipo "Teste" e informe o m² real por categoria.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">

            {/* === RESUMO === */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="glass-card">
                <CardContent className="pt-5 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Acuracia Media (m²)</p>
                  {calibration.avgAreaAccuracy !== null ? (
                    <p className={`text-3xl font-bold ${calibration.avgAreaAccuracy >= 90 ? "text-emerald-600" : calibration.avgAreaAccuracy >= 70 ? "text-amber-600" : "text-red-600"}`}>
                      {calibration.avgAreaAccuracy.toFixed(1)}%
                    </p>
                  ) : (
                    <p className="text-2xl font-bold text-muted-foreground">—</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">{calibration.projectsWithAreas} projeto(s)</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardContent className="pt-5 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Projetos Analisados</p>
                  <p className="text-3xl font-bold">{calibration.projectCount}</p>
                  <p className="text-xs text-muted-foreground mt-1">tipo teste</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardContent className="pt-5 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Com Areas Reais</p>
                  <p className="text-2xl font-bold">{calibration.projectsWithAreas}</p>
                  <p className="text-xs text-muted-foreground mt-1">de {calibration.projectCount}</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardContent className="pt-5">
                  <p className="text-xs text-muted-foreground mb-2">Padroes</p>
                  {calibration.patterns.length > 0 ? (
                    <div className="space-y-1">
                      {calibration.patterns.slice(0, 3).map((p, i) => (
                        <p key={i} className="text-[10px] text-muted-foreground flex items-start gap-1">
                          <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                          {p}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      Nenhum padrao anomalo
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* === ACURACIA POR CATEGORIA === */}
            {calibration.categories.length > 0 && calibration.projectsWithAreas > 0 && (
              <Card className="glass-panel">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Acuracia Media por Categoria (m²)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2.5">
                    {calibration.categories.map(cat => {
                      const hasData = cat.avgAreaAccuracy !== null;
                      const barWidth = hasData ? Math.min(cat.avgAreaAccuracy!, 100) : 0;
                      const barColor = !hasData ? "bg-muted/40" : cat.avgAreaAccuracy! >= 90 ? "bg-emerald-500/70" : cat.avgAreaAccuracy! >= 70 ? "bg-amber-500/70" : "bg-red-500/70";
                      return (
                        <div key={cat.category} className="flex items-center gap-3">
                          <span className="text-sm w-28 text-muted-foreground">{categoryLabelsFull[cat.category]}</span>
                          <div className="flex-1 h-6 bg-muted/30 rounded-full overflow-hidden relative">
                            {hasData && <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${barWidth}%` }} />}
                            <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium">
                              {hasData ? `${cat.avgAreaAccuracy!.toFixed(1)}%` : "sem m² real"}
                            </span>
                          </div>
                          <div className="w-20 text-right">
                            <DeviationText value={cat.avgAreaDeviation} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* === COMPARATIVO POR PROJETO === */}
            <Card className="glass-panel">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Comparativo por Projeto — m² Calculado vs Real</CardTitle>
                <p className="text-xs text-muted-foreground">Clique no projeto para expandir. Use o botao de edicao para informar o m² real.</p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-muted/30 text-left">
                        <th className="px-4 py-3 font-medium text-muted-foreground">Projeto</th>
                        {catKeys.map(cat => (
                          <th key={cat} className="px-2 py-3 font-medium text-muted-foreground text-center text-[11px]">{categoryLabels[cat]}</th>
                        ))}
                        <th className="px-3 py-3 font-medium text-muted-foreground text-center">Acuracia</th>
                        <th className="px-3 py-3 font-medium text-muted-foreground text-center w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {calibration.projects.map(proj => {
                        const isExpanded = expandedProjects.has(proj.projectId);
                        const isEditing = editingProject === proj.projectId;
                        return (
                          <Fragment key={proj.projectId}>
                            <tr
                              className="border-b border-muted/15 hover:bg-muted/10 cursor-pointer"
                              onClick={() => !isEditing && toggleExpand(proj.projectId)}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5">
                                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                                  <Link href={`/project/${proj.projectId}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                    <span className="font-medium hover:underline text-xs">{proj.projectName}</span>
                                  </Link>
                                  {proj.hasManualEdits && (
                                    <Badge variant="outline" className="text-[8px] px-1 py-0 text-violet-600 border-violet-500/30">
                                      <Pencil className="h-2 w-2" />
                                    </Badge>
                                  )}
                                </div>
                              </td>
                              {catKeys.map(cat => {
                                const cd = proj.categoryDeviations?.[cat];
                                const calcArea = cd?.calcArea || 0;
                                const realArea = cd?.realArea;
                                const hasReal = realArea !== null && realArea !== undefined && realArea > 0;
                                return (
                                  <td key={cat} className="px-2 py-3 text-center" onClick={e => isEditing && e.stopPropagation()}>
                                    {isEditing ? (
                                      <div className="space-y-0.5">
                                        <p className="text-[10px] text-muted-foreground font-mono">{calcArea.toFixed(1)}</p>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          placeholder="m² real"
                                          className="h-7 text-xs text-center w-20 mx-auto"
                                          value={editValues[cat] || ""}
                                          onChange={e => setEditValues(prev => ({ ...prev, [cat]: e.target.value }))}
                                        />
                                      </div>
                                    ) : (
                                      <div>
                                        <p className="text-xs font-mono">{calcArea.toFixed(1)}</p>
                                        {hasReal ? (
                                          <p className="text-[10px] text-muted-foreground">real: {realArea!.toFixed(1)}</p>
                                        ) : (
                                          <p className="text-[10px] text-muted-foreground/50">—</p>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="px-3 py-3 text-center">
                                <AccuracyBadge accuracy={proj.accuracy} />
                              </td>
                              <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
                                {isEditing ? (
                                  <div className="flex items-center gap-1 justify-center">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7 text-emerald-600 hover:text-emerald-700"
                                      onClick={() => saveEdit(proj.projectId)}
                                      disabled={updateMutation.isPending}
                                    >
                                      <Save className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7 text-muted-foreground"
                                      onClick={() => setEditingProject(null)}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    onClick={() => startEdit(proj)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </td>
                            </tr>
                            {isExpanded && !isEditing && (
                              <tr className="bg-muted/5">
                                <td colSpan={catKeys.length + 3} className="px-4 py-4">
                                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                    {catKeys.map(cat => {
                                      const cd = proj.categoryDeviations?.[cat];
                                      const hasReal = cd?.realArea !== null && cd?.realArea !== undefined && (cd?.realArea ?? 0) > 0;
                                      return (
                                        <div key={cat} className="bg-muted/20 rounded-lg p-3 text-center">
                                          <p className="text-[10px] text-muted-foreground mb-1.5 font-medium">{categoryLabelsFull[cat]}</p>
                                          <div className="space-y-1">
                                            <div className="flex items-center justify-between text-xs px-1">
                                              <span className="text-muted-foreground">Calc:</span>
                                              <span className="font-mono font-medium">{(cd?.calcArea || 0).toFixed(1)} m²</span>
                                            </div>
                                            <div className="flex items-center justify-between text-xs px-1">
                                              <span className="text-muted-foreground">Real:</span>
                                              <span className="font-mono font-medium">{hasReal ? `${cd!.realArea!.toFixed(1)} m²` : "—"}</span>
                                            </div>
                                            {hasReal && (
                                              <>
                                                <div className="pt-1 border-t border-muted/30">
                                                  <p className={`text-sm font-bold ${cd!.accuracy! >= 90 ? "text-emerald-600" : cd!.accuracy! >= 70 ? "text-amber-600" : "text-red-600"}`}>
                                                    {cd!.accuracy!.toFixed(1)}%
                                                  </p>
                                                  <DeviationText value={cd!.deviation} />
                                                </div>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* === HISTORICO === */}
            <Card className="glass-panel">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Historico de Acuracia (m²)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2.5">
                  {[...calibration.projects].sort((a, b) => new Date(a.processedAt).getTime() - new Date(b.processedAt).getTime()).map(proj => {
                    const barWidth = Math.min(proj.accuracy, 100);
                    const barColor = proj.accuracy >= 90 ? "bg-emerald-500/70" : proj.accuracy >= 70 ? "bg-amber-500/70" : "bg-red-500/70";
                    return (
                      <div key={proj.projectId} className="flex items-center gap-3">
                        <div className="w-36 text-xs text-muted-foreground truncate">{proj.projectName}</div>
                        <div className="flex-1 h-5 bg-muted/30 rounded-full overflow-hidden relative">
                          <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${barWidth}%` }} />
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium">
                            {proj.accuracy.toFixed(1)}%
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground w-20 text-right">
                          {new Date(proj.processedAt).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

          </div>
        )}
      </main>
    </div>
  );
}
