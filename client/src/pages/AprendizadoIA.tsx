import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/ui/states";
import { Link } from "wouter";
import { ArrowLeft, GraduationCap, Sparkles, Trash2, Power, PowerOff, CheckCircle2, AlertTriangle } from "lucide-react";
import { LightwallBrand } from "@/components/LightwallLogo";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface WallFeedbackRow {
  id: number;
  projectId: number | null;
  userId: number | null;
  wallId: string;
  nivel: string | null;
  espessuraBucketCm: number | null;
  comprimentoBucketDm: number | null;
  hasWindow: boolean | null;
  hasDoor: boolean | null;
  reviewReasonBucket: string | null;
  originalClasse: string | null;
  correctedClasse: string | null;
  action: string;
  isExemplar: boolean;
  notes: string | null;
  active: boolean;
  createdAt: string;
}

interface FeedbackStats {
  counts: { total: number; active: number; confirm: number; correct: number; not_wall: number; exemplar: number };
  topPatterns: Array<{ espessuraBucketCm: number | null; comprimentoBucketDm: number | null; originalClasse: string | null; correctedClasse: string | null; count: number }>;
  classificationAccuracy: number | null;
  classificationSample: { totalWalls: number; unchangedWalls: number; projectsCompared: number };
  perProject: Array<{ projectId: number; projectName: string; total: number; unchanged: number; accuracy: number }>;
}

function actionBadge(a: string, exemplar: boolean) {
  if (exemplar) return <Badge className="bg-violet-500/15 text-violet-700 border-violet-500/30 gap-1"><Sparkles className="h-3 w-3" /> exemplo</Badge>;
  if (a === "confirm") return <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3" /> confirmar</Badge>;
  if (a === "correct") return <Badge variant="default">corrigir</Badge>;
  if (a === "not_wall") return <Badge variant="destructive">nao_parede</Badge>;
  return <Badge variant="secondary">{a}</Badge>;
}

export default function AprendizadoIA() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: stats, isLoading: loadingStats } = useQuery<FeedbackStats>({ queryKey: ["/api/wall-feedback/stats"] });
  const { data: rows, isLoading: loadingRows } = useQuery<WallFeedbackRow[]>({ queryKey: ["/api/wall-feedback"] });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const r = await apiRequest("PATCH", `/api/wall-feedback/${id}/active`, { active });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/wall-feedback"] });
      qc.invalidateQueries({ queryKey: ["/api/wall-feedback/stats"] });
      toast({ title: "Atualizado" });
    },
    onError: () => toast({ title: "Erro ao atualizar", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("DELETE", `/api/wall-feedback/${id}`);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/wall-feedback"] });
      qc.invalidateQueries({ queryKey: ["/api/wall-feedback/stats"] });
      toast({ title: "Removido" });
    },
    onError: () => toast({ title: "Erro ao remover", variant: "destructive" }),
  });

  if (loadingStats || loadingRows) {
    return (
      <div className="min-h-screen lw-gradient-bg">
        <PageHeader><LightwallBrand /></PageHeader>
        <main className="container mx-auto px-4 py-8"><LoadingState /></main>
      </div>
    );
  }

  const accuracyColor = (a: number | null) =>
    a === null ? "" : a >= 90 ? "text-success" : a >= 70 ? "text-warning" : "text-error";

  return (
    <div className="min-h-screen lw-gradient-bg">
      <PageHeader>
        <div className="flex items-center justify-between">
          <LightwallBrand />
          <Link href="/calibracao">
            <Button variant="ghost" size="sm" className="gap-2" data-testid="link-back">
              <ArrowLeft className="h-4 w-4" /> Calibracao
            </Button>
          </Link>
        </div>
      </PageHeader>
      <main className="container mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <GraduationCap className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Aprendizado da IA</h1>
            <p className="text-sm text-muted-foreground">Correcoes humanas que servem como override deterministico na classificacao de paredes.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-2xl font-bold" data-testid="stat-total">{stats?.counts.total ?? 0}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Ativas</p>
            <p className="text-2xl font-bold" data-testid="stat-active">{stats?.counts.active ?? 0}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Correcoes</p>
            <p className="text-2xl font-bold" data-testid="stat-correct">{stats?.counts.correct ?? 0}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">"Nao e parede"</p>
            <p className="text-2xl font-bold" data-testid="stat-not-wall">{stats?.counts.not_wall ?? 0}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Exemplos</p>
            <p className="text-2xl font-bold" data-testid="stat-exemplar">{stats?.counts.exemplar ?? 0}</p>
          </CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Acuracia de classificacao da IA</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-baseline gap-6">
              <div>
                <p className="text-xs text-muted-foreground">% de paredes em que humano nao precisou corrigir</p>
                <p className={`text-4xl font-bold ${accuracyColor(stats?.classificationAccuracy ?? null)}`} data-testid="text-classification-accuracy">
                  {stats?.classificationAccuracy !== null && stats?.classificationAccuracy !== undefined
                    ? `${stats.classificationAccuracy.toFixed(1)}%`
                    : "—"}
                </p>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Amostra: {stats?.classificationSample.totalWalls ?? 0} paredes ({stats?.classificationSample.unchangedWalls ?? 0} sem correcao)</div>
                <div>Projetos comparados: {stats?.classificationSample.projectsCompared ?? 0}</div>
              </div>
            </div>
            {stats && stats.perProject.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="text-left py-1">Projeto</th><th className="text-right">Total</th><th className="text-right">Sem correcao</th><th className="text-right">Acuracia</th></tr>
                  </thead>
                  <tbody>
                    {stats.perProject.map(p => (
                      <tr key={p.projectId} className="border-t" data-testid={`row-project-${p.projectId}`}>
                        <td className="py-1"><Link href={`/project/${p.projectId}`} className="hover:underline">{p.projectName}</Link></td>
                        <td className="text-right">{p.total}</td>
                        <td className="text-right">{p.unchanged}</td>
                        <td className={`text-right font-medium ${accuracyColor(p.accuracy)}`}>{p.accuracy.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Padroes mais frequentes (correcoes ativas)</CardTitle>
          </CardHeader>
          <CardContent>
            {!stats || stats.topPatterns.length === 0 ? (
              <EmptyState icon={<AlertTriangle className="h-8 w-8" />} title="Sem padroes" message="Ainda nao ha correcoes suficientes para inferir padroes." />
            ) : (
              <div className="space-y-1">
                {stats.topPatterns.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs border rounded-md px-3 py-2" data-testid={`pattern-${i}`}>
                    <Badge variant="outline">x{p.count}</Badge>
                    <span>esp. {p.espessuraBucketCm ?? "?"}cm</span>
                    <span>comp. {p.comprimentoBucketDm ? (p.comprimentoBucketDm / 10).toFixed(1) : "?"}m</span>
                    <span className="ml-auto">
                      <Badge variant="secondary" className="mr-1">{p.originalClasse ?? "?"}</Badge>
                      →
                      <Badge className="ml-1">{p.correctedClasse ?? "?"}</Badge>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Todos os feedbacks ({rows?.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent>
            {!rows || rows.length === 0 ? (
              <EmptyState icon={<GraduationCap className="h-8 w-8" />} title="Sem feedbacks ainda" message="Marque correcoes no Editor de Quantitativos." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left py-2">Quando</th>
                      <th className="text-left">Acao</th>
                      <th className="text-left">Parede</th>
                      <th className="text-right">Esp/Comp</th>
                      <th className="text-left">Mudanca</th>
                      <th className="text-left">Projeto</th>
                      <th className="text-right">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} className={`border-t ${!r.active ? "opacity-50" : ""}`} data-testid={`row-feedback-${r.id}`}>
                        <td className="py-1">{new Date(r.createdAt).toLocaleString()}</td>
                        <td>{actionBadge(r.action, r.isExemplar)}</td>
                        <td>{r.wallId}{r.nivel ? <span className="text-muted-foreground"> · {r.nivel}</span> : null}</td>
                        <td className="text-right">{r.espessuraBucketCm ?? "?"}cm / {r.comprimentoBucketDm ? (r.comprimentoBucketDm / 10).toFixed(1) : "?"}m</td>
                        <td>
                          <Badge variant="secondary" className="mr-1">{r.originalClasse ?? "?"}</Badge>
                          →
                          <Badge className="ml-1">{r.correctedClasse ?? "?"}</Badge>
                        </td>
                        <td>{r.projectId ? <Link href={`/project/${r.projectId}`} className="hover:underline">#{r.projectId}</Link> : "—"}</td>
                        <td className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleActive.mutate({ id: r.id, active: !r.active })} data-testid={`button-toggle-${r.id}`} title={r.active ? "Desativar" : "Reativar"}>
                              {r.active ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5 text-muted-foreground" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-error hover:text-error" onClick={() => remove.mutate(r.id)} data-testid={`button-delete-${r.id}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
