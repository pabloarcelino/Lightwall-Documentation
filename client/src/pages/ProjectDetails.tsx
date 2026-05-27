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
import { useToast } from "@/hooks/use-toast";
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
import { AiTimeline } from "@/components/AiTimeline";
import { LoadingState } from "@/components/ui/states";
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
    cantos: true,
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
  });

  const { data: catalogProducts } = useQuery<Product[]>({
    queryKey: ["/api/products"],
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

  useEffect(() => {
    if (!isProcessing) return;
    const interval = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isProcessing]);

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
          console.warn(`[SSE] Limite de tentativas (${MAX_RETRIES}) atingido — desistindo`);
          setIsProcessing(false);
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
      setPipelineVisible(true);
      startSSE();
      const body: Record<string, unknown> = { scope, analysisMode, peDireito };
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
        if (res.status === 409 && errData.duplicateProjectId) {
          return { duplicate: true, ...errData };
        }
        throw new Error(errData.message || "Erro ao processar projeto");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.duplicate) {
        setIsProcessing(false);
        toast({
          title: "Projeto Duplicado",
          description: `Arquivos identicos ja processados no projeto "${data.duplicateProjectName}". Redirecionando...`,
          variant: "destructive",
        });
        setTimeout(() => setLocation(`/project/${data.duplicateProjectId}`), 2000);
        return;
      }
      toast({ title: "Sucesso!", description: "Projeto processado com sucesso" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
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

  return (
    <div className="min-h-screen lw-gradient-bg">
      <PageHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" data-testid="button-back">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Voltar
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <LightwallDots className="h-5 w-5 text-primary" />
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
                      aria-label="Salvar alteracoes"
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
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Cancelar edicao" onClick={() => setEditingInfo(false)}>
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
                      {isAdmin && (project.clientEmail || project.fileFingerprint) && (
                        <div className="flex items-center gap-3 mt-1">
                          {project.clientEmail && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded" data-testid="text-client-email">
                              <Mail className="h-3 w-3" />
                              {project.clientEmail}
                            </span>
                          )}
                          {project.fileFingerprint && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded font-mono" data-testid="text-fingerprint" title={project.fileFingerprint}>
                              <Fingerprint className="h-3 w-3" />
                              {project.fileFingerprint.substring(0, 12)}...
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="Editar nome do projeto e cliente"
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
                <Button variant="outline" size="sm" className="text-error border-red-300 hover:bg-red-50" onClick={() => setShowDeleteConfirm(true)} data-testid="button-delete-project">
                  <Trash2 className="h-4 w-4 mr-1" />
                  Excluir
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-error font-medium">Confirma?</span>
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
      </PageHeader>

      <main className="container mx-auto px-4 py-8">
        {projectId && (
          <div className="mb-6">
            <AiTimeline
              projectId={projectId}
              enabled={isProcessing || project.status === "processing"}
            />
          </div>
        )}
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
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {([
                  { key: "realAreaExt", label: "Par. Externas" },
                  { key: "realAreaInt", label: "Par. Internas" },
                  { key: "realAreaMuros", label: "Muros" },
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
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  {pipelineFinished
                    ? <CheckCircle className="h-5 w-5 text-green-500" />
                    : <Loader2 className="h-5 w-5 animate-spin text-blue-500" />}
                  Pipeline de Processamento
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    ({STEP_CONFIG.filter(s => !s.parentStep).length} etapas)
                  </span>
                </CardTitle>
                <div className="flex items-center gap-3">
                  {pipelineStartTime && (
                    <span className={`text-sm font-mono flex items-center gap-1.5 px-2 py-1 rounded-md ${
                      pipelineFinished
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    }`}>
                      <Clock className="h-3.5 w-3.5" />
                      {formatElapsed(pipelineElapsed)}
                    </span>
                  )}
                  <button
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setPipelineVisible(false)}
                    title="Fechar pipeline"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <CardDescription>
                {pipelineFinished ? "Processamento concluido com sucesso" : "Acompanhe cada etapa em tempo real"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pipelineSteps.map((step) => {
                  const isSubStep = !!step.parentStep;
                  const elapsed = getStepElapsed(step);
                  return (
                    <div
                      key={step.step}
                      data-testid={`pipeline-step-${step.step}`}
                      className={`flex items-start gap-3 rounded-lg border transition-all ${
                        isSubStep ? "ml-8 p-2 border-l-2" : "p-3"
                      } ${
                        step.status === "running" ? "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800" :
                        step.status === "done" ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800" :
                        step.status === "error" ? "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800" :
                        "bg-slate-50 border-slate-200 dark:bg-slate-800/50 dark:border-slate-700"
                      }`}
                    >
                      <div className={isSubStep ? "mt-0" : "mt-0.5"}>{getStepIcon(step.status, isSubStep)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-slate-500 ${isSubStep ? "text-[10px]" : "text-xs"}`}>
                            {isSubStep ? `└` : `ETAPA ${step.displayNum || step.step}`}
                          </span>
                          <span className={`font-medium ${isSubStep ? "text-xs" : "text-sm"}`}>{step.label}</span>
                          {elapsed && (
                            <span className={`ml-auto font-mono whitespace-nowrap ${
                              step.status === "running" ? "text-blue-600 dark:text-blue-400" :
                              step.status === "done" ? "text-green-600 dark:text-green-400" :
                              "text-muted-foreground"
                            } ${isSubStep ? "text-[10px]" : "text-xs"}`}>
                              {elapsed}
                            </span>
                          )}
                        </div>
                        {step.detail && (
                          <p className={`mt-1 break-words ${isSubStep ? "text-[10px]" : "text-xs"} ${
                            step.status === "error" ? "text-error" :
                            step.status === "done" ? "text-green-700 dark:text-green-400" :
                            "text-blue-600 dark:text-blue-400"
                          }`} data-testid={`pipeline-detail-${step.step}`}>
                            {step.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
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
                                              <tr key={j} className="border-b" data-testid={`row-wall-${w.id}`}><td className="p-1">{w.id}</td><td className="p-1">{w.classe}</td><td className="p-1">{w.nivel}</td><td className="p-1">{w.comprimento_m}m</td><td className="p-1">{w.altura_m}m</td><td className="p-1"><span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${w.measurement_source?.startsWith("table") ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" : w.measurement_source?.startsWith("pdf_vector") ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" : w.measurement_source === "ai_vision_takeoff" ? "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200" : w.measurement_source?.startsWith("inferred") ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"}`} data-testid={`badge-source-${w.id}`}>{w.measurement_source}</span>{w.needs_review && <span className="ml-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" title={w.review_reason} data-testid={`badge-review-${w.id}`}>revisar</span>}</td><td className="p-1">{w.confidence ? `${(w.confidence * 100).toFixed(0)}%` : "-"}</td></tr>
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
                                    <p className="text-xs text-warning dark:text-orange-400">Paredes</p>
                                    <p className="text-lg font-bold text-warning dark:text-orange-300">{d.resultado?.resumo?.total_paredes || 0}</p>
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
                    <CardDescription>Arraste arquivos aqui ou clique para adicionar. Clique em um arquivo para visualizar em tela cheia.</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-add-files"
                      onClick={() => document.getElementById("file-upload-input")?.click()}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Adicionar Arquivos
                    </Button>
                    <input
                      id="file-upload-input"
                      type="file"
                      multiple
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.ifc"
                      className="hidden"
                      data-testid="input-file-upload"
                      onChange={async (e) => {
                        const selectedFiles = e.target.files;
                        if (!selectedFiles || selectedFiles.length === 0) return;
                        await uploadFiles(Array.from(selectedFiles));
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
                  <div className="mb-3">
                    <Label className="text-xs font-medium text-muted-foreground">Modo de Analise:</Label>
                    <Select value={analysisMode} onValueChange={setAnalysisMode}>
                      <SelectTrigger className="h-8 text-sm w-72 mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gemini-only">Gemini-only (IA pura)</SelectItem>
                        <SelectItem value="openai-only">OpenAI-only (IA pura)</SelectItem>
                        <SelectItem value="openai-vision-takeoff">OpenAI Vision Takeoff (estruturado)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      {analysisMode === "gemini-only" && "Usa apenas o Gemini para analisar a planta. Mais simples, sem dependencias externas."}
                      {analysisMode === "openai-only" && "Usa apenas a OpenAI (modelo configurado em Configuracoes, padrao gpt-5-mini) para todo o pipeline. Requer chave OpenAI."}
                      {analysisMode === "openai-vision-takeoff" && "Usa OpenAI Vision com saida estruturada (JSON Schema) para extrair paredes e lajes diretamente da planta. Requer chave OpenAI. Roda automaticamente ao clicar em \"Processar\"."}
                    </p>
                  </div>
                  <div className="mb-3">
                    <Label className="text-xs font-medium text-muted-foreground">Pe-direito (m):</Label>
                    <Input
                      type="number"
                      min={2.0}
                      max={6.0}
                      step={0.1}
                      value={peDireito}
                      onChange={(e) => setPeDireito(parseFloat(e.target.value) || 3.0)}
                      className="h-8 text-sm w-32 mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Altura padrao das paredes. Usado quando a planta nao indica a cota.</p>
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
                <div
                  {...getFilesRootProps()}
                  data-testid="dropzone-project-files"
                  className={`relative rounded-lg transition-colors ${
                    isFilesDragActive ? "ring-2 ring-primary bg-primary/5" : ""
                  }`}
                >
                  <input {...getFilesInputProps()} />
                  {isFilesDragActive && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-primary/10 backdrop-blur-sm rounded-lg pointer-events-none">
                      <div className="flex flex-col items-center gap-2 text-primary">
                        <Upload className="h-10 w-10" />
                        <p className="text-sm font-semibold">Solte os arquivos aqui</p>
                      </div>
                    </div>
                  )}
                {!files || files.length === 0 ? (
                  <div
                    className="text-center py-12 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary/50 transition-colors"
                    data-testid="text-no-files"
                    onClick={() => document.getElementById("file-upload-input")?.click()}
                  >
                    <Upload className="h-10 w-10 mx-auto text-slate-400 mb-3" />
                    <p className="text-slate-500 mb-2">Arraste arquivos aqui ou clique para selecionar</p>
                    <p className="text-xs text-slate-400">PDF, PNG, JPG, WEBP, BMP, TIFF, IFC</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {files.map((file: any) => {
                      const isImage = file.fileType === "image" || /\.(png|jpe?g)$/i.test(file.originalName || "");
                      const isPdf = file.fileType === "pdf" || /\.pdf$/i.test(file.originalName || "");
                      const cacheBust = project?.updatedAt ? `?v=${new Date(project.updatedAt).getTime()}` : "";
                      const fileUrl = `/api/files/${file.id}/content${cacheBust}`;
                      const pageTypeLabel: Record<string, string> = {
                        planta_baixa: "Planta Baixa",
                        planta_cobertura: "Planta Cobertura",
                        corte: "Corte",
                        fachada: "Fachada",
                        vista_3d: "Vista 3D",
                        tabela_quantitativo: "Tabela Quantitativo",
                        quadro_esquadrias: "Quadro Esquadrias",
                        detalhe_construtivo: "Detalhe",
                        irrelevante: "Irrelevante",
                      };
                      return (
                        <Card
                          key={`${file.id}-${project?.updatedAt || ""}`}
                          data-testid={`card-file-${file.id}`}
                          className="cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all group relative"
                          onClick={() => setViewingFile(file)}
                        >
                          <Button
                            variant="destructive"
                            size="icon"
                            aria-label={`Excluir arquivo ${file.originalName}`}
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
                </div>
              </CardContent>
            </Card>

            <Dialog open={!!viewingFile} onOpenChange={(open) => { if (!open) setViewingFile(null); }}>
              <DialogContent className="max-w-[95vw] w-[95vw] max-h-[95vh] h-[95vh] p-0 overflow-hidden" aria-describedby={undefined}>
                <VisuallyHidden><DialogTitle>Visualizar Arquivo</DialogTitle></VisuallyHidden>
                {viewingFile && (() => {
                  const isImage = viewingFile.fileType === "image" || /\.(png|jpe?g)$/i.test(viewingFile.originalName || "");
                  const isPdf = viewingFile.fileType === "pdf" || /\.pdf$/i.test(viewingFile.originalName || "");
                  const cacheBust = project?.updatedAt ? `?v=${new Date(project.updatedAt).getTime()}` : "";
                  const fileUrl = `/api/files/${viewingFile.id}/content${cacheBust}`;
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
                            key={`${viewingFile.id}-${project?.updatedAt || ""}`}
                            url={fileUrl}
                            className="w-full h-full bg-white"
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
              const auditNotesData = (extractedData || []).find((d: any) => d.elementType === "audit_notes");
              const auditNotes: Array<{ severity: "info" | "warning" | "error"; code: string; message: string; relatedIds?: string[] }> =
                (auditNotesData?.data as any)?.notes || [];
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
                  {/* Auditoria automatica (Fase D / S12) — mostra inconsistencias detectadas */}
                  {auditNotes.length > 0 && (
                    <div className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="card-audit-notes">
                      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                        <div>
                          <h3 className="text-base font-semibold flex items-center gap-2">
                            🔍 Auditoria automatica
                          </h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {auditNotes.filter(n => n.severity === "error").length} erro(s),{" "}
                            {auditNotes.filter(n => n.severity === "warning").length} aviso(s),{" "}
                            {auditNotes.filter(n => n.severity === "info").length} info — checagens deterministicas em codigo (sem IA).
                          </p>
                        </div>
                      </div>
                      <ul className="divide-y divide-border max-h-72 overflow-y-auto">
                        {auditNotes.map((note, i) => {
                          const tone = note.severity === "error"
                            ? "bg-error-soft text-error border-error/30"
                            : note.severity === "warning"
                              ? "bg-warning-soft text-warning border-warning/30"
                              : "bg-info-soft text-info border-info/30";
                          const label = note.severity === "error" ? "ERRO" : note.severity === "warning" ? "AVISO" : "INFO";
                          return (
                            <li key={i} className="px-5 py-3 flex items-start gap-3" data-testid={`audit-note-${note.code}-${i}`}>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold tracking-wider shrink-0 ${tone}`}>
                                {label}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-foreground">{note.message}</p>
                                {note.relatedIds && note.relatedIds.length > 0 && (
                                  <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                                    Elementos: {note.relatedIds.slice(0, 6).join(", ")}{note.relatedIds.length > 6 ? "..." : ""}
                                  </p>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

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
                        {(() => {
                          // Fase E.6: badge "✓ CV" / "⚠ CV divergente" baseado em sourceContribution.enrichments
                          const cvStatus = (w: any): null | { kind: "match" | "disagree"; reason?: string } => {
                            const enrichments = w?.sourceContribution?.enrichments;
                            if (!Array.isArray(enrichments)) return null;
                            const dis = enrichments.find((e: any) => e?.view === "cv_disagreement");
                            if (dis) return { kind: "disagree", reason: dis.reason };
                            const match = enrichments.find((e: any) => e?.view === "cv_match");
                            if (match) return { kind: "match", reason: match.reason };
                            return null;
                          };
                          const renderWallList = (walls: any[]) => (
                            <span className="inline">
                              {walls.map((w: any, i: number) => {
                                const cv = cvStatus(w);
                                return (
                                  <span key={w.id || i}>
                                    {i > 0 && ", "}
                                    <span className="whitespace-nowrap">
                                      {w.id} ({fmt(w.comprimento_m)}m)
                                      {cv?.kind === "match" && (
                                        <span
                                          className="ml-1 inline-flex items-center px-1 py-0 rounded text-[10px] font-medium border bg-success-soft text-success border-success/30 align-middle"
                                          title={cv.reason || "CV concordou com LLM"}
                                          data-testid={`badge-cv-match-${w.id}`}
                                        >
                                          ✓ CV
                                        </span>
                                      )}
                                      {cv?.kind === "disagree" && (
                                        <span
                                          className="ml-1 inline-flex items-center px-1 py-0 rounded text-[10px] font-medium border bg-warning-soft text-warning border-warning/30 align-middle"
                                          title={cv.reason || "CV discordou da classificacao do LLM"}
                                          data-testid={`badge-cv-disagree-${w.id}`}
                                        >
                                          ⚠ CV
                                        </span>
                                      )}
                                    </span>
                                  </span>
                                );
                              })}
                            </span>
                          );
                          return (
                            <>
                              {externas.length > 0 && (
                                <div className="flex items-start gap-2">
                                  <span className="w-2 h-2 rounded-full bg-cyan-500 mt-1.5 shrink-0" />
                                  <p className="text-slate-700 dark:text-slate-300">
                                    <strong className="text-foreground">Paredes Externas ({externas.length}):</strong>{" "}
                                    {renderWallList(externas)}.
                                    {" "}<span className="text-muted-foreground text-xs">Total: {fmt(totalExt)}m lineares</span>
                                  </p>
                                </div>
                              )}
                              {internas.length > 0 && (
                                <div className="flex items-start gap-2">
                                  <span className="w-2 h-2 rounded-full bg-orange-500 mt-1.5 shrink-0" />
                                  <p className="text-slate-700 dark:text-slate-300">
                                    <strong className="text-foreground">Paredes Internas ({internas.length}):</strong>{" "}
                                    {renderWallList(internas)}.
                                    {" "}<span className="text-muted-foreground text-xs">Total: {fmt(totalInt)}m lineares</span>
                                  </p>
                                </div>
                              )}
                              {muros.length > 0 && (
                                <div className="flex items-start gap-2">
                                  <span className="w-2 h-2 rounded-full bg-purple-500 mt-1.5 shrink-0" />
                                  <p className="text-slate-700 dark:text-slate-300">
                                    <strong className="text-foreground">Muros de Divisa ({muros.length}):</strong>{" "}
                                    {renderWallList(muros)}.
                                    {" "}<span className="text-muted-foreground text-xs">Total: {fmt(totalMuros)}m lineares</span>
                                  </p>
                                </div>
                              )}
                            </>
                          );
                        })()}
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
                          { label: "Par. Internas", value: internas.length, sub: `${fmt(totalInt)}m`, color: "text-warning", dot: "bg-orange-500" },
                          { label: "Muros", value: muros.length, sub: `${fmt(totalMuros)}m`, color: "text-purple-600", dot: "bg-purple-500" },
                          { label: "Laje Piso", value: slabPiso.length, sub: `${fmt(totalPiso)}m²`, color: "text-success", dot: "bg-emerald-500" },
                          { label: "Laje Coberta", value: slabCoberta.length, sub: `${fmt(totalCoberta)}m²`, color: "text-error", dot: "bg-red-500" },
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
                          <div
                            className="text-xs border rounded-md p-3 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-100 space-y-1"
                            data-testid="banner-reclassify-help"
                          >
                            <p className="font-semibold">Como corrigir o que a IA marcou:</p>
                            <p>
                              <strong>Paredes (vermelho/verde/azul):</strong> role ate a tabela
                              <em> Paredes Detectadas </em> abaixo e <strong>clique no badge EXT/INT/MURO</strong>
                              {" "}da parede pra alternar a classe. Cada clique cicla
                              externa → interna → muro.
                            </p>
                            <p>
                              <strong>Areas (laje piso / laje coberta):</strong> use a secao
                              <em> Lajes Detectadas </em>e troque o tipo no seletor da laje.
                            </p>
                            <p>
                              Regra: parede interna (verde) <strong>nao pode ficar paralela e em cima </strong>
                              de uma externa (vermelha) — quando isso acontece, a interna ja vem marcada como
                              <em> revisar </em>pra voce confirmar/remover.
                            </p>
                          </div>
                          {renderSummary()}
                          {(() => {
                            const cycleWall = (wallId: string) => editorRef.current?.cycleWallClasse(wallId);
                            const wallsForPav = (pav: string) =>
                              planWalls.filter((w: any) => pav === "all" || w.nivel === pav);
                            const hintsForPav = (pav: string) =>
                              pendingHints.filter(h => (h.pavimento || "all") === pav);
                            const activePav = isMultiFloor ? activeAnnotPav : floorImages[0].pavimento;
                            const hintCountActive = hintsForPav(activePav).length;
                            const toolbar = (
                              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
                                <span className="text-xs text-muted-foreground mr-1">Clique:</span>
                                <Button
                                  size="sm"
                                  variant={clickMode === "wall" ? "default" : "outline"}
                                  onClick={() => setClickMode("wall")}
                                  data-testid="button-mode-wall"
                                >
                                  Reclassificar parede
                                </Button>
                                <Button
                                  size="sm"
                                  variant={clickMode === "exterior" ? "default" : "outline"}
                                  className={clickMode === "exterior" ? "bg-orange-600 hover:bg-orange-700" : "border-orange-500 text-warning hover:bg-orange-50"}
                                  onClick={() => setClickMode("exterior")}
                                  data-testid="button-mode-exterior"
                                >
                                  Marcar EXTERIOR
                                </Button>
                                <Button
                                  size="sm"
                                  variant={clickMode === "interior" ? "default" : "outline"}
                                  className={clickMode === "interior" ? "bg-cyan-600 hover:bg-cyan-700" : "border-cyan-600 text-cyan-700 hover:bg-cyan-50"}
                                  onClick={() => setClickMode("interior")}
                                  data-testid="button-mode-interior"
                                >
                                  Marcar INTERIOR
                                </Button>
                                <span className="text-xs text-muted-foreground ml-2">
                                  {clickMode === "wall"
                                    ? "Clique numa parede pra ciclar EXT/INT/MURO."
                                    : `Clique no ${clickMode === "exterior" ? "lado de fora" : "lado de dentro"} de um comodo. Clique no marcador pra remover.`}
                                </span>
                                <div className="ml-auto flex items-center gap-2">
                                  {hintCountActive > 0 && (
                                    <span className="text-xs text-muted-foreground">
                                      {hintCountActive} marcador(es)
                                    </span>
                                  )}
                                  {hintCountActive > 0 && (
                                    <Button size="sm" variant="ghost" onClick={() => clearHintsForPav(activePav)} data-testid="button-clear-hints">
                                      Limpar
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    disabled={!hintsDirty || saveHintsMutation.isPending}
                                    onClick={() => saveHintsMutation.mutate(pendingHints)}
                                    data-testid="button-save-hints"
                                  >
                                    {saveHintsMutation.isPending ? "Aplicando..." : "Aplicar marcadores"}
                                  </Button>
                                </div>
                              </div>
                            );
                            return (
                              <>
                                {toolbar}
                                {isMultiFloor ? (
                                  <Tabs
                                    value={activeAnnotPav === "all" || !floorImages.some(f => f.pavimento === activeAnnotPav) ? floorImages[0].pavimento : activeAnnotPav}
                                    onValueChange={setActiveAnnotPav}
                                    className="w-full"
                                  >
                                    <TabsList className="w-full justify-start">
                                      {floorImages.map((fi) => (
                                        <TabsTrigger key={fi.pavimento} value={fi.pavimento}>
                                          {floorLabel(fi.pavimento)}
                                        </TabsTrigger>
                                      ))}
                                    </TabsList>
                                    {floorImages.map((fi) => (
                                      <TabsContent key={fi.pavimento} value={fi.pavimento}>
                                        <InteractiveAnnotatedPlan
                                          src={fi.image}
                                          alt={`Planta anotada - ${floorLabel(fi.pavimento)}`}
                                          testId={`img-ai-annotated-plan-${fi.pavimento}`}
                                          walls={wallsForPav(fi.pavimento)}
                                          onClickWall={cycleWall}
                                          onHoverWall={setHighlightedWallId}
                                          highlightedWallId={highlightedWallId}
                                          mode={clickMode}
                                          hints={hintsForPav(fi.pavimento)}
                                          onAddHint={(x, y, s) => addHint(x, y, s, fi.pavimento)}
                                          onRemoveHint={removeHint}
                                        />
                                      </TabsContent>
                                    ))}
                                  </Tabs>
                                ) : (
                                  <InteractiveAnnotatedPlan
                                    src={floorImages[0].image}
                                    alt="Planta anotada pela IA"
                                    testId="img-ai-annotated-plan"
                                    walls={wallsForPav(floorImages[0].pavimento)}
                                    onClickWall={cycleWall}
                                    onHoverWall={setHighlightedWallId}
                                    highlightedWallId={highlightedWallId}
                                    mode={clickMode}
                                    hints={hintsForPav(floorImages[0].pavimento)}
                                    onAddHint={(x, y, s) => addHint(x, y, s, floorImages[0].pavimento)}
                                    onRemoveHint={removeHint}
                                  />
                                )}
                              </>
                            );
                          })()}
                          {renderLegend()}
                        </CardContent>
                      </Card>
                    );
                  })()}
                  {/* ===== Outras Vistas do Projeto =====
                      Reference pages (cortes, fachadas, planta de cobertura,
                      detalhes, quadros) shown as their original PDF page so
                      the user sees the complete project, not only the floor
                      plans. Generated for ALL analysis modes. */}
                  {(() => {
                    const refs: Array<{
                      pageType: string; pageTypeLabel: string; pageIndex: number;
                      pavimento?: string; image: string; mimeType: string;
                    }> = (annotatedPlan?.data?.referenceImages && Array.isArray(annotatedPlan.data.referenceImages))
                      ? annotatedPlan.data.referenceImages
                      : [];
                    if (refs.length === 0) return null;

                    const groups = new Map<string, typeof refs>();
                    for (const r of refs) {
                      const key = r.pageType;
                      if (!groups.has(key)) groups.set(key, []);
                      groups.get(key)!.push(r);
                    }
                    const orderedTypes = ["planta_cobertura", "corte", "fachada", "vista_3d", "detalhe_construtivo", "quadro_esquadrias", "tabela_quantitativo"];
                    const seen = new Set<string>();
                    const orderedGroups = [
                      ...orderedTypes.filter(t => groups.has(t)).map(t => { seen.add(t); return t; }),
                      ...Array.from(groups.keys()).filter(t => !seen.has(t)),
                    ].map(t => ({ type: t, label: groups.get(t)![0].pageTypeLabel, items: groups.get(t)! }));
                    if (orderedGroups.length === 0) return null;

                    return (
                      <Card data-testid="card-reference-views">
                        <CardHeader className="pb-3">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <FileText className="h-5 w-5 text-slate-500" />
                            Outras Vistas do Projeto ({refs.length})
                          </CardTitle>
                          <p className="text-xs text-muted-foreground">
                            Paginas de cortes, fachadas, cobertura, detalhes e quadros — extraidas como referencia visual sem anotacoes de IA.
                          </p>
                        </CardHeader>
                        <CardContent>
                          <Tabs defaultValue={orderedGroups[0].type} className="w-full">
                            <TabsList className="w-full justify-start flex-wrap h-auto">
                              {orderedGroups.map(g => (
                                <TabsTrigger key={g.type} value={g.type} data-testid={`tab-reference-${g.type}`}>
                                  {g.label} ({g.items.length})
                                </TabsTrigger>
                              ))}
                            </TabsList>
                            {orderedGroups.map(g => (
                              <TabsContent key={g.type} value={g.type} className="space-y-4">
                                {g.items.map((item, idx) => (
                                  <div key={`${item.pageType}-${item.pageIndex}-${idx}`} className="space-y-2">
                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                      <span data-testid={`text-reference-label-${item.pageType}-${item.pageIndex}`}>
                                        {g.label}{item.pavimento && item.pavimento !== "all" ? ` — ${item.pavimento}` : ""} (pag. {item.pageIndex + 1})
                                      </span>
                                      <a href={item.image} download={`${item.pageType}-pag${item.pageIndex + 1}.${item.mimeType === "application/pdf" ? "pdf" : "png"}`}>
                                        <Button variant="outline" size="sm" data-testid={`button-download-reference-${item.pageType}-${item.pageIndex}`}>
                                          <Download className="h-3.5 w-3.5 mr-1" /> Baixar
                                        </Button>
                                      </a>
                                    </div>
                                    {item.mimeType === "application/pdf" ? (
                                      <div className="border rounded overflow-hidden bg-slate-100 dark:bg-slate-900" style={{ minHeight: 480 }}>
                                        <PdfViewer url={item.image} className="h-[600px]" />
                                      </div>
                                    ) : (
                                      <img
                                        src={item.image}
                                        alt={`${g.label} pag. ${item.pageIndex + 1}`}
                                        className="block w-full h-auto rounded border"
                                        data-testid={`img-reference-${item.pageType}-${item.pageIndex}`}
                                      />
                                    )}
                                  </div>
                                ))}
                              </TabsContent>
                            ))}
                          </Tabs>
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {/* If no AI image, show bbox-based annotated plan only (no schematic fallback) */}
                  {!annotatedPlan?.data?.image && !annotatedPlan?.data?.images && planWalls.length > 0 && hasBboxWalls && files && files.length > 0 && (
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
                </div>
              );
            })()}
            <QuantitativosEditor
              ref={editorRef}
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
                {budget.alerts && budget.alerts.length > 0 && (() => {
                  const counts = budget.alerts.reduce((acc: Record<string, number>, a: any) => {
                    acc[a.level] = (acc[a.level] || 0) + 1;
                    return acc;
                  }, {});
                  return (
                    <Card className="border-orange-200 dark:border-orange-800" data-testid="card-alerts">
                      <CardHeader
                        className="cursor-pointer select-none hover-elevate"
                        onClick={() => setAlertsCollapsed(c => !c)}
                        data-testid="button-toggle-alerts"
                      >
                        <CardTitle className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-warning" />
                            Alertas e Inconsistencias
                            <Badge variant="secondary" className="ml-1" data-testid="badge-alerts-count">
                              {budget.alerts.length}
                            </Badge>
                            {counts.critical > 0 && (
                              <Badge variant="destructive" className="text-xs">
                                {counts.critical} critico(s)
                              </Badge>
                            )}
                            {counts.warning > 0 && (
                              <Badge variant="outline" className="text-xs border-orange-400 text-warning dark:text-orange-400">
                                {counts.warning} aviso(s)
                              </Badge>
                            )}
                          </div>
                          {alertsCollapsed ? (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <ChevronUp className="h-5 w-5 text-muted-foreground" />
                          )}
                        </CardTitle>
                      </CardHeader>
                      {!alertsCollapsed && (
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
                      )}
                    </Card>
                  );
                })()}

                {budget.apiHealth && (() => {
                  const { reliability, metrics } = budget.apiHealth;
                  const isHigh = reliability.level === "high";
                  const isMedium = reliability.level === "medium";
                  const borderColor = isHigh ? "border-emerald-200 dark:border-emerald-800" : isMedium ? "border-amber-200 dark:border-amber-800" : "border-red-200 dark:border-red-800";
                  const bgColor = isHigh ? "bg-emerald-50 dark:bg-emerald-900/20" : isMedium ? "bg-amber-50 dark:bg-amber-900/20" : "bg-red-50 dark:bg-red-900/20";
                  const textColor = isHigh ? "text-success dark:text-success" : isMedium ? "text-warning dark:text-warning" : "text-error dark:text-error";
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
                                    <span className="text-warning dark:text-warning">Correcoes aplicadas</span>
                                  ) : (
                                    <span className="text-success dark:text-success">Aprovado</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            {metrics.verification.fallbackUsed && (
                              <div className="mt-2 text-xs text-warning dark:text-warning" data-testid="text-verification-fallback">
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
                              <div key={idx} className={`text-sm px-3 py-1.5 rounded ${isHigh ? "text-success dark:text-success" : isMedium ? "text-warning dark:text-warning" : "text-error dark:text-error"} ${bgColor}`} data-testid={`text-reliability-factor-${idx}`}>
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

                      {budget.proposta.totais_por_sku && budget.proposta.totais_por_sku.length > 0 && (
                        <div className="mt-6">
                          <h4 className="font-semibold mb-3">Total de Paineis por Tipo de Painel</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm" data-testid="table-sku-totals">
                              <thead>
                                <tr className="border-b-2 border-slate-300 dark:border-slate-600">
                                  <th className="text-left p-3 font-semibold">TIPO DE PAINEL</th>
                                  <th className="text-left p-3 font-semibold">SKU</th>
                                  <th className="text-right p-3 font-semibold">AREA TOTAL (M2)</th>
                                  <th className="text-right p-3 font-semibold">QTD PAINEIS</th>
                                  <th className="text-right p-3 font-semibold">PRECO TOTAL</th>
                                </tr>
                              </thead>
                              <tbody>
                                {budget.proposta.totais_por_sku.map((sku: any, idx: number) => (
                                  <tr key={idx} className="border-b" data-testid={`sku-row-${idx}`}>
                                    <td className="p-3 text-sm font-medium">{sku.nome}</td>
                                    <td className="p-3 font-mono text-xs text-muted-foreground">{sku.sku || "-"}</td>
                                    <td className="p-3 text-right">{sku.qtd_m2?.toLocaleString("pt-BR", { minimumFractionDigits: 3 })}</td>
                                    <td className="p-3 text-right font-bold text-lg">{sku.qtd_un}</td>
                                    <td className="p-3 text-right font-medium">R$ {sku.preco_total?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800">
                                  <td colSpan={2} className="p-3 font-bold">TOTAL:</td>
                                  <td className="p-3 text-right font-bold">
                                    {budget.proposta.totais_por_sku.reduce((sum: number, s: any) => sum + (s.qtd_m2 || 0), 0).toLocaleString("pt-BR", { minimumFractionDigits: 3 })}
                                  </td>
                                  <td className="p-3 text-right font-bold text-lg">
                                    {budget.proposta.totais_por_sku.reduce((sum: number, s: any) => sum + (s.qtd_un || 0), 0)}
                                  </td>
                                  <td className="p-3 text-right font-bold">
                                    R$ {budget.proposta.totais_por_sku.reduce((sum: number, s: any) => sum + (s.preco_total || 0), 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      )}

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

                      {(() => {
                        const panelCost = Number(budget.proposta.total_paineis_cost || 0);
                        const paginacaoCost = Number(budget.proposta.paginacao?.preco_total || 0);
                        const discountPct = Math.min(25, Math.max(0, Number(project.discountPanelPct || 0)));
                        const freight = Math.max(0, Number(project.freightCost || 0));
                        const biomass = Math.max(0, Number(project.biomassCost || 0));
                        const discountValue = panelCost * (discountPct / 100);
                        const panelsAfter = panelCost - discountValue;
                        const finalTotal = panelsAfter + paginacaoCost + freight + biomass;
                        const fmt = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        return (
                          <div key={`adjustments-${project.id}`} className="mt-6 space-y-3">
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/30">
                              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Ajustes Finais</h3>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="space-y-1">
                                  <Label htmlFor="discount-input" className="text-xs">Desconto sobre paineis (max 25%)</Label>
                                  <div className="flex items-center gap-2">
                                    <Input
                                      id="discount-input"
                                      type="number"
                                      min={0}
                                      max={25}
                                      step={0.5}
                                      defaultValue={discountPct}
                                      onBlur={(e) => {
                                        const v = Math.min(25, Math.max(0, parseFloat(e.target.value) || 0));
                                        if (v !== discountPct) updateProjectMutation.mutate({ discountPanelPct: v });
                                      }}
                                      data-testid="input-discount-panel"
                                    />
                                    <span className="text-sm text-muted-foreground">%</span>
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <Label htmlFor="freight-input" className="text-xs">Frete estimado (R$)</Label>
                                  <Input
                                    id="freight-input"
                                    type="number"
                                    min={0}
                                    step={100}
                                    defaultValue={freight}
                                    onBlur={(e) => {
                                      const v = Math.max(0, parseFloat(e.target.value) || 0);
                                      if (v !== freight) updateProjectMutation.mutate({ freightCost: v });
                                    }}
                                    data-testid="input-freight"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label htmlFor="biomass-input" className="text-xs">Biomassa estimada (R$)</Label>
                                  <Input
                                    id="biomass-input"
                                    type="number"
                                    min={0}
                                    step={100}
                                    defaultValue={biomass}
                                    onBlur={(e) => {
                                      const v = Math.max(0, parseFloat(e.target.value) || 0);
                                      if (v !== biomass) updateProjectMutation.mutate({ biomassCost: v });
                                    }}
                                    data-testid="input-biomass"
                                  />
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground">O desconto incide apenas sobre o valor de paineis. Paginacao, frete e biomassa nao recebem desconto.</p>
                            </div>

                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-2 text-sm">
                              <div className="flex justify-between"><span>Subtotal paineis</span><span className="font-mono" data-testid="text-subtotal-panels">R$ {fmt(panelCost)}</span></div>
                              {discountPct > 0 && (
                                <div className="flex justify-between text-success dark:text-success">
                                  <span>Desconto ({discountPct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)</span>
                                  <span className="font-mono" data-testid="text-discount-value">- R$ {fmt(discountValue)}</span>
                                </div>
                              )}
                              <div className="flex justify-between"><span>Paineis com desconto</span><span className="font-mono" data-testid="text-panels-after-discount">R$ {fmt(panelsAfter)}</span></div>
                              {paginacaoCost > 0 && (<div className="flex justify-between"><span>Projeto de paginacao</span><span className="font-mono">R$ {fmt(paginacaoCost)}</span></div>)}
                              {freight > 0 && (<div className="flex justify-between"><span>Frete</span><span className="font-mono">R$ {fmt(freight)}</span></div>)}
                              {biomass > 0 && (<div className="flex justify-between"><span>Biomassa</span><span className="font-mono">R$ {fmt(biomass)}</span></div>)}
                            </div>

                            <div className="flex justify-between items-center py-4 px-6 bg-primary/5 rounded-lg">
                              <span className="text-lg font-bold">VALOR TOTAL DA PROPOSTA</span>
                              <span className="text-2xl font-bold text-primary" data-testid="text-grand-total">
                                R$ {fmt(finalTotal)}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
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
                              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3" data-testid={`floor-${idx}-ext`}>
                                <p className="text-slate-500 text-xs mb-1">Paredes Externas</p>
                                <p className="font-bold">{pav.paredes_externas.quantidade_paineis} paineis</p>
                                <p className="text-xs text-slate-400">{pav.paredes_externas.comprimento_total_m}m | {pav.paredes_externas.area_liquida_m2}m2 liq.</p>
                                <SourceBadge src={pav.paredes_externas.measurement_source_dominant} reviewCount={pav.paredes_externas.needs_review_count} testid={`badge-ext-${idx}`} />
                              </div>
                              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3" data-testid={`floor-${idx}-int`}>
                                <p className="text-slate-500 text-xs mb-1">Paredes Internas</p>
                                <p className="font-bold">{pav.paredes_internas.quantidade_paineis} paineis</p>
                                <p className="text-xs text-slate-400">{pav.paredes_internas.comprimento_total_m}m | {pav.paredes_internas.area_liquida_m2}m2 liq.</p>
                                <SourceBadge src={pav.paredes_internas.measurement_source_dominant} reviewCount={pav.paredes_internas.needs_review_count} testid={`badge-int-${idx}`} />
                              </div>
                              {pav.muros && pav.muros.comprimento_total_m > 0 && (
                                <div className="bg-purple-50 dark:bg-purple-950/30 rounded p-3" data-testid={`floor-${idx}-muros`}>
                                  <p className="text-purple-600 dark:text-purple-300 text-xs mb-1">Muros (divisa)</p>
                                  <p className="font-bold">{pav.muros.quantidade_paineis} paineis</p>
                                  <p className="text-xs text-slate-400">{pav.muros.comprimento_total_m}m | {pav.muros.area_bruta_m2}m2</p>
                                  <SourceBadge src={pav.muros.measurement_source_dominant} reviewCount={pav.muros.needs_review_count} testid={`badge-muros-${idx}`} />
                                </div>
                              )}
                              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3" data-testid={`floor-${idx}-piso`}>
                                <p className="text-slate-500 text-xs mb-1">Laje Piso</p>
                                <p className="font-bold">{pav.laje_piso.quantidade_paineis} paineis</p>
                                <p className="text-xs text-slate-400">{pav.laje_piso.area_m2}m2{pav.laje_piso.is_radier ? " (radier)" : ""}</p>
                                <SourceBadge src={pav.laje_piso.measurement_source_dominant} testid={`badge-piso-${idx}`} />
                              </div>
                              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3" data-testid={`floor-${idx}-coberta`}>
                                <p className="text-slate-500 text-xs mb-1">Laje Coberta</p>
                                <p className="font-bold">{pav.laje_coberta.quantidade_paineis} paineis</p>
                                <p className="text-xs text-slate-400">{pav.laje_coberta.area_m2}m2</p>
                                <SourceBadge src={pav.laje_coberta.measurement_source_dominant} testid={`badge-coberta-${idx}`} />
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
                      <FileText className="h-12 w-12 mx-auto text-error mb-4" />
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
