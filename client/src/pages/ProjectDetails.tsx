import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { useDropzone } from "react-dropzone";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { apiRequest } from "@/lib/queryClient";
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
  ChevronDown,
  ChevronUp,
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
  Fingerprint,
  Mail,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import PdfViewer from "@/components/PdfViewer";
import Metodologia from "@/components/Metodologia";
import QuantitativosEditor, { type QuantitativosEditorHandle } from "@/components/QuantitativosEditor";
import FloorPlanDiagram from "@/components/FloorPlanDiagram";
import AnnotatedFloorPlan from "@/components/AnnotatedFloorPlan";
import { LightwallDots } from "@/components/LightwallLogo";
import { PageHeader } from "@/components/PageHeader";
import { ProcessingLiveView } from "@/components/live-pipeline/ProcessingLiveView";
import { useProcessingEvents } from "@/components/live-pipeline/useProcessingEvents";
import { WorkspaceLayout } from "@/components/processing/WorkspaceLayout";
import { VisionDirectSummary } from "@/components/visionDirect/Summary";
import { VisionDirectAnnotatedImages } from "@/components/visionDirect/AnnotatedImages";
import { VisionDirectConsolidatedTable } from "@/components/visionDirect/ConsolidatedTable";
import { VisionDirectPageBreakdown } from "@/components/visionDirect/PageBreakdown";
import { VisionDirectNotes } from "@/components/visionDirect/Notes";
import { VisionDirectLiveView } from "@/components/visionDirect/LiveView";
import { VisionDirectPipelineTimeline } from "@/components/visionDirect/PipelineTimeline";
import { VisionDirectQuantEditor } from "@/components/visionDirect/QuantEditor";
import type { VisionDirectResult } from "@/components/visionDirect/types";
import { useNewWorkspaceUI } from "@/components/processing/useProcessingSync";
import { LoadingState } from "@/components/ui/states";
import { ProjectHeader } from "@/components/project/ProjectHeader";
import { DraftWorkspace } from "@/components/project/DraftWorkspace";
import { SimpleProjectConfig } from "@/components/project/SimpleProjectConfig";
import { ErrorState } from "@/components/project/ErrorState";
import { CompletedFooter } from "@/components/project/CompletedFooter";
import { ProjectSidebar } from "@/components/project/ProjectSidebar";
import type { Product } from "@shared/schema";

interface PipelineStep {
  step: number;
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
  parentStep?: number;
  displayNum?: number;
  startedAt?: number;
  completedAt?: number;
}

const STEP_CONFIG: Array<{ step: number; label: string; parentStep?: number; displayNum?: number }> = [
  { step: 0.5, label: "Pre-flight", parentStep: 1 },
  { step: 1, label: "Classificacao + Tabelas", displayNum: 1 },
  { step: 3, label: "Extracao Geometrica", displayNum: 2 },
  { step: 3.5, label: "Verificacao IA", parentStep: 3 },
  { step: 4, label: "Fusao Multivista", displayNum: 3 },
  { step: 4.5, label: "Validacao Geometrica", parentStep: 4 },
  { step: 4.6, label: "Validacao Global IA", parentStep: 4 },
  { step: 5, label: "Calculo de Quantitativos", displayNum: 4 },
  { step: 6, label: "Integracao com Catalogo", displayNum: 5 },
  { step: 7, label: "Validacao", displayNum: 6 },
  { step: 7.5, label: "Imagem Anotada", displayNum: 7 },
  { step: 8, label: "Descricao do Projeto", displayNum: 8 },
];

function SourceBadge({ src, reviewCount, testid }: { src?: string; reviewCount?: number; testid?: string }) {
  if (!src) return null;
  const cls = src.startsWith("table")
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
    : src.startsWith("pdf_vector")
    ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
    : src === "ai_vision_takeoff"
    ? "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200"
    : src.startsWith("inferred")
    ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
    : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200";
  const shortLabel = src.startsWith("table") ? "tabela"
    : src.startsWith("pdf_vector") ? "vetor PDF"
    : src === "ai_vision_takeoff" ? "OpenAI"
    : src.startsWith("inferred") ? "inferido"
    : src.startsWith("ai") ? "IA" : src;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1" data-testid={testid}>
      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`} title={`fonte: ${src}`}>{shortLabel}</span>
      {reviewCount && reviewCount > 0 ? (
        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" title="Paredes marcadas para revisao manual">
          {reviewCount} revisar
        </span>
      ) : null}
    </div>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return "<1s";
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins > 0) return `${mins}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

// Overlay clicavel sobre a planta anotada pela IA. Cada parede com bbox vira
// uma area clicavel que cicla a classe (externa -> interna -> muro) via o
// handle do QuantitativosEditor. Bbox e normalizado 0-1000 (mesmo padrao da IA).
type SideHint = { xNorm: number; yNorm: number; side: "exterior" | "interior"; id?: number; pavimento?: string };
type ClickMode = "wall" | "exterior" | "interior";

function InteractiveAnnotatedPlan({
  src,
  alt,
  testId,
  walls,
  onClickWall,
  onHoverWall,
  highlightedWallId,
  mode = "wall",
  hints = [],
  onAddHint,
  onRemoveHint,
}: {
  src: string;
  alt: string;
  testId: string;
  walls: Array<{ id: string; classe: string; bbox?: number[]; enabled?: boolean; needs_review?: boolean }>;
  onClickWall: (wallId: string) => void;
  onHoverWall?: (wallId: string | null) => void;
  highlightedWallId?: string | null;
  mode?: ClickMode;
  hints?: SideHint[];
  onAddHint?: (xNorm: number, yNorm: number, side: "exterior" | "interior") => void;
  onRemoveHint?: (hint: SideHint) => void;
}) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setDims({ w: el.clientWidth, h: el.clientHeight });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [src]);

  const colorFor = (c: string) =>
    c === "externa" ? "#dc2626" : c === "muro" ? "#1d4ed8" : "#16a34a";

  const wallsWithBbox = walls.filter(
    (w) => Array.isArray(w.bbox) && w.bbox.length >= 4,
  );

  return (
    <div className="relative inline-block w-full">
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className="block w-full h-auto rounded border"
        data-testid={testId}
        onLoad={(e) => {
          const img = e.currentTarget;
          setDims({ w: img.clientWidth, h: img.clientHeight });
        }}
      />
      {dims && (
        <svg
          className={`absolute top-0 left-0 ${mode === "wall" ? "pointer-events-none" : ""}`}
          width={dims.w}
          height={dims.h}
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          style={{ width: dims.w, height: dims.h, cursor: mode === "wall" ? undefined : "crosshair" }}
          onClick={(ev) => {
            if (mode === "wall") return;
            const rect = (ev.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = ev.clientX - rect.left;
            const py = ev.clientY - rect.top;
            const xNorm = Math.max(0, Math.min(1000, Math.round((px / dims.w) * 1000)));
            const yNorm = Math.max(0, Math.min(1000, Math.round((py / dims.h) * 1000)));
            onAddHint?.(xNorm, yNorm, mode);
          }}
        >
          {wallsWithBbox.map((w) => {
            const [ymin, xmin, ymax, xmax] = w.bbox as number[];
            const x = (xmin / 1000) * dims.w;
            const y = (ymin / 1000) * dims.h;
            const width = ((xmax - xmin) / 1000) * dims.w;
            const height = ((ymax - ymin) / 1000) * dims.h;
            const color = colorFor(w.classe);
            const isHighlighted = highlightedWallId === w.id;
            const isDimmed = highlightedWallId && highlightedWallId !== w.id;
            const enabled = w.enabled !== false;
            const groupOpacity = isDimmed ? 0.45 : enabled ? 1 : 0.55;
            // O servidor agora desenha retangulos + labels diretamente na imagem
            // (renderAnnotatedImage). Esta camada SVG existe apenas para
            // interacao (hover/click/highlight) — por isso o retangulo e
            // INVISIVEL por padrao, aparecendo somente em hover/highlight ou
            // quando a parede precisa de revisao.
            const needsReview = w.needs_review === true;
            const showFill = isHighlighted;
            const showStroke = isHighlighted || needsReview;
            return (
              <g
                key={w.id}
                className={mode === "wall" ? "pointer-events-auto cursor-pointer" : "pointer-events-none"}
                onMouseEnter={() => mode === "wall" && onHoverWall?.(w.id)}
                onMouseLeave={() => mode === "wall" && onHoverWall?.(null)}
                onClick={(ev) => {
                  if (mode !== "wall") return;
                  ev.stopPropagation();
                  onClickWall(w.id);
                }}
                data-testid={`overlay-ai-wall-${w.id}`}
                style={{ opacity: groupOpacity }}
              >
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill={showFill ? color : "transparent"}
                  fillOpacity={showFill ? 0.32 : 0}
                  stroke={showStroke ? color : "transparent"}
                  strokeWidth={isHighlighted ? 4 : needsReview ? 2 : 0}
                  strokeDasharray={needsReview && !isHighlighted ? "6 4" : undefined}
                />
              </g>
            );
          })}
          {hints.map((h, i) => {
            const cx = (h.xNorm / 1000) * dims.w;
            const cy = (h.yNorm / 1000) * dims.h;
            const color = h.side === "exterior" ? "#ea580c" : "#0891b2";
            return (
              <g
                key={`hint-${i}`}
                className="pointer-events-auto cursor-pointer"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onRemoveHint?.(h);
                }}
                data-testid={`hint-${h.side}-${i}`}
              >
                <circle cx={cx} cy={cy} r={10} fill={color} fillOpacity={0.85} stroke="#fff" strokeWidth={2} />
                <text x={cx} y={cy + 4} textAnchor="middle" fill="#fff" fontSize={11} fontWeight="bold">
                  {h.side === "exterior" ? "E" : "I"}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export default function ProjectDetails() {
  const [, params] = useRoute("/project/:id");
  const projectId = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  // Fase E.7: feature flag pra nova interface da aba processamento.
  const newWorkspace = useNewWorkspaceUI();
  /** Quando o usuario aperta "Abrir abas detalhadas", reverte temporariamente
   *  pra UI antiga (8 abas) sem desligar o flag global do workspace novo. */
  const [showLegacyTabs, setShowLegacyTabs] = useState(false);
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
  const [analysisMode, setAnalysisMode] = useState<string>(() => {
    return localStorage.getItem(`analysis-mode-${params?.id}`) || "gemini-only";
  });
  const [peDireito, setPeDireito] = useState<number>(() => {
    const saved = localStorage.getItem(`pe-direito-${params?.id}`);
    return saved ? parseFloat(saved) : 3.0;
  });
  const [scope, setScope] = useState({
    paredesExternas: true,
    paredesInternas: true,
    muros: true,
    lajePiso: true,
    lajeCoberta: true,
  });
  const [viewingFile, setViewingFile] = useState<any | null>(null);
  const [editingInfo, setEditingInfo] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [editName, setEditName] = useState("");
  const [editClient, setEditClient] = useState("");
  const [highlightedWallId, setHighlightedWallId] = useState<string | null>(null);
  const [liveWalls, setLiveWalls] = useState<any[] | null>(null);
  const editorRef = useRef<QuantitativosEditorHandle | null>(null);
  // Marcadores humanos de lado exterior/interior sobre a planta anotada
  const [clickMode, setClickMode] = useState<ClickMode>("wall");
  const [pendingHints, setPendingHints] = useState<SideHint[]>([]);
  const [hintsDirty, setHintsDirty] = useState(false);
  const [activeAnnotPav, setActiveAnnotPav] = useState<string>("all");
  const eventSourceRef = useRef<EventSource | null>(null);
  const sseRetryRef = useRef<number>(0);
  const [pipelineStartTime, setPipelineStartTime] = useState<number | null>(null);
  const [tickNow, setTickNow] = useState(Date.now());
  const [alertsCollapsed, setAlertsCollapsed] = useState(false);

  const uploadFiles = useCallback(async (selected: File[]) => {
    if (!selected || selected.length === 0) return;
    const allowed = /\.(pdf|png|jpe?g|webp|bmp|tiff?|ifc)$/i;
    const valid = selected.filter(f => allowed.test(f.name));
    if (valid.length === 0) {
      toast({ title: "Formato não suportado", description: "Use PDF, PNG, JPG, WEBP, BMP, TIFF ou IFC.", variant: "destructive" });
      return;
    }
    const formData = new FormData();
    for (const f of valid) formData.append("files", f);
    try {
      const res = await fetch(`/api/projects/${projectId}/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({} as any));
        throw new Error(errBody?.message || `Erro no upload (HTTP ${res.status})`);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({ title: `${valid.length} arquivo(s) adicionado(s)` });
    } catch (err: any) {
      toast({
        title: "Erro no upload",
        description: err?.message || "Falha desconhecida ao enviar arquivo.",
        variant: "destructive",
      });
    }
  }, [projectId, queryClient, toast]);

  const { getRootProps: getFilesRootProps, getInputProps: getFilesInputProps, isDragActive: isFilesDragActive } = useDropzone({
    accept: {
      "application/pdf": [".pdf"],
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
      "image/bmp": [".bmp"],
      "image/tiff": [".tif", ".tiff"],
      "application/octet-stream": [".ifc"],
    },
    noClick: true,
    noKeyboard: true,
    onDrop: (accepted) => uploadFiles(accepted),
  });

  const toggleExpanded = (id: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const { data: currentUser } = useQuery<{ username: string; displayName: string | null; role: string }>({
    queryKey: ["/api/auth/me"],
  });
  const isAdmin = currentUser?.role === "admin";

  const { data, isLoading } = useQuery({
    queryKey: ["/api/projects", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Erro ao buscar projeto");
      return res.json();
    },
    enabled: !!projectId,
    // Polling 100% confiavel: refetch a cada 2.5s enquanto status=processing,
    // para automaticamente quando muda para completed/error. Substitui o
    // useEffect manual que so disparava na MUDANCA de status (bug que fazia
    // polling morrer apos 1 iteracao).
    refetchInterval: (query: any) =>
      query.state.data?.project?.status === "processing" ? 2500 : false,
  });

  const { data: catalogProducts } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  // Telemetria do pipeline (tempo total + custo IA + tokens). Hidrata via
  // GET /pipeline-events automaticamente. SSE so abre quando isProcessing.
  // IMPORTANTE: chamar este hook ANTES dos early-returns (isLoading, !data)
  // pra preservar a ordem dos hooks entre renders (React hook rules).
  const telemetry = useProcessingEvents({
    projectId: projectId || 0,
    enabled: !!projectId && isProcessing,
  });
  // Marcadores humanos de lado exterior/interior persistidos pra este projeto
  const { data: serverHints } = useQuery<Array<{ id: number; pavimento: string; xNorm: number; yNorm: number; side: "exterior" | "interior" }>>({
    queryKey: ["/api/projects", projectId, "side-hints"],
    enabled: !!projectId,
  });
  useEffect(() => {
    if (serverHints && !hintsDirty) {
      setPendingHints(serverHints.map(h => ({ id: h.id, pavimento: h.pavimento, xNorm: h.xNorm, yNorm: h.yNorm, side: h.side })));
    }
  }, [serverHints, hintsDirty]);
  const saveHintsMutation = useMutation({
    mutationFn: async (hints: SideHint[]) => {
      const payload = { hints: hints.map(h => ({ pavimento: h.pavimento || "all", xNorm: h.xNorm, yNorm: h.yNorm, side: h.side })) };
      const res = await apiRequest("PUT", `/api/projects/${projectId}/side-hints`, payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      setHintsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "side-hints"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({
        title: "Marcadores salvos",
        description: data?.reclassified > 0
          ? `${data.reclassified} parede(s) reclassificada(s) pelos marcadores.`
          : "Marcadores aplicados (nenhuma parede precisou ser reclassificada).",
      });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar marcadores", description: err?.message || "Tente novamente.", variant: "destructive" });
    },
  });
  const addHint = (xNorm: number, yNorm: number, side: "exterior" | "interior", pavimento: string) => {
    setPendingHints(prev => [...prev, { xNorm, yNorm, side, pavimento }]);
    setHintsDirty(true);
  };
  const removeHint = (hint: SideHint) => {
    setPendingHints(prev => prev.filter(h => !(h.xNorm === hint.xNorm && h.yNorm === hint.yNorm && h.side === hint.side && (h.pavimento || "all") === (hint.pavimento || "all"))));
    setHintsDirty(true);
  };
  const clearHintsForPav = (pav: string) => {
    setPendingHints(prev => prev.filter(h => (h.pavimento || "all") !== pav));
    setHintsDirty(true);
  };
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
    if (analysisMode) localStorage.setItem(`analysis-mode-${params.id}`, analysisMode);
    localStorage.setItem(`pe-direito-${params.id}`, String(peDireito));
  }, [params?.id, selectedProductIdExt, selectedProductIdInt, selectedProductIdMuros, selectedProductIdPiso, selectedProductIdCoberta, analysisMode, peDireito]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Timer desacoplado de `isProcessing`. Roda enquanto o pipeline foi iniciado
  // (pipelineStartTime) e ainda nao reportou conclusao real (todas etapas
  // principais terminadas). Mesmo se o SSE cair e isProcessing virar false,
  // o cronometro continua andando ate o backend reportar terminal de fato.
  useEffect(() => {
    if (pipelineStartTime == null) return;
    // Conferimos se todas as etapas principais terminaram. Se nao, mantemos
    // o tick. Se nao ha etapas registradas ainda, tambem mantemos (estamos
    // no "warm-up" entre disparo do processamento e primeiro evento SSE).
    const mainStepsDone =
      pipelineSteps.length > 0 &&
      pipelineSteps.filter(s => !s.parentStep).every(s => s.status === "done" || s.status === "error");
    if (mainStepsDone) return;
    const interval = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [pipelineStartTime, pipelineSteps]);

  const startSSE = (isReconnect = false) => {
    if (eventSourceRef.current) eventSourceRef.current.close();

    if (!isReconnect) {
      const now = Date.now();
      const initSteps: PipelineStep[] = STEP_CONFIG.map(s => ({
        step: s.step,
        label: s.label,
        status: "pending" as const,
        parentStep: s.parentStep,
        displayNum: s.displayNum,
      }));
      setPipelineSteps(initSteps);
      setPipelineStartTime(now);
      setTickNow(now);
      sseRetryRef.current = 0;
    }

    const es = new EventSource(`/api/projects/${projectId}/progress`);
    eventSourceRef.current = es;
    es.onopen = () => { sseRetryRef.current = 0; };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.step === 0) {
          setTickNow(Date.now());
          const isTerminal = data.label === "Concluido" || data.label === "Erro";
          if (isTerminal && data.status === "done") {
            setIsProcessing(false);
            es.close();
            queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
          } else if (isTerminal && data.status === "error") {
            setIsProcessing(false);
            es.close();
          }
          return;
        }
        const ts = Date.now();
        const eventConfig = STEP_CONFIG.find(c => c.step === data.step);
        const isSubStepEvent = eventConfig?.parentStep != null;
        const isKnownStep = !!eventConfig;

        setPipelineSteps(prev => prev.map(s => {
          if (s.step === data.step) {
            return {
              ...s,
              status: data.status,
              label: data.label || s.label,
              detail: data.detail,
              startedAt: s.startedAt || ts,
              completedAt: data.status === "done" || data.status === "error" ? ts : s.completedAt,
            };
          }
          if (!isKnownStep || isSubStepEvent) return s;
          if (s.status !== "pending") return s;
          const eventMainStep = eventConfig.parentStep ?? data.step;
          const sMainStep = s.parentStep ?? s.step;
          if (sMainStep < eventMainStep) {
            return { ...s, status: "done" as const, completedAt: ts, startedAt: s.startedAt || ts };
          }
          return s;
        }));
      } catch {}
    };

    es.onerror = () => {
      // Do NOT close + stop processing on transient SSE errors. Long
      // pipeline steps can briefly drop the connection through proxies.
      // EventSource auto-reconnects unless we close it. Only treat the
      // connection as truly dead if the browser reports CLOSED state.
      if (es.readyState === EventSource.CLOSED) {
        // Bounded reconnect: max 5 attempts with exponential backoff
        // (1.5s, 3s, 6s, 12s, 24s). Stops if the user is no longer
        // processing or another SSE has taken over the ref.
        const MAX_RETRIES = 5;
        if (sseRetryRef.current >= MAX_RETRIES) {
          console.warn(`[SSE] Limite de tentativas (${MAX_RETRIES}) atingido — oferecendo reconexao manual`);
          // NAO matamos isProcessing — o backend pode estar progredindo, e
          // matar agora congela o cronometro/spinner sem motivo real. Em
          // vez disso oferecemos reconexao manual via toast persistente.
          toast({
            title: "Conexao com o servidor perdida",
            description: "O processamento pode continuar no servidor. Tente reconectar.",
            variant: "destructive",
            duration: 1000 * 60 * 30, // 30 min — efetivamente persistente
            action: (
              <ToastAction
                altText="Reconectar agora"
                onClick={() => { sseRetryRef.current = 0; try { startSSE(true); } catch {} }}
              >
                Reconectar agora
              </ToastAction>
            ),
          });
          return;
        }
        const attempt = sseRetryRef.current + 1;
        const backoff = 1500 * Math.pow(2, attempt - 1);
        sseRetryRef.current = attempt;
        setTimeout(() => {
          if (eventSourceRef.current !== es) return;
          try { startSSE(true); } catch {}
        }, backoff);
      }
    };
  };

  const updateProjectMutation = useMutation({
    mutationFn: async (patch: { discountPanelPct?: number; freightCost?: number; biomassCost?: number }) => {
      const res = await apiRequest("PUT", `/api/projects/${projectId}`, patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    },
  });

  const processMutation = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);
      // Motor enxuto (Vision Direct): devolve 202 imediatamente. Acompanhamos
      // o progresso por polling do GET /api/projects/:id (status: processing
      // -> completed). Sem SSE / pipelineSteps que eram da pipeline antiga.
      // Envia peDireito + scope (filtra categorias desmarcadas no backend).
      // Tambem envia productIds para definir SKU por categoria no budget.
      const body: Record<string, unknown> = {
        peDireito,
        scope,
        productIds: {
          ext: selectedProductIdExt,
          int: selectedProductIdInt,
          muros: selectedProductIdMuros,
          piso: selectedProductIdPiso,
          coberta: selectedProductIdCoberta,
        },
      };
      const res = await fetch(`/api/projects/${projectId}/process-direct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 202) {
        const errData = await res.json().catch(() => ({ message: "Erro ao processar projeto" }));
        throw new Error(errData.message || "Erro ao processar projeto");
      }
      return res.json();
    },
    onSuccess: () => {
      // Nao mostra toast de sucesso aqui — analise so comecou. Toast vem
      // quando o polling detectar status="completed".
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    },
    onError: (error: Error) => {
      toast({ title: "Erro", description: error.message || "Erro ao iniciar processamento", variant: "destructive" });
      setIsProcessing(false);
    },
  });

  // Sincroniza isProcessing com transicoes de status. O polling em si e feito
  // automaticamente pelo refetchInterval da useQuery acima (que para sozinho
  // quando status vira completed/error).
  useEffect(() => {
    const status = data?.project?.status;
    if (status === "processing") {
      if (!isProcessing) setIsProcessing(true);
    } else if (status === "completed") {
      if (isProcessing) {
        setIsProcessing(false);
        toast({ title: "Analise concluida!", description: "Quantitativos e plantas anotadas prontos." });
      }
    } else if (status === "error") {
      if (isProcessing) {
        setIsProcessing(false);
        toast({ title: "Erro na analise", description: "O motor de analise falhou. Tente reprocessar.", variant: "destructive" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.project?.status]);

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
  const mainSteps = pipelineSteps.filter(s => !s.parentStep);
  const pipelineFinished = !isProcessing && mainSteps.length > 0 && mainSteps.every(s => s.status === "done" || s.status === "error");
  const showPipeline = pipelineVisible && (isProcessing || processMutation.isPending || project.status === "processing" || pipelineSteps.length > 0);

  const pipelineElapsed = pipelineStartTime
    ? (pipelineFinished
        ? Math.max(...pipelineSteps.filter(s => s.completedAt).map(s => s.completedAt!), pipelineStartTime) - pipelineStartTime
        : tickNow - pipelineStartTime)
    : 0;

  function getStepIcon(status: string, isSubStep?: boolean) {
    const size = isSubStep ? "h-4 w-4" : "h-5 w-5";
    switch (status) {
      case "done": return <CheckCircle className={`${size} text-green-500`} />;
      case "running": return <Loader2 className={`${size} text-blue-500 animate-spin`} />;
      case "error": return <XCircle className={`${size} text-error`} />;
      default: return <Clock className={`${size} text-slate-300`} />;
    }
  }

  function getStepElapsed(step: PipelineStep): string | null {
    if (!step.startedAt) return null;
    if (step.completedAt) return formatElapsed(step.completedAt - step.startedAt);
    if (step.status === "running") return formatElapsed(tickNow - step.startedAt);
    return null;
  }

  // ============================================================
  // NOVO LAYOUT ADAPTATIVO POR STATUS (commit do redesign)
  // ============================================================
  // Substitui o sistema de 8 abas por uma tela unica que muda baseado em
  // project.status: draft/processing/completed/error. Conteudo secundario
  // (Analise IA, Etapas, Metodologia, Exportar) vai pra modais via kebab.
  // O return ANTIGO com PageHeader + glass card + Tabs fica desabilitado
  // pelo `if (false)` abaixo. Vou removelo num commit subsequente quando
  // os modais estiverem 100% migrados — manter por enquanto pra nao perder
  // referencia da logica dos handlers.

  const headerStatus: "draft" | "processing" | "completed" | "error" =
    isProcessing || project.status === "processing" ? "processing" :
    project.status === "completed" ? "completed" :
    project.status === "error" ? "error" : "draft";

  const headerElapsedMs = telemetry.state.startedAt
    ? Math.max(0, (telemetry.state.finishedAt ?? Date.now()) - telemetry.state.startedAt)
    : null;
  const headerCostUsd = telemetry.state.totalCostUsd || null;
  const headerTokens = telemetry.state.totalTokens || null;

  const productOptions = (catalogProducts || []).map((p: any) => ({
    id: String(p.id),
    label: `${p.name} (R$ ${Number(p.unitPrice).toLocaleString("pt-BR")})`,
    panelType: p.panelType,
  }));

  const onPanelChange = (kind: "ext" | "int" | "muros" | "piso" | "coberta", value: string) => {
    const setters = { ext: setSelectedProductIdExt, int: setSelectedProductIdInt, muros: setSelectedProductIdMuros, piso: setSelectedProductIdPiso, coberta: setSelectedProductIdCoberta };
    setters[kind](value);
    localStorage.setItem(`panel-${kind}-${projectId}`, value);
  };

  const onAnalysisModeChange = (v: string) => {
    setAnalysisMode(v);
    localStorage.setItem(`analysis-mode-${projectId}`, v);
  };

  const onPeDireitoChange = (v: number) => {
    setPeDireito(v);
    localStorage.setItem(`pe-direito-${projectId}`, String(v));
  };

  const onTypeChange = async (t: "teste" | "real") => {
    await fetch(`/api/projects/${projectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectType: t }),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
  };

  const onBuildingTypeChange = async (b: string) => {
    await fetch(`/api/projects/${projectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buildingType: b }),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
  };

  const onRenameProject = async (name: string) => {
    await fetch(`/api/projects/${projectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
  };

  const handleDeleteFile = async (fileId: number) => {
    try {
      const res = await fetch(`/api/files/${fileId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erro ao remover");
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({ title: "Arquivo removido" });
    } catch (err: any) {
      toast({ title: "Erro", description: err?.message || "Falha", variant: "destructive" });
    }
  };

  // Preview da 1a imagem (planta crua) pra DraftWorkspace
  const firstImageFile = (files || []).find((f: any) => f.fileType === "image" || /\.(png|jpe?g|webp)$/i.test(f.originalName || ""));
  const previewSrc = firstImageFile ? `/api/files/${firstImageFile.id}/content` : null;
  const previewMimeType = firstImageFile ? `image/${(firstImageFile.originalName || "").split(".").pop()?.toLowerCase() || "png"}` : null;

  // Agregação do budget pra CompletedFooter
  const budgetCategories: Array<{ label: string; area: number; cost: number }> = [];
  if (budget) {
    const pavs = (budget as any).pavimentos as any[] | undefined;
    if (Array.isArray(pavs)) {
      let extArea = 0, extCost = 0, intArea = 0, intCost = 0, murosArea = 0, murosCost = 0, pisoArea = 0, pisoCost = 0, cobArea = 0, cobCost = 0;
      for (const pav of pavs) {
        extArea += Number(pav.paredes_externas?.area_liquida_m2 || 0);
        extCost += Number(pav.paredes_externas?.custo_total || 0);
        intArea += Number(pav.paredes_internas?.area_liquida_m2 || 0);
        intCost += Number(pav.paredes_internas?.custo_total || 0);
        murosArea += Number(pav.muros?.area_liquida_m2 || 0);
        murosCost += Number(pav.muros?.custo_total || 0);
        pisoArea += Number(pav.laje_piso?.area_m2 || 0);
        pisoCost += Number(pav.laje_piso?.custo_total || 0);
        cobArea += Number(pav.laje_coberta?.area_m2 || 0);
        cobCost += Number(pav.laje_coberta?.custo_total || 0);
      }
      if (extArea > 0 || extCost > 0) budgetCategories.push({ label: "Paredes externas", area: extArea, cost: extCost });
      if (intArea > 0 || intCost > 0) budgetCategories.push({ label: "Paredes internas", area: intArea, cost: intCost });
      if (murosArea > 0 || murosCost > 0) budgetCategories.push({ label: "Muros", area: murosArea, cost: murosCost });
      if (pisoArea > 0 || pisoCost > 0) budgetCategories.push({ label: "Laje piso", area: pisoArea, cost: pisoCost });
      if (cobArea > 0 || cobCost > 0) budgetCategories.push({ label: "Laje coberta", area: cobArea, cost: cobCost });
    }
  }

  // Custo final R$ — usado tanto pelo Summary quanto pelo CompletedFooter.
  // Calcula como: subtotal de categorias - desconto% + frete + biomassa.
  // Mantem-se sincronizado quando o usuario muda discount/freight/biomass
  // sem precisar regravar budget.totalCost no banco.
  const displayedBudgetTotalCost = (() => {
    if (!budget) return null;
    const subtotal = budgetCategories.reduce((s, c) => s + c.cost, 0);
    if (subtotal <= 0) return null;
    const discount = Number(project?.discountPanelPct || 0) / 100;
    const freight = Number(project?.freightCost || 0);
    const biomass = Number(project?.biomassCost || 0);
    return Math.max(0, subtotal * (1 - discount) + freight + biomass);
  })();

  // Conteúdos das seções da sidebar — montados uma vez, reusados.
  const descriptionContent = budget?.projectDescription
    ? <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-xs">{budget.projectDescription}</div>
    : null;
  const stagesContent = (
    <div className="space-y-1.5 text-xs">
      {(extractedData || []).filter((d: any) => d.elementType.startsWith("etapa")).map((d: any, i: number) => (
        <details key={i} className="border border-border rounded p-1.5">
          <summary className="font-mono text-[10px] cursor-pointer truncate">{d.elementType}</summary>
          <pre className="text-[9px] mt-1.5 overflow-x-auto bg-muted/40 p-1.5 rounded">{JSON.stringify(d.data, null, 2).slice(0, 1500)}</pre>
        </details>
      ))}
    </div>
  );
  const filesContent = (
    <ul className="space-y-1 text-xs">
      {(files || []).map((f: any) => (
        <li key={f.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent/30 group">
          <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="truncate flex-1" title={f.originalName}>{f.originalName}</span>
          <button onClick={() => setViewingFile(f)} className="opacity-0 group-hover:opacity-100 text-[10px] text-primary hover:underline">
            ver
          </button>
        </li>
      ))}
      {(files || []).length === 0 && (
        <li className="text-muted-foreground italic py-1">Sem arquivos.</li>
      )}
    </ul>
  );
  const exportContent = (
    <div className="space-y-1.5">
      <Button size="sm" className="w-full justify-start" onClick={() => handleExport("excel")}>
        <Download className="h-3 w-3 mr-1.5" /> Excel (XLSX)
      </Button>
      <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => handleExport("pdf")}>
        <Download className="h-3 w-3 mr-1.5" /> PDF
      </Button>
      <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => handleExport("json")}>
        <Download className="h-3 w-3 mr-1.5" /> JSON
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background" data-testid="project-page">
      <ProjectHeader
        projectName={project.name}
        clientName={project.clientName}
        clientEmail={project.clientEmail}
        status={headerStatus}
        projectType={(project.projectType as "teste" | "real") || "real"}
        buildingType={project.buildingType || "residencial"}
        onBack={() => setLocation("/")}
        onRenameProject={onRenameProject}
        onProjectTypeChange={onTypeChange}
        onBuildingTypeChange={onBuildingTypeChange}
        elapsedMs={headerElapsedMs}
        costUsd={headerCostUsd}
        tokens={headerTokens}
      />

      <main className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto px-4 py-4">
          {headerStatus === "draft" && (
            <SimpleProjectConfig
              files={files || []}
              onUpload={uploadFiles}
              onDeleteFile={handleDeleteFile}
              onPreview={(f) => setViewingFile(f as any)}
              peDireito={peDireito}
              onPeDireitoChange={onPeDireitoChange}
              scope={scope}
              onScopeChange={setScope}
              productIds={{
                ext: selectedProductIdExt,
                int: selectedProductIdInt,
                muros: selectedProductIdMuros,
                piso: selectedProductIdPiso,
                coberta: selectedProductIdCoberta,
              }}
              onProductIdChange={(kind, value) => onPanelChange(kind, value)}
              productOptions={productOptions}
              buildingType={(project?.buildingType as any) || "residencial"}
              onBuildingTypeChange={(v) => onBuildingTypeChange(v)}
              onProcess={() => processMutation.mutate()}
              isProcessing={isProcessing}
            />
          )}

          {headerStatus === "processing" && projectId && (
            <VisionDirectLiveView projectId={Number(projectId)} />
          )}

          {headerStatus === "error" && (
            <ErrorState
              message="A análise da planta falhou."
              hint="Verifique se os arquivos enviados são plantas arquitetônicas válidas. Os logs do servidor têm detalhes técnicos. Clique abaixo para tentar novamente."
              onReprocess={() => processMutation.mutate()}
              isReprocessing={processMutation.isPending}
            />
          )}

          {/* Resultado da analise — UI Vision Direta (unica opcao).
              Se vision_direct_summary ausente: erro com botao Reprocessar.
              Sem fallback para WorkspaceLayout legado. */}
          {headerStatus === "completed" && (() => {
            const vdSummary = (extractedData || []).find((d: any) => d.elementType === "vision_direct_summary");
            if (!vdSummary) {
              return (
                <ErrorState
                  message="Análise concluída mas sem dados utilizáveis."
                  hint="A persistência falhou. Clique abaixo para reprocessar — os logs do servidor têm detalhes."
                  onReprocess={() => processMutation.mutate()}
                  isReprocessing={processMutation.isPending}
                />
              );
            }
            const vdResult = vdSummary.data as VisionDirectResult;
            return (
              <div className="space-y-4">
                <VisionDirectSummary
                  result={vdResult}
                  budgetTotalCost={displayedBudgetTotalCost}
                />
                <VisionDirectAnnotatedImages pages={vdResult.pages} />
                <VisionDirectConsolidatedTable totais={vdResult.totais} />
                {projectId && (
                  <VisionDirectQuantEditor
                    projectId={Number(projectId)}
                    pages={vdResult.pages}
                    onSaved={() => queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] })}
                  />
                )}
                <VisionDirectPageBreakdown pages={vdResult.pages} />
                <VisionDirectNotes pages={vdResult.pages} />
                {projectId && <VisionDirectPipelineTimeline projectId={Number(projectId)} />}
              </div>
            );
          })()}
        </div>

        {headerStatus === "completed" && budget && (
          <CompletedFooter
            totalCost={Number(budget.totalCost || 0)}
            totalArea={Number(budget.totalArea || 0)}
            totalPaneis={(budget as any).totalPaneis || undefined}
            categories={budgetCategories}
            discountPct={Number(project.discountPanelPct || 0)}
            freightCost={Number(project.freightCost || 0)}
            biomassCost={Number(project.biomassCost || 0)}
            elapsedMs={headerElapsedMs}
            aiCostUsd={headerCostUsd}
            onExportXlsx={() => handleExport("excel")}
            onReprocess={() => processMutation.mutate()}
          />
        )}
        </div>
        {/* Sidebar persistente direita — navegador do projeto */}
        <ProjectSidebar
          projectName={project.name}
          clientName={project.clientName}
          clientEmail={project.clientEmail}
          buildingType={project.buildingType || "residencial"}
          projectType={(project.projectType as "teste" | "real") || "real"}
          fingerprint={(project as any).fileFingerprint}
          elapsedMs={headerElapsedMs}
          costUsd={headerCostUsd}
          tokens={headerTokens}
          hasBudget={!!budget}
          hasExtractedData={(extractedData || []).length > 0}
          isProcessing={isProcessing || project.status === "processing"}
          filesContent={filesContent}
          descriptionContent={descriptionContent}
          stagesContent={stagesContent}
          methodologyContent={<Metodologia />}
          exportContent={exportContent}
          onDelete={() => setShowDeleteConfirm(true)}
        />
      </main>

      {/* Modais herdados (visualizacao de arquivo, confirmacao excluir) */}
      {viewingFile && (
        <Dialog open onOpenChange={() => setViewingFile(null)}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden p-0">
            <VisuallyHidden><DialogTitle>Visualizar arquivo</DialogTitle></VisuallyHidden>
            <PdfViewer url={`/api/files/${viewingFile.id}/content`} />
          </DialogContent>
        </Dialog>
      )}
      {showDeleteConfirm && (
        <Dialog open onOpenChange={(v) => !v && setShowDeleteConfirm(false)}>
          <DialogContent className="max-w-md">
            <DialogTitle>Excluir projeto?</DialogTitle>
            <p className="text-sm text-muted-foreground mt-2">
              Esta ação não pode ser desfeita. O projeto e todos os dados associados serão removidos.
            </p>
            <div className="flex gap-2 justify-end mt-4">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancelar</Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
                  queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
                  setShowDeleteConfirm(false);
                  setLocation("/");
                }}
              >
                Excluir
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );

}
