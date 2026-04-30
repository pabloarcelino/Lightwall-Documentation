import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  MousePointer2,
  Minus,
  Spline,
  Pentagon,
  Ruler,
  CheckCircle2,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

type Pt = { x: number; y: number };
type Tool = "select" | "calibrate" | "line" | "polyline" | "polygon";
type SegCat = "parede_externa" | "parede_interna" | "muro";
type SlabCat = "laje_piso" | "laje_cobertura";

const SEG_COLOR: Record<SegCat, string> = {
  parede_externa: "#ef4444",
  parede_interna: "#3b82f6",
  muro: "#a855f7",
};
const SLAB_COLOR: Record<SlabCat, string> = {
  laje_piso: "#22c55e",
  laje_cobertura: "#f59e0b",
};

const SEG_LABEL: Record<string, string> = {
  parede_externa: "Externa",
  parede_interna: "Interna",
  muro: "Muro",
  laje_piso: "Laje Piso",
  laje_cobertura: "Laje Cob.",
};

const LEVELS = [
  "1_pavimento", "subsolo", "caixa_dagua", "situacao", "cobertura", "outro",
] as const;

interface Props {
  projectId: number;
  page: any;
  segments: any[];
  slabs: any[];
  defaultHeight: number;
  onChanged: () => void;
}

export default function TakeoffEditor({ projectId, page, segments, slabs, defaultHeight, onChanged }: Props) {
  const [tool, setTool] = useState<Tool>("select");
  const [drafCat, setDrafCat] = useState<SegCat>("parede_externa");
  const [drafLevel, setDrafLevel] = useState<typeof LEVELS[number]>("1_pavimento");
  const [draftPts, setDraftPts] = useState<Pt[]>([]);
  const [calibPts, setCalibPts] = useState<Pt[]>([]);
  const [calibOpen, setCalibOpen] = useState(false);
  const [calibDistance, setCalibDistance] = useState("");
  const [selectedKind, setSelectedKind] = useState<"seg" | "slab" | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filterCat, setFilterCat] = useState<string>("all");
  const svgRef = useRef<SVGSVGElement>(null);
  const { toast } = useToast();

  // Filter only this-page items
  const pageSegs = useMemo(() => segments.filter((s) => s.pageId === page.id), [segments, page.id]);
  const pageSlabs = useMemo(() => slabs.filter((s) => s.pageId === page.id), [slabs, page.id]);

  const filteredSegs = filterCat === "all" ? pageSegs : pageSegs.filter((s) => s.category === filterCat);
  const filteredSlabs = filterCat === "all" ? pageSlabs : pageSlabs.filter((s) => s.category === filterCat);

  // --- mutations ---
  const calibMut = useMutation({
    mutationFn: async (body: any) =>
      apiRequest("POST", `/api/projects/${projectId}/takeoff/pages/${page.id}/calibrate`, body).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Escala calibrada" });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff`] });
      onChanged();
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const createSegMut = useMutation({
    mutationFn: async (body: any) =>
      apiRequest("POST", `/api/projects/${projectId}/takeoff/segments`, body).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff`] });
      onChanged();
    },
  });

  const createSlabMut = useMutation({
    mutationFn: async (body: any) =>
      apiRequest("POST", `/api/projects/${projectId}/takeoff/slabs`, body).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff`] });
      onChanged();
    },
  });

  const updateSegMut = useMutation({
    mutationFn: async ({ id, data }: any) =>
      apiRequest("PATCH", `/api/projects/${projectId}/takeoff/segments/${id}`, data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff`] });
      onChanged();
    },
  });

  const updateSlabMut = useMutation({
    mutationFn: async ({ id, data }: any) =>
      apiRequest("PATCH", `/api/projects/${projectId}/takeoff/slabs/${id}`, data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff`] });
      onChanged();
    },
  });

  const deleteSegMut = useMutation({
    mutationFn: async (id: number) =>
      apiRequest("DELETE", `/api/projects/${projectId}/takeoff/segments/${id}`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff`] });
      onChanged();
    },
  });

  const deleteSlabMut = useMutation({
    mutationFn: async (id: number) =>
      apiRequest("DELETE", `/api/projects/${projectId}/takeoff/slabs/${id}`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff`] });
      onChanged();
    },
  });

  // Reset draft when tool changes
  useEffect(() => {
    setDraftPts([]);
    setCalibPts([]);
  }, [tool, page.id]);

  // --- helpers ---
  function ptFromEvent(e: React.MouseEvent<SVGSVGElement>): Pt {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    const p = ptFromEvent(e);
    if (tool === "calibrate") {
      const next = [...calibPts, p];
      setCalibPts(next);
      if (next.length >= 2) {
        setCalibOpen(true);
      }
      return;
    }
    if (tool === "line") {
      const next = [...draftPts, p];
      if (next.length >= 2) {
        finishDraft(next);
        setDraftPts([]);
      } else {
        setDraftPts(next);
      }
      return;
    }
    if (tool === "polyline" || tool === "polygon") {
      setDraftPts([...draftPts, p]);
      return;
    }
  }

  function handleSvgDblClick() {
    if ((tool === "polyline" || tool === "polygon") && draftPts.length >= 2) {
      finishDraft(draftPts);
      setDraftPts([]);
    }
  }

  function finishDraft(points: Pt[]) {
    if (drafCat === "parede_externa" || drafCat === "parede_interna" || drafCat === "muro") {
      createSegMut.mutate({
        pageId: page.id,
        category: drafCat,
        level: drafLevel,
        geometryType: tool === "polyline" ? "polyline" : "line",
        points,
        heightM: defaultHeight,
      });
    }
  }

  function finishPolygon() {
    if (draftPts.length < 3) {
      toast({ title: "Polígono precisa de 3+ pontos", variant: "destructive" });
      return;
    }
    createSlabMut.mutate({
      pageId: page.id,
      category: drafCat as any,
      level: drafLevel,
      polygon: draftPts,
    });
    setDraftPts([]);
  }

  function submitCalibration() {
    const meters = parseFloat(calibDistance.replace(",", "."));
    if (!meters || meters <= 0) {
      toast({ title: "Informe a distância em metros", variant: "destructive" });
      return;
    }
    calibMut.mutate({ point1: calibPts[0], point2: calibPts[1], realMeters: meters });
    setCalibOpen(false);
    setCalibPts([]);
    setCalibDistance("");
  }

  function toggleReviewed(kind: "seg" | "slab", id: number, current: boolean) {
    if (kind === "seg") updateSegMut.mutate({ id, data: { reviewed: !current, needsReview: false } });
    else updateSlabMut.mutate({ id, data: { reviewed: !current, needsReview: false } });
  }

  // --- render ---
  const { data: imgPayload } = useQuery<{ imageData: string } | null>({
    queryKey: [`/api/projects/${projectId}/takeoff/pages/${page.id}/image`],
    enabled: !!page.id,
    staleTime: 5 * 60 * 1000,
  });
  const rawImg = imgPayload?.imageData;
  const imgSrc = rawImg
    ? rawImg.startsWith("data:")
      ? rawImg
      : `data:image/png;base64,${rawImg}`
    : "";

  function pointsToSvgString(pts: Pt[]): string {
    return pts.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Toolbar + canvas */}
      <div className="col-span-12 lg:col-span-8">
        <Card className="p-3 mb-2">
          <div className="flex flex-wrap gap-2 items-center">
            <Button size="sm" variant={tool === "select" ? "default" : "outline"} onClick={() => setTool("select")} data-testid="tool-select">
              <MousePointer2 className="w-4 h-4 mr-1" /> Selecionar
            </Button>
            <Button size="sm" variant={tool === "calibrate" ? "default" : "outline"} onClick={() => setTool("calibrate")} data-testid="tool-calibrate">
              <Ruler className="w-4 h-4 mr-1" /> Calibrar
            </Button>
            <Button size="sm" variant={tool === "line" ? "default" : "outline"} onClick={() => setTool("line")} data-testid="tool-line">
              <Minus className="w-4 h-4 mr-1" /> Linha
            </Button>
            <Button size="sm" variant={tool === "polyline" ? "default" : "outline"} onClick={() => setTool("polyline")} data-testid="tool-polyline">
              <Spline className="w-4 h-4 mr-1" /> Polilinha
            </Button>
            <Button size="sm" variant={tool === "polygon" ? "default" : "outline"} onClick={() => setTool("polygon")} data-testid="tool-polygon">
              <Pentagon className="w-4 h-4 mr-1" /> Polígono (laje)
            </Button>

            {(tool === "line" || tool === "polyline") && (
              <Select value={drafCat} onValueChange={(v) => setDrafCat(v as SegCat)}>
                <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="parede_externa">Parede externa</SelectItem>
                  <SelectItem value="parede_interna">Parede interna</SelectItem>
                  <SelectItem value="muro">Muro</SelectItem>
                </SelectContent>
              </Select>
            )}
            {tool === "polygon" && (
              <>
                <Select value={drafCat} onValueChange={(v) => setDrafCat(v as any)}>
                  <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="laje_piso">Laje de piso</SelectItem>
                    <SelectItem value="laje_cobertura">Laje de cobertura</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={finishPolygon} disabled={draftPts.length < 3}>Fechar polígono</Button>
              </>
            )}
            {(tool === "line" || tool === "polyline" || tool === "polygon") && (
              <Select value={drafLevel} onValueChange={(v) => setDrafLevel(v as any)}>
                <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <div className="ml-auto flex gap-2 items-center text-xs">
              {page.pxPerMeter ? (
                <Badge variant="secondary" data-testid="badge-calibrated">Escala: {page.pxPerMeter.toFixed(1)} px/m</Badge>
              ) : (
                <Badge variant="destructive" data-testid="badge-not-calibrated">Não calibrada</Badge>
              )}
            </div>
          </div>
          {tool === "polyline" && (
            <p className="text-xs text-muted-foreground mt-1">Clique para adicionar pontos. Duplo clique para finalizar.</p>
          )}
          {tool === "polygon" && (
            <p className="text-xs text-muted-foreground mt-1">Adicione 3+ pontos e clique em "Fechar polígono".</p>
          )}
          {tool === "calibrate" && (
            <p className="text-xs text-muted-foreground mt-1">Clique em 2 pontos cuja distância real você conhece.</p>
          )}
        </Card>

        <div className="relative w-full bg-muted/30 border rounded overflow-hidden" style={{ aspectRatio: `${page.widthPx}/${page.heightPx}` }}>
          <img src={imgSrc} alt={`Pagina ${page.pageNumber}`} className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none" draggable={false} />
          <svg
            ref={svgRef}
            className={`absolute inset-0 w-full h-full ${tool !== "select" ? "cursor-crosshair" : "cursor-default"}`}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            onClick={handleSvgClick}
            onDoubleClick={handleSvgDblClick}
            data-testid="svg-takeoff-canvas"
          >
            {/* slabs */}
            {filteredSlabs.map((sl) => (
              <polygon
                key={`slab-${sl.id}`}
                points={pointsToSvgString(sl.polygonJson as Pt[])}
                fill={SLAB_COLOR[sl.category as SlabCat]}
                fillOpacity={selectedKind === "slab" && selectedId === sl.id ? 0.45 : 0.2}
                stroke={SLAB_COLOR[sl.category as SlabCat]}
                strokeWidth={selectedKind === "slab" && selectedId === sl.id ? 0.6 : 0.3}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); setSelectedKind("slab"); setSelectedId(sl.id); }}
              />
            ))}
            {/* segments */}
            {filteredSegs.map((s) => {
              const pts = s.pointsJson as Pt[];
              const color = SEG_COLOR[s.category as SegCat];
              const isSel = selectedKind === "seg" && selectedId === s.id;
              const stroke = s.needsReview && !s.reviewed ? "#f97316" : color;
              return (
                <g key={`seg-${s.id}`}>
                  <polyline
                    points={pointsToSvgString(pts)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={isSel ? 0.8 : 0.5}
                    strokeDasharray={s.needsReview && !s.reviewed ? "1,0.6" : undefined}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); setSelectedKind("seg"); setSelectedId(s.id); }}
                  />
                  {pts[0] && (
                    <text x={pts[0].x * 100} y={pts[0].y * 100 - 0.5} fontSize="1.5" fill={color} stroke="white" strokeWidth="0.2" paintOrder="stroke" className="pointer-events-none select-none">
                      {s.code}
                    </text>
                  )}
                </g>
              );
            })}
            {/* draft */}
            {draftPts.length > 0 && (
              <>
                <polyline
                  points={pointsToSvgString(draftPts)}
                  fill={tool === "polygon" ? "rgba(34,197,94,0.2)" : "none"}
                  stroke="#0ea5e9"
                  strokeWidth={0.5}
                  strokeDasharray="0.6,0.4"
                  vectorEffect="non-scaling-stroke"
                />
                {draftPts.map((p, i) => (
                  <circle key={i} cx={p.x * 100} cy={p.y * 100} r={0.6} fill="#0ea5e9" />
                ))}
              </>
            )}
            {/* calibration draft */}
            {calibPts.length > 0 && (
              <>
                {calibPts.length === 2 && (
                  <line x1={calibPts[0].x * 100} y1={calibPts[0].y * 100} x2={calibPts[1].x * 100} y2={calibPts[1].y * 100} stroke="#eab308" strokeWidth={0.5} strokeDasharray="1,0.5" vectorEffect="non-scaling-stroke" />
                )}
                {calibPts.map((p, i) => (
                  <g key={`c${i}`}>
                    <circle cx={p.x * 100} cy={p.y * 100} r={0.8} fill="#eab308" />
                    <line x1={p.x * 100 - 1.5} y1={p.y * 100} x2={p.x * 100 + 1.5} y2={p.y * 100} stroke="#eab308" strokeWidth={0.2} vectorEffect="non-scaling-stroke" />
                    <line x1={p.x * 100} y1={p.y * 100 - 1.5} x2={p.x * 100} y2={p.y * 100 + 1.5} stroke="#eab308" strokeWidth={0.2} vectorEffect="non-scaling-stroke" />
                  </g>
                ))}
              </>
            )}
          </svg>
        </div>
      </div>

      {/* Side panel */}
      <div className="col-span-12 lg:col-span-4 space-y-3">
        <Card className="p-3">
          <Label className="text-xs">Filtrar</Label>
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="parede_externa">Paredes externas</SelectItem>
              <SelectItem value="parede_interna">Paredes internas</SelectItem>
              <SelectItem value="muro">Muros</SelectItem>
              <SelectItem value="laje_piso">Lajes piso</SelectItem>
              <SelectItem value="laje_cobertura">Lajes cobertura</SelectItem>
            </SelectContent>
          </Select>
        </Card>

        <Card className="p-3 max-h-[500px] overflow-y-auto">
          <h4 className="text-sm font-semibold mb-2">Segmentos da página ({pageSegs.length})</h4>
          <div className="space-y-1">
            {filteredSegs.map((s) => (
              <SegmentRow
                key={s.id}
                seg={s}
                selected={selectedKind === "seg" && selectedId === s.id}
                onSelect={() => { setSelectedKind("seg"); setSelectedId(s.id); }}
                onReview={(rev: boolean) => updateSegMut.mutate({ id: s.id, data: { reviewed: rev, needsReview: false } })}
                onDelete={() => deleteSegMut.mutate(s.id)}
                onChangeHeight={(h: number) => updateSegMut.mutate({ id: s.id, data: { heightM: h } })}
                onChangeLength={(l: number) => updateSegMut.mutate({ id: s.id, data: { lengthMFinal: l } })}
              />
            ))}
            {filteredSegs.length === 0 && <p className="text-xs text-muted-foreground">Sem segmentos.</p>}
          </div>
          {filteredSlabs.length > 0 && (
            <>
              <h4 className="text-sm font-semibold mt-3 mb-2">Lajes ({pageSlabs.length})</h4>
              {filteredSlabs.map((sl) => (
                <div key={sl.id} className={`flex items-center gap-2 text-xs p-1 rounded ${selectedKind === "slab" && selectedId === sl.id ? "bg-accent" : ""}`}
                  onClick={() => { setSelectedKind("slab"); setSelectedId(sl.id); }}>
                  <Badge style={{ background: SLAB_COLOR[sl.category as SlabCat], color: "white" }}>{sl.code}</Badge>
                  <span className="flex-1">{SEG_LABEL[sl.category]} • {(sl.areaM2Final ?? sl.areaM2Calculated ?? sl.areaM2Declared ?? sl.areaM2Ai ?? 0).toFixed(2)} m²</span>
                  {sl.needsReview && !sl.reviewed && <AlertTriangle className="w-3 h-3 text-orange-500" />}
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); toggleReviewed("slab", sl.id, sl.reviewed); }}>
                    <CheckCircle2 className={`w-3 h-3 ${sl.reviewed ? "text-green-600" : "text-muted-foreground"}`} />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); deleteSlabMut.mutate(sl.id); }}>
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                </div>
              ))}
            </>
          )}
        </Card>
      </div>

      {/* Calibration dialog */}
      <Dialog open={calibOpen} onOpenChange={setCalibOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Calibrar escala</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm">Distância real entre os 2 pontos selecionados (em metros):</p>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              value={calibDistance}
              onChange={(e) => setCalibDistance(e.target.value)}
              placeholder="Ex.: 5.00"
              data-testid="input-calib-meters"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCalibOpen(false); setCalibPts([]); }}>Cancelar</Button>
            <Button onClick={submitCalibration} data-testid="button-calib-confirm">Calibrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SegmentRow({ seg, selected, onSelect, onReview, onDelete, onChangeHeight, onChangeLength }: any) {
  const [editing, setEditing] = useState(false);
  const [h, setH] = useState(seg.heightM ?? 3);
  const [l, setL] = useState(seg.lengthMFinal ?? seg.lengthMCalculated ?? seg.lengthMAi ?? 0);
  useEffect(() => { setH(seg.heightM ?? 3); setL(seg.lengthMFinal ?? seg.lengthMCalculated ?? seg.lengthMAi ?? 0); }, [seg.id, seg.heightM, seg.lengthMFinal]);

  const lengthAi = seg.lengthMAi;
  const lengthCalc = seg.lengthMCalculated;
  const drift = (lengthAi != null && lengthCalc != null && lengthCalc > 0)
    ? Math.abs(lengthAi - lengthCalc) / lengthCalc
    : 0;
  const driftWarn = drift > 0.10;
  const lowConf = (seg.confidence ?? 1) < 0.7;

  return (
    <div className={`text-xs p-2 rounded border ${selected ? "border-primary bg-accent" : "border-transparent"}`} onClick={onSelect}>
      <div className="flex items-center gap-2">
        <Badge style={{ background: SEG_COLOR[seg.category as SegCat], color: "white" }}>{seg.code}</Badge>
        <span className="flex-1 truncate">{SEG_LABEL[seg.category]} • {(seg.lengthMFinal ?? seg.lengthMCalculated ?? seg.lengthMAi ?? 0).toFixed(2)}m × {(seg.heightM ?? 0).toFixed(2)}m</span>
        {(driftWarn || lowConf) && !seg.reviewed && (
          <AlertTriangle className="w-3 h-3 text-orange-500" />
        )}
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setEditing(!editing); }}>
          ✎
        </Button>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onReview(!seg.reviewed); }}>
          <CheckCircle2 className={`w-3 h-3 ${seg.reviewed ? "text-green-600" : "text-muted-foreground"}`} />
        </Button>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 className="w-3 h-3 text-destructive" />
        </Button>
      </div>
      {seg.areaM2OneFace != null && (
        <div className="text-[11px] text-muted-foreground mt-0.5">
          área 1 face: {seg.areaM2OneFace.toFixed(2)} m²
          {seg.areaM2TwoFaces ? ` • 2 faces: ${seg.areaM2TwoFaces.toFixed(2)} m²` : ""}
          • conf: {((seg.confidence ?? 1) * 100).toFixed(0)}%
          {driftWarn && <span className="text-orange-600"> • drift {(drift * 100).toFixed(0)}%</span>}
        </div>
      )}
      {editing && (
        <div className="grid grid-cols-2 gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
          <div>
            <Label className="text-[10px]">Altura (m)</Label>
            <Input type="number" step="0.05" value={h} onChange={(e) => setH(parseFloat(e.target.value))} className="h-7" />
          </div>
          <div>
            <Label className="text-[10px]">Comp. final (m)</Label>
            <Input type="number" step="0.01" value={l} onChange={(e) => setL(parseFloat(e.target.value))} className="h-7" />
          </div>
          <div className="col-span-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { onChangeHeight(h); onChangeLength(l); setEditing(false); }}>Salvar</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
