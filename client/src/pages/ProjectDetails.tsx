import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  FileText,
  Image,
  Play,
  Download,
  Sparkles,
  AlertTriangle,
  CheckCircle,
  Info,
  Trash2,
  Loader2,
  XCircle,
  Clock,
  BookOpen,
  X,
  ZoomIn,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Pencil,
  Check,
  SlidersHorizontal,
  Upload,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Activity,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import PdfViewer from "@/components/PdfViewer";
import Metodologia from "@/components/Metodologia";
import QuantitativosEditor from "@/components/QuantitativosEditor";
import FloorPlanDiagram from "@/components/FloorPlanDiagram";
import AnnotatedFloorPlan from "@/components/AnnotatedFloorPlan";
import { LightwallDots } from "@/components/LightwallLogo";
import type { Product } from "@shared/schema";

interface PipelineStep {
  step: number;
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

const STEP_LABELS = [
  { step: 1, label: "Classificacao + Tabelas" },
  { step: 3, label: "Extracao Geometrica" },
  { step: 4, label: "Fusao Multivista + Imagem Anotada" },
  { step: 5, label: "Calculo de Quantitativos" },
  { step: 6, label: "Integracao com Catalogo" },
  { step: 7, label: "Validacao" },
  { step: 8, label: "Descricao do Projeto" },
];

export default function ProjectDetails() {
  const [, params] = useRoute("/project/:id");
  const projectId = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipelineVisible, setPipelineVisible] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [selectedProductIdExt, setSelectedProductIdExt] = useState<string>(() => {
    return localStorage.getItem(`panel-ext-${params?.id}`) || "";
  });
  const [selectedProductIdInt, setSelectedProductIdInt] = useState<string>(() => {
    return localStorage.getItem(`panel-int-${params?.id}`) || "";
  });
  const [selectedProductIdMuros, setSelectedProductIdMuros] = useState<string>(() => {
    return localStorage.getItem(`panel-muros-${params?.id}`) || "";
  });
  const [selectedProductIdPiso, setSelectedProductIdPiso] = useState<string>(() => {
    return localStorage.getItem(`panel-piso-${params?.id}`) || "";
  });
  const [selectedProductIdCoberta, setSelectedProductIdCoberta] = useState<string>(() => {
    return localStorage.getItem(`panel-coberta-${params?.id}`) || "";
  });
  const [scope, setScope] = useState({
    paredesExternas: true,
    paredesInternas: true,
    muros: true,
    lajePiso: true,
    lajeCoberta: true,
    cantos: true,
  });
  const [viewingFile, setViewingFile] = useState<any | null>(null);
  const [editingInfo, setEditingInfo] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [editName, setEditName] = useState("");
  const [editClient, setEditClient] = useState("");
  const [highlightedWallId, setHighlightedWallId] = useState<string | null>(null);
  const [liveWalls, setLiveWalls] = useState<any[] | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const toggleExpanded = (id: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const { data, isLoading } = useQuery({
    queryKey: ["/api/projects", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Erro ao buscar projeto");
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: catalogProducts } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });
  const panelProducts = (catalogProducts || []).filter(p => p.category === "painel");

  useEffect(() => {
    if (panelProducts.length === 0) return;
    const default2P = panelProducts.find(p => p.sku === "LW-2P-090") || panelProducts[0];
    const defaultSP = panelProducts.find(p => p.sku === "LW-SP-090")
      || panelProducts.find(p => p.panelType === "SP")
      || default2P;
    if (!selectedProductIdExt) setSelectedProductIdExt(String(default2P.id));
    if (!selectedProductIdInt) setSelectedProductIdInt(String(defaultSP.id));
    if (!selectedProductIdMuros) setSelectedProductIdMuros(String(defaultSP.id));
    if (!selectedProductIdPiso) setSelectedProductIdPiso(String(default2P.id));
    if (!selectedProductIdCoberta) setSelectedProductIdCoberta(String(default2P.id));
  }, [panelProducts, selectedProductIdExt, selectedProductIdInt, selectedProductIdMuros, selectedProductIdPiso, selectedProductIdCoberta]);

  // Persist panel selections to localStorage whenever they change
  useEffect(() => {
    if (!params?.id) return;
    if (selectedProductIdExt) localStorage.setItem(`panel-ext-${params.id}`, selectedProductIdExt);
    if (selectedProductIdInt) localStorage.setItem(`panel-int-${params.id}`, selectedProductIdInt);
    if (selectedProductIdMuros) localStorage.setItem(`panel-muros-${params.id}`, selectedProductIdMuros);
    if (selectedProductIdPiso) localStorage.setItem(`panel-piso-${params.id}`, selectedProductIdPiso);
    if (selectedProductIdCoberta) localStorage.setItem(`panel-coberta-${params.id}`, selectedProductIdCoberta);
  }, [params?.id, selectedProductIdExt, selectedProductIdInt, selectedProductIdMuros, selectedProductIdPiso, selectedProductIdCoberta]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const startSSE = () => {
    if (eventSourceRef.current) eventSourceRef.current.close();

    const initSteps = STEP_LABELS.map(s => ({
      step: s.step,
      label: s.label,
      status: "pending" as const,
    }));
    setPipelineSteps(initSteps);

    const es = new EventSource(`/api/projects/${projectId}/progress`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.step === 0) {
          if (data.status === "done") {
            setIsProcessing(false);
            es.close();
            queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
          } else if (data.status === "error") {
            setIsProcessing(false);
            es.close();
          }
          return;
        }
        setPipelineSteps(prev => prev.map(s =>
          s.step === data.step
            ? { ...s, status: data.status, label: data.label, detail: data.detail }
            : s.step < data.step && s.status === "pending"
              ? { ...s, status: "done" }
              : s
        ));
      } catch {}
    };

    es.onerror = () => {
      es.close();
    };
  };

  const processMutation = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);
      setPipelineVisible(true);
      startSSE();
      const body: Record<string, unknown> = { scope };
      if (selectedProductIdExt) body.productIdExt = parseInt(selectedProductIdExt);
      if (selectedProductIdInt) body.productIdInt = parseInt(selectedProductIdInt);
      if (selectedProductIdMuros) body.productIdMuros = parseInt(selectedProductIdMuros);
      if (selectedProductIdPiso) body.productIdPiso = parseInt(selectedProductIdPiso);
      if (selectedProductIdCoberta) body.productIdCoberta = parseInt(selectedProductIdCoberta);
      const res = await fetch(`/api/projects/${projectId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: "Erro ao processar projeto" }));
        throw new Error(errData.message || "Erro ao processar projeto");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sucesso!", description: "Projeto processado com sucesso" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      setIsProcessing(false);
    },
    onError: (error: Error) => {
      toast({ title: "Erro", description: error.message || "Erro ao processar projeto", variant: "destructive" });
      setIsProcessing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erro ao excluir");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Projeto excluido", description: "O projeto foi removido com sucesso" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setLocation("/");
    },
    onError: () => {
      toast({ title: "Erro", description: "Erro ao excluir projeto", variant: "destructive" });
    },
  });

  const handleExport = async (format: "pdf" | "excel" | "json") => {
    try {
      const res = await fetch(`/api/projects/${projectId}/export/${format}`);
      if (!res.ok) throw new Error("Erro ao exportar");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `orcamento_${projectId}.${format === "excel" ? "xlsx" : format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: "Sucesso!", description: "Orcamento exportado com sucesso" });
    } catch {
      toast({ title: "Erro", description: "Erro ao exportar orcamento", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center" data-testid="text-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p>Carregando projeto...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="text-not-found">
        Projeto nao encontrado
      </div>
    );
  }

  const { project, files, extractedData, budget } = data;
  const pipelineFinished = pipelineSteps.length > 0 && pipelineSteps.every(s => s.status === "done" || s.status === "error");
  const showPipeline = pipelineVisible && (isProcessing || processMutation.isPending || project.status === "processing" || pipelineSteps.length > 0);

  function getStepIcon(status: string) {
    switch (status) {
      case "done": return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "running": return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      case "error": return <XCircle className="h-5 w-5 text-red-500" />;
      default: return <Clock className="h-5 w-5 text-slate-300" />;
    }
  }

  return (
    <div className="min-h-screen lw-gradient-bg">
      <header className="glass-header border-b border-white/20 dark:border-white/5 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm" data-testid="button-back">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Voltar
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <LightwallDots className="h-5 w-5 lw-text-accent" />
                {editingInfo ? (
                  <div className="flex items-center gap-2">
                    <div>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8 text-sm font-bold"
                        placeholder="Nome do projeto"
                        data-testid="input-edit-project-name"
                      />
                      <Input
                        value={editClient}
                        onChange={(e) => setEditClient(e.target.value)}
                        className="h-7 text-xs mt-1"
                        placeholder="Nome do cliente"
                        data-testid="input-edit-client-name"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      data-testid="button-save-project-info"
                      disabled={savingInfo}
                      onClick={async () => {
                        setSavingInfo(true);
                        try {
                          const res = await fetch(`/api/projects/${projectId}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: editName, clientName: editClient }),
                          });
                          if (!res.ok) throw new Error("Erro ao salvar");
                          queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
                          queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
                          setEditingInfo(false);
                          toast({ title: "Projeto atualizado" });
                        } catch {
                          toast({ title: "Erro ao salvar", description: "Tente novamente", variant: "destructive" });
                        } finally {
                          setSavingInfo(false);
                        }
                      }}
                    >
                      {savingInfo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-green-500" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingInfo(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div>
                      <h1 className="text-lg font-bold" data-testid="text-project-name">
                        {project.name}
                      </h1>
                      {project.clientName && (
                        <p className="text-xs text-muted-foreground">Cliente: {project.clientName}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      data-testid="button-edit-project-info"
                      onClick={() => {
                        setEditName(project.name);
                        setEditClient(project.clientName || "");
                        setEditingInfo(true);
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge
                data-testid="status-project"
                variant={project.status === "completed" ? "default" : project.status === "processing" ? "secondary" : "destructive"}
              >
                {project.status === "completed" ? "Concluido" : project.status === "processing" ? "Processando" : project.status === "error" ? "Erro" : "Rascunho"}
              </Badge>
              {!showDeleteConfirm ? (
                <Button variant="outline" size="sm" className="text-red-600 border-red-300 hover:bg-red-50" onClick={() => setShowDeleteConfirm(true)} data-testid="button-delete-project">
                  <Trash2 className="h-4 w-4 mr-1" />
                  Excluir
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-red-600 font-medium">Confirma?</span>
                  <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} data-testid="button-confirm-delete">
                    {deleteMutation.isPending ? "Excluindo..." : "Sim, excluir"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowDeleteConfirm(false)} data-testid="button-cancel-delete">
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-6 glass-card rounded-xl p-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">Tipo:</span>
            <div className="flex rounded-lg overflow-hidden border">
              <button
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${project.projectType === "teste" ? "bg-amber-500 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                data-testid="button-type-teste"
                onClick={async () => {
                  await fetch(`/api/projects/${projectId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ projectType: "teste" }),
                  });
                  queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
                  queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
                }}
              >
                Teste
              </button>
              <button
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${project.projectType !== "teste" ? "bg-emerald-500 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                data-testid="button-type-real"
                onClick={async () => {
                  await fetch(`/api/projects/${projectId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ projectType: "real", realCost: null }),
                  });
                  queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
                  queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
                }}
              >
                Real
              </button>
            </div>
          </div>
          {project.projectType === "teste" && (
            <div className="w-full mt-3 border-t border-border/40 pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">m² Real por Categoria (para acuracia por area):</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {([
                  { key: "realAreaExt", label: "Par. Externas" },
                  { key: "realAreaInt", label: "Par. Internas" },
                  { key: "realAreaPiso", label: "Laje Piso" },
                  { key: "realAreaCoberta", label: "Laje Coberta" },
                ] as const).map(({ key, label }) => (
                  <div key={key} className="flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground">{label} (m²)</span>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      className="h-7 text-xs"
                      data-testid={`input-${key}`}
                      defaultValue={project[key] || ""}
                      onBlur={async (e) => {
                        const val = e.target.value ? e.target.value : null;
                        await fetch(`/api/projects/${projectId}`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ [key]: val }),
                        });
                        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
                        queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="h-6 w-px bg-border" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">Edificacao:</span>
            <Select
              value={project.buildingType || "_auto"}
              onValueChange={async (val) => {
                const newType = val === "_auto" ? null : val;
                await fetch(`/api/projects/${projectId}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ buildingType: newType }),
                });
                queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
              }}
            >
              <SelectTrigger className="h-8 w-44 text-xs" data-testid="select-building-type">
                <SelectValue placeholder="Auto-detectar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_auto">Auto-detectar</SelectItem>
                <SelectItem value="residencial">Residencial</SelectItem>
                <SelectItem value="comercial">Comercial</SelectItem>
                <SelectItem value="institucional">Institucional</SelectItem>
                <SelectItem value="industrial">Industrial</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
            {project.buildingType && (
              <Badge variant="outline" className="text-xs" data-testid="badge-building-type">
                {project.buildingType === "residencial" ? "Residencial" :
                 project.buildingType === "comercial" ? "Comercial" :
                 project.buildingType === "institucional" ? "Institucional" :
                 project.buildingType === "industrial" ? "Industrial" : "Outro"}
              </Badge>
            )}
          </div>
        </div>

        {project.status === "draft" && files && files.length > 0 && (
          <Card className="mb-6 border-primary">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold mb-1">Pronto para processar</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {files.length} arquivo(s) enviado(s). Configure os paineis na aba Arquivos e inicie a analise.
                  </p>
                </div>
                <Button size="lg" onClick={() => processMutation.mutate()} disabled={processMutation.isPending || isProcessing} data-testid="button-process">
                  <Play className="h-5 w-5 mr-2" />
                  {processMutation.isPending || isProcessing ? "Processando..." : "Processar Projeto"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {showPipeline && (
          <Card className={`mb-6 ${pipelineFinished ? "border-green-200 dark:border-green-800" : "border-blue-200 dark:border-blue-800"}`}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                {pipelineFinished
                  ? <CheckCircle className="h-5 w-5 text-green-500" />
                  : <Loader2 className="h-5 w-5 animate-spin text-blue-500" />}
                Pipeline de Processamento
                <span className="text-xs font-normal text-muted-foreground ml-1">({STEP_LABELS.length} etapas)</span>
                <button
                  className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setPipelineVisible(false)}
                  title="Fechar pipeline"
                >
                  <X className="h-4 w-4" />
                </button>
              </CardTitle>
              <CardDescription>
                {pipelineFinished ? "Processamento concluido com sucesso" : "Acompanhe cada etapa em tempo real"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {pipelineSteps.map((step) => (
                  <div
                    key={step.step}
                    data-testid={`pipeline-step-${step.step}`}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                      step.status === "running" ? "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800" :
                      step.status === "done" ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800" :
                      step.status === "error" ? "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800" :
                      "bg-slate-50 border-slate-200 dark:bg-slate-800/50 dark:border-slate-700"
                    }`}
                  >
                    <div className="mt-0.5">{getStepIcon(step.status)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-slate-500">ETAPA {step.step}</span>
                        <span className="font-medium text-sm">{step.label}</span>
                      </div>
                      {step.detail && (
                        <p className={`text-xs mt-1 break-words ${
                          step.status === "error" ? "text-red-600" :
                          step.status === "done" ? "text-green-700 dark:text-green-400" :
                          "text-blue-600 dark:text-blue-400"
                        }`} data-testid={`pipeline-detail-${step.step}`}>
                          {step.detail}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue={budget ? "description" : "files"} className="space-y-6">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="description" disabled={!budget} data-testid="tab-description">
              <Info className="h-4 w-4 mr-2" />
              Analise IA
            </TabsTrigger>
            <TabsTrigger value="files" data-testid="tab-files">
              <FileText className="h-4 w-4 mr-2" />
              Arquivos ({files?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="intermediate" disabled={!extractedData?.some((d: any) => d.elementType.startsWith("etapa"))} data-testid="tab-intermediate">
              <Image className="h-4 w-4 mr-2" />
              Etapas
            </TabsTrigger>
            <TabsTrigger value="quantitativos" disabled={!extractedData?.some((d: any) => d.elementType === "etapa4_fusao")} data-testid="tab-quantitativos">
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              Quantitativos
            </TabsTrigger>
            <TabsTrigger value="budget" disabled={!budget} data-testid="tab-budget">
              <FileText className="h-4 w-4 mr-2" />
              Orcamento
            </TabsTrigger>
            <TabsTrigger value="metodologia" data-testid="tab-metodologia">
              <BookOpen className="h-4 w-4 mr-2" />
              Metodologia
            </TabsTrigger>
            <TabsTrigger value="export" disabled={!budget} data-testid="tab-export">
              <Download className="h-4 w-4 mr-2" />
              Exportar
            </TabsTrigger>
          </TabsList>

          <TabsContent value="description">
            {budget?.projectDescription ? (
              <Card className="border-indigo-200 dark:border-indigo-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Info className="h-5 w-5 text-indigo-500" />
                    Analise do Projeto pela IA
                  </CardTitle>
                  <CardDescription>
                    Descricao gerada automaticamente a partir da analise profunda das imagens do projeto
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4" data-testid="text-project-description">
                    {budget.projectDescription.split("\n").reduce((acc: any[], line: string, idx: number) => {
                      const trimmed = line.trim();
                      if (!trimmed) return acc;
                      if (trimmed.startsWith("## ")) {
                        acc.push(
                          <h3 key={`h-${idx}`} className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-4 mb-1 flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                            {trimmed.replace(/^## /, "").replace(/\*\*(.*?)\*\*/g, "$1")}
                          </h3>
                        );
                      } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                        const text = trimmed.replace(/^[-*] /, "").replace(/\*\*(.*?)\*\*/g, "$1");
                        const boldMatch = trimmed.match(/^[-*] \*\*(.*?)\*\*[:\s]*(.*)/);
                        acc.push(
                          <div key={`b-${idx}`} className="flex items-start gap-2 ml-3 text-sm text-slate-700 dark:text-slate-300">
                            <span className="text-indigo-400 mt-1.5 text-[6px]">●</span>
                            <span>{boldMatch ? <><strong className="text-slate-800 dark:text-slate-200">{boldMatch[1]}:</strong> {boldMatch[2]}</> : text}</span>
                          </div>
                        );
                      } else {
                        acc.push(
                          <p key={`p-${idx}`} className="text-sm text-slate-600 dark:text-slate-400 ml-3">
                            {trimmed.replace(/\*\*(.*?)\*\*/g, "$1")}
                          </p>
                        );
                      }
                      return acc;
                    }, [])}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="text-center py-12">
                  <p className="text-slate-500" data-testid="text-no-description">
                    A descricao do projeto sera gerada apos o processamento com IA.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="intermediate">
            <div className="space-y-4">
              {extractedData
                ?.filter((d: any) => d.elementType.startsWith("etapa") || d.elementType === "descricao_projeto")
                .sort((a: any, b: any) => (a.data?.etapa || 99) - (b.data?.etapa || 99))
                .map((item: any) => {
                  const d = item.data as any;
                  return (
                    <Card key={item.id} data-testid={`card-intermediate-${item.elementType}`}>
                      <CardHeader className="pb-3 cursor-pointer" onClick={() => toggleExpanded(item.id)}>
                        <CardTitle className="flex items-center gap-3 text-base">
                          <Badge variant="outline" className="text-xs font-mono">
                            ETAPA {d.etapa}
                          </Badge>
                          {d.label}
                          <span className="text-xs text-slate-400 ml-auto">
                            {expandedSteps.has(item.id) ? "clique para recolher" : "clique para expandir"}
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {item.elementType === "etapa1_classificacoes" && (
                          <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                              {d.resultado?.length || 0} pagina(s) classificada(s)
                            </p>
                            {expandedSteps.has(item.id) && (
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="border-b">
                                      <th className="text-left p-2">Pagina</th>
                                      <th className="text-left p-2">Classificacao</th>
                                      <th className="text-left p-2">Pavimento</th>
                                      <th className="text-left p-2">Tabela</th>
                                      <th className="text-left p-2">Escala</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {d.resultado?.map((c: any, i: number) => (
                                      <tr key={i} className="border-b">
                                        <td className="p-2">{c.page_index}</td>
                                        <td className="p-2"><Badge variant="secondary">{c.classificacao}</Badge></td>
                                        <td className="p-2">{c.pavimento}</td>
                                        <td className="p-2">{c.has_table ? "Sim" : "Nao"}</td>
                                        <td className="p-2">{c.has_scale ? "Sim" : "Nao"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}

                        {item.elementType === "etapa2_tabelas" && (
                          <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                              {d.resultado?.paredes_de_tabela?.length || 0} paredes, {d.resultado?.esquadrias_de_tabela?.length || 0} esquadrias, {d.resultado?.areas_de_tabela?.length || 0} areas
                            </p>
                            {expandedSteps.has(item.id) && (
                              <div>
                                {d.resultado?.esquadrias_de_tabela?.length > 0 && (
                                  <div className="mb-4">
                                    <h4 className="text-sm font-semibold mb-2">Esquadrias de Tabela</h4>
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-sm">
                                        <thead><tr className="border-b"><th className="text-left p-2">Codigo</th><th className="text-left p-2">Tipo</th><th className="text-left p-2">Largura</th><th className="text-left p-2">Altura</th><th className="text-left p-2">Qtd</th></tr></thead>
                                        <tbody>
                                          {d.resultado.esquadrias_de_tabela.map((e: any, i: number) => (
                                            <tr key={i} className="border-b"><td className="p-2 font-medium">{e.codigo}</td><td className="p-2">{e.tipo}</td><td className="p-2">{e.largura_m}m</td><td className="p-2">{e.altura_m}m</td><td className="p-2">{e.quantidade}</td></tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}
                                {d.resultado?.paredes_de_tabela?.length > 0 && (
                                  <div className="mb-4">
                                    <h4 className="text-sm font-semibold mb-2">Paredes de Tabela</h4>
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-sm">
                                        <thead><tr className="border-b"><th className="text-left p-2">ID</th><th className="text-left p-2">Nivel</th><th className="text-left p-2">Classe</th><th className="text-left p-2">Comp.</th><th className="text-left p-2">Altura</th></tr></thead>
                                        <tbody>
                                          {d.resultado.paredes_de_tabela.map((p: any, i: number) => (
                                            <tr key={i} className="border-b"><td className="p-2 font-medium">{p.id}</td><td className="p-2">{p.nivel}</td><td className="p-2">{p.classe}</td><td className="p-2">{p.comprimento_m}m</td><td className="p-2">{p.altura_m}m</td></tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}
                                {d.resultado?.areas_de_tabela?.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-semibold mb-2">Areas de Tabela</h4>
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-sm">
                                        <thead><tr className="border-b"><th className="text-left p-2">Nivel</th><th className="text-left p-2">Tipo</th><th className="text-left p-2">Area (m2)</th></tr></thead>
                                        <tbody>
                                          {d.resultado.areas_de_tabela.map((a: any, i: number) => (
                                            <tr key={i} className="border-b"><td className="p-2">{a.nivel}</td><td className="p-2">{a.tipo}</td><td className="p-2">{a.area_m2}m2</td></tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {item.elementType === "etapa3_geometria_bruta" && (
                          <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                              {d.resultado?.length || 0} arquivo(s) com geometria extraida
                            </p>
                            {expandedSteps.has(item.id) && (
                              <div className="space-y-3">
                                {d.resultado?.map((arq: any, i: number) => (
                                  <div key={i} className="border rounded p-3">
                                    <p className="text-sm font-medium mb-2">Arquivo {i + 1}: {arq.paredes} paredes, {arq.lajes} lajes, {arq.cantos} cantos</p>
                                    {arq.walls?.length > 0 && (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                          <thead><tr className="border-b"><th className="text-left p-1">ID</th><th className="text-left p-1">Classe</th><th className="text-left p-1">Nivel</th><th className="text-left p-1">Comp.</th><th className="text-left p-1">Alt.</th><th className="text-left p-1">Fonte</th><th className="text-left p-1">Conf.</th></tr></thead>
                                          <tbody>
                                            {arq.walls.map((w: any, j: number) => (
                                              <tr key={j} className="border-b"><td className="p-1">{w.id}</td><td className="p-1">{w.classe}</td><td className="p-1">{w.nivel}</td><td className="p-1">{w.comprimento_m}m</td><td className="p-1">{w.altura_m}m</td><td className="p-1">{w.measurement_source}</td><td className="p-1">{w.confidence ? `${(w.confidence * 100).toFixed(0)}%` : "-"}</td></tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {item.elementType === "etapa4_fusao" && (
                          <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                              Apos deduplicacao: {d.resultado?.walls?.length || 0} paredes, {d.resultado?.slabs?.length || 0} lajes, {d.resultado?.corners?.length || 0} cantos
                            </p>
                            {expandedSteps.has(item.id) && (
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead><tr className="border-b"><th className="text-left p-2">ID</th><th className="text-left p-2">Tipo</th><th className="text-left p-2">Classe</th><th className="text-left p-2">Nivel</th><th className="text-left p-2">Dimensao</th></tr></thead>
                                  <tbody>
                                    {d.resultado?.walls?.map((w: any, i: number) => (
                                      <tr key={`w-${i}`} className="border-b"><td className="p-2 font-medium">{w.id}</td><td className="p-2"><Badge>Parede</Badge></td><td className="p-2">{w.classe}</td><td className="p-2">{w.nivel}</td><td className="p-2">{w.comprimento_m}m x {w.altura_m}m</td></tr>
                                    ))}
                                    {d.resultado?.slabs?.map((s: any, i: number) => (
                                      <tr key={`s-${i}`} className="border-b"><td className="p-2 font-medium">{s.id}</td><td className="p-2"><Badge variant="secondary">Laje</Badge></td><td className="p-2">{s.classe}</td><td className="p-2">{s.nivel}</td><td className="p-2">{s.area_m2}m2</td></tr>
                                    ))}
                                    {d.resultado?.corners?.map((c: any, i: number) => (
                                      <tr key={`c-${i}`} className="border-b"><td className="p-2 font-medium">{c.id}</td><td className="p-2"><Badge variant="outline">Canto</Badge></td><td className="p-2">-</td><td className="p-2">{c.nivel}</td><td className="p-2">{c.qtd_cantos} cantos</td></tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}

                        {item.elementType === "etapa5_calculo" && (
                          <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                              Total: {d.resultado?.resumo?.total_geral_paineis || 0} paineis |
                              {" "}{d.resultado?.pavimentos?.length || 0} pavimento(s)
                            </p>
                            {expandedSteps.has(item.id) && (
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                  <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3 text-center">
                                    <p className="text-xs text-blue-600 dark:text-blue-400">Total Paineis</p>
                                    <p className="text-lg font-bold text-blue-700 dark:text-blue-300">{d.resultado?.resumo?.total_geral_paineis || 0}</p>
                                  </div>
                                  <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-3 text-center">
                                    <p className="text-xs text-green-600 dark:text-green-400">Area Total (m2)</p>
                                    <p className="text-lg font-bold text-green-700 dark:text-green-300">{(d.resultado?.resumo?.area_total_m2 || 0).toFixed(2)}</p>
                                  </div>
                                  <div className="bg-purple-50 dark:bg-purple-900/30 rounded-lg p-3 text-center">
                                    <p className="text-xs text-purple-600 dark:text-purple-400">Pavimentos</p>
                                    <p className="text-lg font-bold text-purple-700 dark:text-purple-300">{d.resultado?.pavimentos?.length || 0}</p>
                                  </div>
                                  <div className="bg-orange-50 dark:bg-orange-900/30 rounded-lg p-3 text-center">
                                    <p className="text-xs text-orange-600 dark:text-orange-400">Paredes</p>
                                    <p className="text-lg font-bold text-orange-700 dark:text-orange-300">{d.resultado?.resumo?.total_paredes || 0}</p>
                                  </div>
                                </div>
                                {d.resultado?.pavimentos?.map((pav: any, pi: number) => (
                                  <div key={pi} className="border rounded-lg overflow-hidden">
                                    <div className="bg-slate-100 dark:bg-slate-800 px-4 py-2 font-medium text-sm flex justify-between">
                                      <span>{pav.pavimento || pav.nome || `Pavimento ${pi + 1}`}</span>
                                      <span className="text-slate-500">{pav.total_paineis || pav.paineis || 0} paineis</span>
                                    </div>
                                    <div className="p-3">
                                      {pav.paredes && pav.paredes.length > 0 && (
                                        <div className="mb-2">
                                          <p className="text-xs font-medium text-slate-500 mb-1">Paredes ({pav.paredes.length})</p>
                                          <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                              <thead><tr className="border-b text-left"><th className="p-1.5">ID</th><th className="p-1.5">Classe</th><th className="p-1.5 text-right">Comp. (m)</th><th className="p-1.5 text-right">Alt. (m)</th><th className="p-1.5 text-right">Area (m2)</th><th className="p-1.5 text-right">Paineis</th></tr></thead>
                                              <tbody>
                                                {pav.paredes.map((p: any, wi: number) => (
                                                  <tr key={wi} className="border-b border-slate-100 dark:border-slate-800">
                                                    <td className="p-1.5">{p.id || `P${wi + 1}`}</td>
                                                    <td className="p-1.5"><Badge variant="outline" className="text-[10px]">{p.classe || "ext"}</Badge></td>
                                                    <td className="p-1.5 text-right">{(p.comprimento || 0).toFixed(2)}</td>
                                                    <td className="p-1.5 text-right">{(p.altura || 0).toFixed(2)}</td>
                                                    <td className="p-1.5 text-right">{(p.area_liquida || p.area || 0).toFixed(2)}</td>
                                                    <td className="p-1.5 text-right font-medium">{p.paineis || 0}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}
                                      {pav.lajes && pav.lajes.length > 0 && (
                                        <div>
                                          <p className="text-xs font-medium text-slate-500 mb-1">Lajes ({pav.lajes.length})</p>
                                          <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                              <thead><tr className="border-b text-left"><th className="p-1.5">ID</th><th className="p-1.5">Classe</th><th className="p-1.5 text-right">Area (m2)</th><th className="p-1.5 text-right">Paineis</th></tr></thead>
                                              <tbody>
                                                {pav.lajes.map((l: any, li: number) => (
                                                  <tr key={li} className="border-b border-slate-100 dark:border-slate-800">
                                                    <td className="p-1.5">{l.id || `L${li + 1}`}</td>
                                                    <td className="p-1.5"><Badge variant="outline" className="text-[10px]">{l.classe || "piso"}</Badge></td>
                                                    <td className="p-1.5 text-right">{(l.area || 0).toFixed(2)}</td>
                                                    <td className="p-1.5 text-right font-medium">{l.paineis || 0}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {item.elementType === "etapa6_catalogo" && (
                          <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                              Custo total proposta: R$ {(d.resultado?.custo_total_proposta || d.resultado?.custo_total)?.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) || "0,00"}
                            </p>
                            {expandedSteps.has(item.id) && (
                              <div className="space-y-3">
                                {d.resultado?.proposta?.itens ? (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead><tr className="border-b"><th className="text-left p-2">Local</th><th className="text-right p-2">Un</th><th className="text-right p-2">M2</th><th className="text-right p-2">R$/M2</th><th className="text-right p-2">Total</th></tr></thead>
                                      <tbody>
                                        {d.resultado.proposta.itens.map((it: any) => (
                                          <tr key={it.item} className="border-b"><td className="p-2">{it.local}</td><td className="p-2 text-right">{it.qtd_un}</td><td className="p-2 text-right">{it.qtd_m2?.toFixed(3)}</td><td className="p-2 text-right">R$ {it.preco_m2?.toFixed(2)}</td><td className="p-2 text-right font-medium">R$ {it.preco_total?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td></tr>
                                        ))}
                                      </tbody>
                                      <tfoot><tr className="font-bold border-t-2"><td className="p-2">TOTAL</td><td className="p-2 text-right">{d.resultado.proposta.total_paineis_un}</td><td className="p-2 text-right">{d.resultado.proposta.total_area_m2?.toFixed(3)}</td><td className="p-2"></td><td className="p-2 text-right">R$ {d.resultado.proposta.total_paineis?.toLocaleString?.("pt-BR", { minimumFractionDigits: 2 }) || d.resultado.custo_total_proposta?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td></tr></tfoot>
                                    </table>
                                  </div>
                                ) : (
                                  <pre className="bg-slate-100 dark:bg-slate-800 p-3 rounded text-xs overflow-auto max-h-60">{JSON.stringify(d.resultado, null, 2)}</pre>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {item.elementType === "etapa7_validacao" && (
                          <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                              {d.resultado?.inconsistencias?.length || 0} inconsistencia(s) encontrada(s)
                            </p>
                            {expandedSteps.has(item.id) && (
                              <div>
                                {d.resultado?.inconsistencias?.length > 0 ? (
                                  <div className="space-y-2">
                                    {d.resultado.inconsistencias.map((inc: any, i: number) => (
                                      <div key={i} className={`p-3 rounded border text-sm ${
                                        inc.severidade === "Critica" ? "bg-red-50 border-red-200 dark:bg-red-900/20" :
                                        inc.severidade === "Media" ? "bg-orange-50 border-orange-200 dark:bg-orange-900/20" :
                                        "bg-blue-50 border-blue-200 dark:bg-blue-900/20"
                                      }`}>
                                        <span className="font-medium">[{inc.severidade}]</span> {inc.mensagem}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-green-600 text-sm">Nenhuma inconsistencia encontrada.</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {item.elementType === "descricao_projeto" && (
                          <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">Texto descritivo gerado pela IA</p>
                            {expandedSteps.has(item.id) && (
                              <div className="prose prose-sm dark:prose-invert max-w-none">
                                {d.texto?.split("\n").map((p: string, i: number) => (
                                  p.trim() ? <p key={i} className="mb-3 text-sm leading-relaxed">{p}</p> : null
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          </TabsContent>

          <TabsContent value="files">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Arquivos do Projeto</CardTitle>
                    <CardDescription>Clique em um arquivo para visualizar em tela cheia</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <label htmlFor="file-upload-input">
                      <Button variant="outline" size="sm" asChild data-testid="button-add-files">
                        <span className="cursor-pointer">
                          <Upload className="h-4 w-4 mr-2" />
                          Adicionar Arquivos
                        </span>
                      </Button>
                    </label>
                    <input
                      id="file-upload-input"
                      type="file"
                      multiple
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
                      className="hidden"
                      data-testid="input-file-upload"
                      onChange={async (e) => {
                        const selectedFiles = e.target.files;
                        if (!selectedFiles || selectedFiles.length === 0) return;
                        const formData = new FormData();
                        for (let i = 0; i < selectedFiles.length; i++) {
                          formData.append("files", selectedFiles[i]);
                        }
                        try {
                          const res = await fetch(`/api/projects/${projectId}/upload`, {
                            method: "POST",
                            body: formData,
                          });
                          if (!res.ok) throw new Error("Erro no upload");
                          queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
                          toast({ title: `${selectedFiles.length} arquivo(s) adicionado(s)` });
                        } catch {
                          toast({ title: "Erro no upload", variant: "destructive" });
                        }
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>
              </CardHeader>
              {files && files.length > 0 && (
                <div className="mx-6 mb-4 rounded-lg border border-border/50 bg-slate-50 dark:bg-slate-800/50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold">Configuracao de Paineis</p>
                    <Button
                      variant="default"
                      size="sm"
                      data-testid="button-reprocess"
                      disabled={isProcessing}
                      onClick={() => processMutation.mutate()}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${isProcessing ? "animate-spin" : ""}`} />
                      {isProcessing ? "Processando..." : project?.status === "draft" ? "Processar Projeto" : "Reprocessar"}
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
                    {([
                      { key: "ext", label: "Paredes Externas", value: selectedProductIdExt, set: setSelectedProductIdExt, testid: "select-panel-ext" },
                      { key: "int", label: "Paredes Internas", value: selectedProductIdInt, set: setSelectedProductIdInt, testid: "select-panel-int" },
                      { key: "muros", label: "Muros (divisa)", value: selectedProductIdMuros, set: setSelectedProductIdMuros, testid: "select-panel-muros" },
                      { key: "piso", label: "Laje de Piso", value: selectedProductIdPiso, set: setSelectedProductIdPiso, testid: "select-panel-piso" },
                      { key: "coberta", label: "Laje Coberta", value: selectedProductIdCoberta, set: setSelectedProductIdCoberta, testid: "select-panel-coberta" },
                    ] as const).map(({ key, label, value, set, testid }) => (
                      <div key={key} className="flex flex-col gap-1">
                        <Label className="text-xs font-medium text-muted-foreground">{label}:</Label>
                        <Select value={value} onValueChange={set}>
                          <SelectTrigger data-testid={testid} className="h-8 text-sm">
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            {panelProducts.map(p => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name} — R$ {parseFloat(p.unitPrice).toFixed(2)}/m2
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground mb-2 block">Escopo:</Label>
                    <div className="flex flex-wrap gap-4">
                      {([
                        { key: "paredesExternas", label: "Par. Externas" },
                        { key: "paredesInternas", label: "Par. Internas" },
                        { key: "muros", label: "Muros" },
                        { key: "lajePiso", label: "Laje Piso" },
                        { key: "lajeCoberta", label: "Laje Coberta" },
                        { key: "cantos", label: "Cantos" },
                      ] as const).map(({ key, label }) => (
                        <div key={key} className="flex items-center gap-1.5">
                          <Checkbox
                            id={`scope2-${key}`}
                            checked={scope[key]}
                            onCheckedChange={(checked) => setScope(prev => ({ ...prev, [key]: !!checked }))}
                          />
                          <label htmlFor={`scope2-${key}`} className="text-xs cursor-pointer select-none">{label}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <CardContent>
                {!files || files.length === 0 ? (
                  <div className="text-center py-12 border-2 border-dashed rounded-lg" data-testid="text-no-files">
                    <Upload className="h-10 w-10 mx-auto text-slate-400 mb-3" />
                    <p className="text-slate-500 mb-2">Nenhum arquivo enviado</p>
                    <label htmlFor="file-upload-input">
                      <Button variant="outline" size="sm" asChild>
                        <span className="cursor-pointer">Selecionar Arquivos</span>
                      </Button>
                    </label>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {files.map((file: any) => {
                      const isImage = file.fileType === "image" || /\.(png|jpe?g)$/i.test(file.originalName || "");
                      const isPdf = file.fileType === "pdf" || /\.pdf$/i.test(file.originalName || "");
                      const fileUrl = `/api/files/${file.id}/content`;
                      const pageTypeLabel: Record<string, string> = {
                        planta_baixa: "Planta Baixa",
                        planta_cobertura: "Planta Cobertura",
                        corte: "Corte",
                        fachada: "Fachada",
                        tabela_quantitativo: "Tabela Quantitativo",
                        quadro_esquadrias: "Quadro Esquadrias",
                        detalhe_construtivo: "Detalhe",
                        irrelevante: "Irrelevante",
                      };
                      return (
                        <Card
                          key={file.id}
                          data-testid={`card-file-${file.id}`}
                          className="cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all group relative"
                          onClick={() => setViewingFile(file)}
                        >
                          <Button
                            variant="destructive"
                            size="icon"
                            className="absolute top-2 right-2 h-7 w-7 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                            data-testid={`button-delete-file-${file.id}`}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm("Excluir este arquivo?")) return;
                              try {
                                const res = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
                                if (!res.ok) throw new Error("Erro");
                                queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
                                toast({ title: "Arquivo excluido" });
                              } catch {
                                toast({ title: "Erro ao excluir", variant: "destructive" });
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <CardContent className="p-4">
                            <div className="aspect-[3/4] bg-slate-100 dark:bg-slate-800 rounded-md mb-3 overflow-hidden relative">
                              {isImage ? (
                                <img
                                  src={fileUrl}
                                  alt={file.originalName}
                                  className="w-full h-full object-contain"
                                  data-testid={`img-preview-${file.id}`}
                                />
                              ) : isPdf ? (
                                <PdfViewer
                                  url={fileUrl}
                                  compact
                                  className="w-full h-full"
                                  data-testid={`pdf-preview-${file.id}`}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <FileText className="h-12 w-12 text-slate-400" />
                                </div>
                              )}
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                <Maximize2 className="h-8 w-8 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow-lg" />
                              </div>
                            </div>
                            <p className="text-sm font-medium truncate mb-2" data-testid={`text-filename-${file.id}`}>{file.originalName}</p>
                            <div className="flex items-center gap-2">
                              {file.pageType && (
                                <Badge variant="secondary" className="text-xs" data-testid={`badge-type-${file.id}`}>
                                  {pageTypeLabel[file.pageType] || file.pageType}
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-xs">
                                {isPdf ? "PDF" : isImage ? "Imagem" : "Arquivo"}
                              </Badge>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Dialog open={!!viewingFile} onOpenChange={(open) => { if (!open) setViewingFile(null); }}>
              <DialogContent className="max-w-[95vw] w-[95vw] max-h-[95vh] h-[95vh] p-0 overflow-hidden" aria-describedby={undefined}>
                <VisuallyHidden><DialogTitle>Visualizar Arquivo</DialogTitle></VisuallyHidden>
                {viewingFile && (() => {
                  const isImage = viewingFile.fileType === "image" || /\.(png|jpe?g)$/i.test(viewingFile.originalName || "");
                  const isPdf = viewingFile.fileType === "pdf" || /\.pdf$/i.test(viewingFile.originalName || "");
                  const fileUrl = `/api/files/${viewingFile.id}/content`;
                  const fileIndex = files?.findIndex((f: any) => f.id === viewingFile.id) ?? -1;
                  const canPrev = fileIndex > 0;
                  const canNext = files && fileIndex < files.length - 1;
                  return (
                    <div className="flex flex-col h-full" data-testid="dialog-file-viewer">
                      <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50 dark:bg-slate-900">
                        <div className="flex items-center gap-3">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={!canPrev}
                            onClick={() => canPrev && setViewingFile(files![fileIndex - 1])}
                            data-testid="button-prev-file"
                          >
                            <ChevronLeft className="h-5 w-5" />
                          </Button>
                          <span className="text-sm font-medium" data-testid="text-viewer-filename">
                            {viewingFile.originalName} ({fileIndex + 1}/{files?.length || 0})
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={!canNext}
                            onClick={() => canNext && setViewingFile(files![fileIndex + 1])}
                            data-testid="button-next-file"
                          >
                            <ChevronRight className="h-5 w-5" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          {viewingFile.pageType && (
                            <Badge variant="secondary">{viewingFile.pageType}</Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            asChild
                          >
                            <a href={fileUrl} target="_blank" rel="noopener noreferrer" data-testid="button-open-new-tab">
                              <Maximize2 className="h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                      </div>
                      <div className="flex-1 overflow-auto bg-slate-200 dark:bg-slate-950 flex items-center justify-center">
                        {isImage ? (
                          <img
                            src={fileUrl}
                            alt={viewingFile.originalName}
                            className="max-w-full max-h-full object-contain"
                            data-testid="img-fullview"
                          />
                        ) : isPdf ? (
                          <PdfViewer
                            url={fileUrl}
                            className="w-full h-full"
                            data-testid="pdf-fullview"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-4 text-slate-500">
                            <FileText className="h-16 w-16" />
                            <p>Visualizacao nao disponivel</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="quantitativos">
            {(() => {
              const fusao = (extractedData || []).find((d: any) => d.elementType === "etapa4_fusao");
              const annotatedPlan = (extractedData || []).find((d: any) => d.elementType === "etapa3_annotated_plan");
              const planWalls = liveWalls || fusao?.data?.resultado?.walls || [];
              const planSlabs = fusao?.data?.resultado?.slabs || [];
              const handleClickWall = (wallId: string) => {
                setHighlightedWallId(wallId);
                const el = document.getElementById(`wall-row-${wallId}`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
              };
              const hasBboxWalls = planWalls.some((w: any) => Array.isArray(w?.bbox) && w.bbox.length === 4);

              // Group walls by category for the Gemini-style summary
              const enabledWalls = planWalls.filter((w: any) => w.enabled !== false);
              const enabledSlabs = planSlabs.filter((s: any) => s.enabled !== false);
              const externas = enabledWalls.filter((w: any) => w.classe === "externa");
              const internas = enabledWalls.filter((w: any) => w.classe === "interna");
              const muros = enabledWalls.filter((w: any) => w.classe === "muro");
              const slabPiso = enabledSlabs.filter((s: any) => s.classe === "piso" || s.classe === "radier");
              const slabCoberta = enabledSlabs.filter((s: any) => s.classe === "coberta");
              const fmt = (n: number) => Number(n || 0).toFixed(2);
              const totalExt = externas.reduce((s: number, w: any) => s + (Number(w.comprimento_m) || 0), 0);
              const totalInt = internas.reduce((s: number, w: any) => s + (Number(w.comprimento_m) || 0), 0);
              const totalMuros = muros.reduce((s: number, w: any) => s + (Number(w.comprimento_m) || 0), 0);
              const totalPiso = slabPiso.reduce((s: number, l: any) => s + (Number(l.area_m2) || 0), 0);
              const totalCoberta = slabCoberta.reduce((s: number, l: any) => s + (Number(l.area_m2) || 0), 0);

              return (
                <div className="mb-6 space-y-6">
                  {/* Annotated floor plan image - shown prominently like Gemini output */}
                  {(() => {
                    // Support both new multi-floor format (data.images) and legacy single image (data.image)
                    const floorImages: Array<{ pavimento: string; image: string }> = [];
                    if (annotatedPlan?.data?.images && Array.isArray(annotatedPlan.data.images)) {
                      for (const img of annotatedPlan.data.images) {
                        if (img?.image) floorImages.push({ pavimento: img.pavimento || "all", image: img.image });
                      }
                    } else if (annotatedPlan?.data?.image) {
                      floorImages.push({ pavimento: "all", image: annotatedPlan.data.image });
                    }
                    if (floorImages.length === 0) return null;

                    const isMultiFloor = floorImages.length > 1;
                    const floorLabel = (pav: string) => {
                      if (pav === "all") return "Todos os Pavimentos";
                      return pav.charAt(0).toUpperCase() + pav.slice(1).replace(/_/g, " ");
                    };

                    const renderSummary = () => enabledWalls.length > 0 ? (
                      <div className="text-sm space-y-2 p-4 bg-muted/20 rounded-lg border">
                        <p className="font-semibold text-foreground">Resumo do Levantamento:</p>
                        {externas.length > 0 && (
                          <div className="flex items-start gap-2">
                            <span className="w-2 h-2 rounded-full bg-cyan-500 mt-1.5 shrink-0" />
                            <p className="text-slate-700 dark:text-slate-300">
                              <strong className="text-foreground">Paredes Externas ({externas.length}):</strong>{" "}
                              {externas.map((w: any) => `${w.id} (${fmt(w.comprimento_m)}m)`).join(", ")}.
                              {" "}<span className="text-muted-foreground text-xs">Total: {fmt(totalExt)}m lineares</span>
                            </p>
                          </div>
                        )}
                        {internas.length > 0 && (
                          <div className="flex items-start gap-2">
                            <span className="w-2 h-2 rounded-full bg-orange-500 mt-1.5 shrink-0" />
                            <p className="text-slate-700 dark:text-slate-300">
                              <strong className="text-foreground">Paredes Internas ({internas.length}):</strong>{" "}
                              {internas.map((w: any) => `${w.id} (${fmt(w.comprimento_m)}m)`).join(", ")}.
                              {" "}<span className="text-muted-foreground text-xs">Total: {fmt(totalInt)}m lineares</span>
                            </p>
                          </div>
                        )}
                        {muros.length > 0 && (
                          <div className="flex items-start gap-2">
                            <span className="w-2 h-2 rounded-full bg-purple-500 mt-1.5 shrink-0" />
                            <p className="text-slate-700 dark:text-slate-300">
                              <strong className="text-foreground">Muros de Divisa ({muros.length}):</strong>{" "}
                              {muros.map((w: any) => `${w.id} (${fmt(w.comprimento_m)}m)`).join(", ")}.
                              {" "}<span className="text-muted-foreground text-xs">Total: {fmt(totalMuros)}m lineares</span>
                            </p>
                          </div>
                        )}
                        {slabPiso.length > 0 && (
                          <div className="flex items-start gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                            <p className="text-slate-700 dark:text-slate-300">
                              <strong className="text-foreground">Laje de Piso ({slabPiso.length}):</strong>{" "}
                              {slabPiso.map((l: any, i: number) => `${l.id || `L${i+1}`} (${fmt(l.area_m2)}m²)`).join(", ")}.
                              {" "}<span className="text-muted-foreground text-xs">Total: {fmt(totalPiso)}m²</span>
                            </p>
                          </div>
                        )}
                        {slabCoberta.length > 0 && (
                          <div className="flex items-start gap-2">
                            <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                            <p className="text-slate-700 dark:text-slate-300">
                              <strong className="text-foreground">Laje Coberta ({slabCoberta.length}):</strong>{" "}
                              {slabCoberta.map((l: any, i: number) => `${l.id || `L${i+1}`} (${fmt(l.area_m2)}m²)`).join(", ")}.
                              {" "}<span className="text-muted-foreground text-xs">Total: {fmt(totalCoberta)}m²</span>
                            </p>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground pt-1 italic">
                          A tabela completa com todos os comprimentos esta visivel na imagem anotada abaixo.
                        </p>
                      </div>
                    ) : null;

                    const renderLegend = () => (
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-xs">
                        {[
                          { label: "Par. Externas", value: externas.length, sub: `${fmt(totalExt)}m`, color: "text-cyan-600", dot: "bg-cyan-500" },
                          { label: "Par. Internas", value: internas.length, sub: `${fmt(totalInt)}m`, color: "text-orange-600", dot: "bg-orange-500" },
                          { label: "Muros", value: muros.length, sub: `${fmt(totalMuros)}m`, color: "text-purple-600", dot: "bg-purple-500" },
                          { label: "Laje Piso", value: slabPiso.length, sub: `${fmt(totalPiso)}m²`, color: "text-emerald-600", dot: "bg-emerald-500" },
                          { label: "Laje Coberta", value: slabCoberta.length, sub: `${fmt(totalCoberta)}m²`, color: "text-red-600", dot: "bg-red-500" },
                        ].map(item => (
                          <div key={item.label} className="text-center p-2 bg-muted/30 rounded">
                            <div className="flex items-center justify-center gap-1 mb-1">
                              <span className={`w-2 h-2 rounded-full ${item.dot}`} />
                              <p className="text-muted-foreground text-[10px]">{item.label}</p>
                            </div>
                            <p className={`font-bold text-sm ${item.color}`}>{item.value}</p>
                            <p className="text-[10px] text-muted-foreground">{item.sub}</p>
                          </div>
                        ))}
                      </div>
                    );

                    return (
                      <Card data-testid="card-ai-annotated-plan">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2 text-base">
                              <Sparkles className="h-5 w-5 text-cyan-500" />
                              Planta Anotada pela IA
                            </CardTitle>
                            <a href={floorImages[0].image} download={`planta-anotada-${projectId}.png`}>
                              <Button variant="outline" size="sm">
                                <Download className="h-3.5 w-3.5 mr-1" /> Baixar
                              </Button>
                            </a>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {renderSummary()}
                          {isMultiFloor ? (
                            <Tabs defaultValue={floorImages[0].pavimento} className="w-full">
                              <TabsList className="w-full justify-start">
                                {floorImages.map((fi) => (
                                  <TabsTrigger key={fi.pavimento} value={fi.pavimento}>
                                    {floorLabel(fi.pavimento)}
                                  </TabsTrigger>
                                ))}
                              </TabsList>
                              {floorImages.map((fi) => (
                                <TabsContent key={fi.pavimento} value={fi.pavimento}>
                                  <img
                                    src={fi.image}
                                    alt={`Planta anotada - ${floorLabel(fi.pavimento)}`}
                                    className="block w-full h-auto rounded border"
                                    data-testid={`img-ai-annotated-plan-${fi.pavimento}`}
                                  />
                                </TabsContent>
                              ))}
                            </Tabs>
                          ) : (
                            <img
                              src={floorImages[0].image}
                              alt="Planta anotada pela IA"
                              className="block w-full h-auto rounded border"
                              data-testid="img-ai-annotated-plan"
                            />
                          )}
                          {renderLegend()}
                        </CardContent>
                      </Card>
                    );
                  })()}
                  {/* If no AI image, show bbox-based annotated plan or floor plan diagram */}
                  {!annotatedPlan?.data?.image && !annotatedPlan?.data?.images && planWalls.length > 0 && (
                    <>
                      {hasBboxWalls && files && files.length > 0 && (
                        <AnnotatedFloorPlan
                          projectId={Number(projectId)}
                          walls={planWalls}
                          files={files}
                          highlightedWallId={highlightedWallId}
                          onHoverWall={setHighlightedWallId}
                          onClickWall={handleClickWall}
                          preGeneratedImage={undefined}
                          preGeneratedSummary={undefined}
                        />
                      )}
                      <FloorPlanDiagram
                        walls={planWalls}
                        highlightedWallId={highlightedWallId}
                        onHoverWall={setHighlightedWallId}
                        onClickWall={handleClickWall}
                      />
                    </>
                  )}
                </div>
              );
            })()}
            <QuantitativosEditor
              projectId={projectId!}
              extractedData={extractedData || []}
              onRecalculated={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
              }}
              highlightedWallId={highlightedWallId}
              onHoverWall={setHighlightedWallId}
              onWallsChange={setLiveWalls}
            />
          </TabsContent>

          <TabsContent value="budget">
            {budget ? (
              <div className="space-y-6">
                {budget.alerts && budget.alerts.length > 0 && (
                  <Card className="border-orange-200 dark:border-orange-800">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-orange-500" />
                        Alertas e Inconsistencias
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {budget.alerts.map((alert: any, idx: number) => (
                          <div key={idx} data-testid={`alert-${idx}`} className={`p-3 rounded-lg border ${alert.level === "critical" ? "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800" : alert.level === "warning" ? "bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800" : "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800"}`}>
                            <p className="text-sm font-medium mb-1">[{alert.level.toUpperCase()}]</p>
                            <p className="text-sm">{alert.message}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {budget.apiHealth && (() => {
                  const { reliability, metrics } = budget.apiHealth;
                  const isHigh = reliability.level === "high";
                  const isMedium = reliability.level === "medium";
                  const borderColor = isHigh ? "border-emerald-200 dark:border-emerald-800" : isMedium ? "border-amber-200 dark:border-amber-800" : "border-red-200 dark:border-red-800";
                  const bgColor = isHigh ? "bg-emerald-50 dark:bg-emerald-900/20" : isMedium ? "bg-amber-50 dark:bg-amber-900/20" : "bg-red-50 dark:bg-red-900/20";
                  const textColor = isHigh ? "text-emerald-700 dark:text-emerald-400" : isMedium ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
                  const ShieldIcon = isHigh ? ShieldCheck : isMedium ? Shield : ShieldAlert;
                  return (
                    <Card className={borderColor} data-testid="card-api-health">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2">
                          <ShieldIcon className={`h-5 w-5 ${textColor}`} />
                          <span>Confiabilidade do Processamento</span>
                          <Badge variant={isHigh ? "default" : isMedium ? "secondary" : "destructive"} className="ml-2" data-testid="badge-reliability-score">
                            {reliability.score}%
                          </Badge>
                        </CardTitle>
                        <CardDescription>
                          {isHigh ? "A API respondeu bem durante o processamento. Os resultados sao confiaveis." :
                           isMedium ? "Houve alguns problemas com a API durante o processamento. Os resultados podem ter imprecisoes." :
                           "A API teve problemas significativos. Recomenda-se reprocessar o projeto para resultados mais confiaveis."}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                          <div className={`p-3 rounded-lg ${bgColor}`}>
                            <div className="text-xs text-muted-foreground">Chamadas API</div>
                            <div className="text-lg font-semibold" data-testid="text-total-calls">{metrics.totalCalls}</div>
                            <div className="text-xs text-muted-foreground">{metrics.successfulCalls} ok / {metrics.failedCalls} falha(s)</div>
                          </div>
                          <div className={`p-3 rounded-lg ${metrics.totalRetries > 0 ? "bg-amber-50 dark:bg-amber-900/20" : bgColor}`}>
                            <div className="text-xs text-muted-foreground">Retentativas</div>
                            <div className="text-lg font-semibold" data-testid="text-retries">{metrics.totalRetries}</div>
                            <div className="text-xs text-muted-foreground">{metrics.rateLimitHits > 0 ? `${metrics.rateLimitHits} rate limit` : "sem rate limit"}</div>
                          </div>
                          <div className={`p-3 rounded-lg ${metrics.jsonParseRetries > 0 ? "bg-amber-50 dark:bg-amber-900/20" : bgColor}`}>
                            <div className="text-xs text-muted-foreground">Reparse JSON</div>
                            <div className="text-lg font-semibold" data-testid="text-json-retries">{metrics.jsonParseRetries}</div>
                            <div className="text-xs text-muted-foreground">{metrics.jsonParseRetries > 0 ? "respostas corrigidas" : "sem problemas"}</div>
                          </div>
                          <div className={`p-3 rounded-lg ${metrics.failedPages?.length > 0 ? "bg-red-50 dark:bg-red-900/20" : bgColor}`}>
                            <div className="text-xs text-muted-foreground">Paginas c/ erro</div>
                            <div className="text-lg font-semibold" data-testid="text-failed-pages">{metrics.failedPages?.length || 0}</div>
                            <div className="text-xs text-muted-foreground">{metrics.failedPages?.length > 0 ? "nao analisadas" : "todas ok"}</div>
                          </div>
                        </div>
                        {metrics.verification && (
                          <div className="mb-4 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
                            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-2">
                              <ShieldCheck className="h-3 w-3" />
                              Verificacao Cross-Model
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                              <div>
                                <div className="text-xs text-muted-foreground">Modelo Verificador</div>
                                <div className="text-sm font-semibold" data-testid="text-verification-model">{metrics.verification.verificationModel}</div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">Tipo</div>
                                <div className="text-sm font-semibold" data-testid="text-verification-type">
                                  {metrics.verification.isCrossModel ? (
                                    <span className="text-blue-600 dark:text-blue-400">Cross-model</span>
                                  ) : (
                                    <span className="text-slate-500">Auto-verificacao</span>
                                  )}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">Resultado</div>
                                <div className="text-sm font-semibold" data-testid="text-verification-result">
                                  {metrics.verification.hadCorrections ? (
                                    <span className="text-amber-600 dark:text-amber-400">Correcoes aplicadas</span>
                                  ) : (
                                    <span className="text-emerald-600 dark:text-emerald-400">Aprovado</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            {metrics.verification.fallbackUsed && (
                              <div className="mt-2 text-xs text-amber-600 dark:text-amber-400" data-testid="text-verification-fallback">
                                Fallback: OpenAI falhou, Gemini foi usado como verificador. Motivo: {metrics.verification.fallbackReason}
                              </div>
                            )}
                          </div>
                        )}
                        {reliability.factors.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                              <Activity className="h-3 w-3" />
                              Fatores que afetam a confiabilidade
                            </div>
                            {reliability.factors.map((factor: string, idx: number) => (
                              <div key={idx} className={`text-sm px-3 py-1.5 rounded ${isHigh ? "text-emerald-700 dark:text-emerald-400" : isMedium ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400"} ${bgColor}`} data-testid={`text-reliability-factor-${idx}`}>
                                {factor}
                              </div>
                            ))}
                          </div>
                        )}
                        {budget.apiHealth.processedAt && (
                          <div className="mt-3 text-xs text-muted-foreground">
                            Processado em: {new Date(budget.apiHealth.processedAt).toLocaleString("pt-BR")}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })()}

                {budget.proposta?.itens ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Proposta Comercial - Paineis Lightwall</CardTitle>
                      <CardDescription>Formato baseado na proposta comercial padrao Lightwall</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm" data-testid="table-proposta">
                          <thead>
                            <tr className="border-b-2 border-slate-300 dark:border-slate-600">
                              <th className="text-left p-3 font-semibold">ITEM</th>
                              <th className="text-left p-3 font-semibold">LOCAL DE APLICACAO</th>
                              <th className="text-left p-3 font-semibold">DISCRIMINACAO</th>
                              <th className="text-right p-3 font-semibold">QTD (UN)</th>
                              <th className="text-right p-3 font-semibold">QTD (M2)</th>
                              <th className="text-right p-3 font-semibold">PRECO (M2)</th>
                              <th className="text-right p-3 font-semibold">PRECO TOTAL</th>
                            </tr>
                          </thead>
                          <tbody>
                            {budget.proposta.itens.map((item: any) => (
                              <tr key={item.item} className="border-b" data-testid={`proposta-item-${item.item}`}>
                                <td className="p-3 font-medium">{item.item}</td>
                                <td className="p-3">{item.local}</td>
                                <td className="p-3 text-xs">{item.discriminacao}</td>
                                <td className="p-3 text-right font-medium">{item.qtd_un}</td>
                                <td className="p-3 text-right">{item.qtd_m2?.toLocaleString("pt-BR", { minimumFractionDigits: 3 })}</td>
                                <td className="p-3 text-right">R$ {item.preco_m2?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                                <td className="p-3 text-right font-medium">R$ {item.preco_total?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800">
                              <td colSpan={3} className="p-3 font-bold">TOTAL PAINEIS:</td>
                              <td className="p-3 text-right font-bold" data-testid="text-total-panels">{budget.proposta.total_paineis_un}</td>
                              <td className="p-3 text-right font-bold">{budget.proposta.total_area_m2?.toLocaleString("pt-BR", { minimumFractionDigits: 3 })}</td>
                              <td className="p-3"></td>
                              <td className="p-3 text-right font-bold">R$ {budget.proposta.total_paineis_cost?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      {budget.proposta.paginacao && (
                        <div className="mt-6">
                          <h4 className="font-semibold mb-3">Projeto de Paginacao</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b-2 border-slate-300 dark:border-slate-600">
                                  <th className="text-left p-3 font-semibold">ITEM</th>
                                  <th className="text-left p-3 font-semibold">DISCRIMINACAO</th>
                                  <th className="text-right p-3 font-semibold">QTD (UN)</th>
                                  <th className="text-right p-3 font-semibold">QTD (M2)</th>
                                  <th className="text-right p-3 font-semibold">PRECO (M2)</th>
                                  <th className="text-right p-3 font-semibold">PRECO TOTAL</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-b">
                                  <td className="p-3 font-medium">1</td>
                                  <td className="p-3">{budget.proposta.paginacao.discriminacao}</td>
                                  <td className="p-3 text-right font-medium">{budget.proposta.paginacao.qtd_un}</td>
                                  <td className="p-3 text-right">{budget.proposta.paginacao.qtd_m2?.toLocaleString("pt-BR", { minimumFractionDigits: 3 })}</td>
                                  <td className="p-3 text-right">R$ {budget.proposta.paginacao.preco_m2?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                                  <td className="p-3 text-right font-medium">R$ {budget.proposta.paginacao.preco_total?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                                </tr>
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800">
                                  <td colSpan={3} className="p-3 font-bold">TOTAL:</td>
                                  <td className="p-3 text-right font-bold">{budget.proposta.paginacao.qtd_m2?.toLocaleString("pt-BR", { minimumFractionDigits: 3 })}</td>
                                  <td className="p-3"></td>
                                  <td className="p-3 text-right font-bold">R$ {budget.proposta.paginacao.preco_total?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      )}

                      <div className="mt-6 flex justify-between items-center py-4 px-6 bg-primary/5 rounded-lg">
                        <span className="text-lg font-bold">VALOR TOTAL DA PROPOSTA</span>
                        <span className="text-2xl font-bold text-primary" data-testid="text-grand-total">
                          R$ {(budget.proposta.grandTotal || budget.costs?.grandTotal || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ) : budget.costs && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Custo Estimado</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="flex justify-between items-center py-2 border-b">
                          <span className="text-sm">Paineis 2P ({budget.totals?.totalPanels || 0} un)</span>
                          <span className="font-medium">
                            R$ {(budget.costs.panels?.total || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-3 bg-primary/5 rounded-lg px-4">
                          <span className="text-lg font-bold">TOTAL ESTIMADO</span>
                          <span className="text-2xl font-bold text-primary" data-testid="text-grand-total">
                            R$ {(budget.costs.grandTotal || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {budget.budget7etapas?.pavimentos && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Detalhamento por Pavimento</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {budget.budget7etapas.pavimentos.map((pav: any, idx: number) => (
                          <div key={idx} className="border rounded-lg p-4" data-testid={`floor-${idx}`}>
                            <h4 className="font-semibold text-lg mb-3">{pav.nome}</h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 text-sm">
                              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3">
                                <p className="text-slate-500 text-xs mb-1">Paredes Externas</p>
                                <p className="font-bold">{pav.paredes_externas.quantidade_paineis} paineis</p>
                                <p className="text-xs text-slate-400">{pav.paredes_externas.comprimento_total_m}m | {pav.paredes_externas.area_liquida_m2}m2 liq.</p>
                              </div>
                              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3">
                                <p className="text-slate-500 text-xs mb-1">Paredes Internas</p>
                                <p className="font-bold">{pav.paredes_internas.quantidade_paineis} paineis</p>
                                <p className="text-xs text-slate-400">{pav.paredes_internas.comprimento_total_m}m | {pav.paredes_internas.area_liquida_m2}m2 liq.</p>
                              </div>
                              {pav.muros && pav.muros.comprimento_total_m > 0 && (
                                <div className="bg-purple-50 dark:bg-purple-950/30 rounded p-3" data-testid={`floor-${idx}-muros`}>
                                  <p className="text-purple-600 dark:text-purple-300 text-xs mb-1">Muros (divisa)</p>
                                  <p className="font-bold">{pav.muros.quantidade_paineis} paineis</p>
                                  <p className="text-xs text-slate-400">{pav.muros.comprimento_total_m}m | {pav.muros.area_bruta_m2}m2</p>
                                </div>
                              )}
                              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3">
                                <p className="text-slate-500 text-xs mb-1">Laje Piso</p>
                                <p className="font-bold">{pav.laje_piso.quantidade_paineis} paineis</p>
                                <p className="text-xs text-slate-400">{pav.laje_piso.area_m2}m2{pav.laje_piso.is_radier ? " (radier)" : ""}</p>
                              </div>
                              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3">
                                <p className="text-slate-500 text-xs mb-1">Laje Coberta</p>
                                <p className="font-bold">{pav.laje_coberta.quantidade_paineis} paineis</p>
                                <p className="text-xs text-slate-400">{pav.laje_coberta.area_m2}m2</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-slate-600">Total de Paineis</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">
                        {budget.proposta?.total_paineis_un || budget.totals?.totalPanels || budget.budget7etapas?.resumo?.total_geral_paineis || 0}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">unidades (2P)</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-slate-600">Area Total</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold" data-testid="text-total-area">
                        {(budget.proposta?.total_area_m2 || ((budget.totals?.totalPanels || 0) * 1.83))?.toLocaleString("pt-BR", { minimumFractionDigits: 3 })}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">m2</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-slate-600">Preco por m2</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        Ext: R$ {(budget.proposta?.preco_m2_ext || budget.proposta?.preco_m2 || 275)?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{budget.proposta?.painel_ext || "Painel Externo"}</p>
                      <div className="text-2xl font-bold mt-2">
                        Int: R$ {(budget.proposta?.preco_m2_int || budget.proposta?.preco_m2 || 180)?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{budget.proposta?.painel_int || "Painel Interno"}</p>
                    </CardContent>
                  </Card>
                </div>

                {budget.costs?.complementar && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Custos Complementares (Estimativa)</CardTitle>
                      <CardDescription>Valores de referencia para materiais e mao de obra, nao inclusos na proposta de paineis</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center py-2 border-b text-sm">
                          <span>Materiais Complementares</span>
                          <span className="font-medium">R$ {(budget.costs.complementar.materials?.total || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b text-sm">
                          <span>Mao de Obra ({budget.costs.complementar.labor?.hours?.toFixed(1) || 0}h)</span>
                          <span className="font-medium">R$ {(budget.costs.complementar.labor?.total || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {budget.budget7etapas?.aviso && (
                  <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <p className="text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
                      <Info className="h-4 w-4" />
                      {budget.budget7etapas.aviso}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <Card>
                <CardContent className="text-center py-12">
                  <p className="text-slate-500">Orcamento ainda nao gerado. Processe o projeto primeiro.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="metodologia">
            <Metodologia />
          </TabsContent>

          <TabsContent value="export">
            <Card>
              <CardHeader>
                <CardTitle>Exportar Orcamento</CardTitle>
                <CardDescription>Escolha o formato de exportacao do orcamento</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="cursor-pointer hover:shadow-md transition-shadow">
                    <CardContent className="p-6 text-center">
                      <FileText className="h-12 w-12 mx-auto text-red-500 mb-4" />
                      <h3 className="text-lg font-semibold mb-2">PDF</h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">Relatorio formatado para impressao</p>
                      <Button onClick={() => handleExport("pdf")} className="w-full" data-testid="button-export-pdf">
                        <Download className="h-4 w-4 mr-2" />
                        Exportar PDF
                      </Button>
                    </CardContent>
                  </Card>
                  <Card className="cursor-pointer hover:shadow-md transition-shadow">
                    <CardContent className="p-6 text-center">
                      <FileText className="h-12 w-12 mx-auto text-green-500 mb-4" />
                      <h3 className="text-lg font-semibold mb-2">Excel</h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">Planilha completa com 6 abas</p>
                      <Button onClick={() => handleExport("excel")} className="w-full" data-testid="button-export-excel">
                        <Download className="h-4 w-4 mr-2" />
                        Exportar Excel
                      </Button>
                    </CardContent>
                  </Card>
                  <Card className="cursor-pointer hover:shadow-md transition-shadow">
                    <CardContent className="p-6 text-center">
                      <FileText className="h-12 w-12 mx-auto text-blue-500 mb-4" />
                      <h3 className="text-lg font-semibold mb-2">JSON</h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">Dados estruturados para integracoes</p>
                      <Button onClick={() => handleExport("json")} className="w-full" data-testid="button-export-json">
                        <Download className="h-4 w-4 mr-2" />
                        Exportar JSON
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
