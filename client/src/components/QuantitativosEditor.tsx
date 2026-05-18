import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calculator,
  Plus,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Layers,
  SquareStack,
  DoorOpen,
  HelpCircle,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  GraduationCap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Esquadria {
  tipo: string;
  codigo: string;
  largura_m: number;
  altura_m: number;
  peitoril_m?: number;
}

interface EditableWall {
  id: string;
  nivel: string;
  classe: "externa" | "interna" | "muro";
  comprimento_m: number;
  altura_m: number;
  espessura_m: number;
  measurement_source: string;
  confidence: number;
  opening_area_m2: number;
  has_door: boolean;
  has_window: boolean;
  esquadrias: Esquadria[];
  enabled: boolean;
  needs_review?: boolean;
  review_reason?: string;
  painelType?: "2P" | "SP" | "Muro";
}

interface EditableSlab {
  id: string;
  nivel: string;
  classe: "coberta" | "piso" | "radier";
  area_m2: number;
  measurement_source: string;
  confidence: number;
  enabled: boolean;
}

interface EditableCorner {
  id: string;
  nivel: string;
  tipo: string;
  qtd_cantos: number;
  enabled: boolean;
}

interface Props {
  projectId: string;
  extractedData: any[];
  onRecalculated: () => void;
  highlightedWallId?: string | null;
  onHoverWall?: (wallId: string | null) => void;
  onWallsChange?: (walls: EditableWall[]) => void;
}

export default function QuantitativosEditor({ projectId, extractedData, onRecalculated, highlightedWallId, onHoverWall, onWallsChange }: Props) {
  const { toast } = useToast();
  const [walls, setWalls] = useState<EditableWall[]>([]);
  const [slabs, setSlabs] = useState<EditableSlab[]>([]);
  const [corners, setCorners] = useState<EditableCorner[]>([]);
  const [saving, setSaving] = useState(false);
  const [expandedWalls, setExpandedWalls] = useState<Set<string>>(new Set());
  const [hasChanges, setHasChanges] = useState(false);
  const [selectedWallIds, setSelectedWallIds] = useState<Set<string>>(new Set());
  const [selectedSlabIds, setSelectedSlabIds] = useState<Set<string>>(new Set());
  const [bulkClasseWall, setBulkClasseWall] = useState<string>("");
  const [bulkPainelType, setBulkPainelType] = useState<string>("");
  const [bulkClasseSlab, setBulkClasseSlab] = useState<string>("");
  const [exemplarMode, setExemplarMode] = useState(false);
  const [exemplifiedIds, setExemplifiedIds] = useState<Set<string>>(new Set());

  // Dedupe in-memory: evita registrar feedback identico (mesma parede+acao+classe) em janela curta.
  const recentFeedbackKeys = (window as any).__lwFeedbackKeys || ((window as any).__lwFeedbackKeys = new Map<string, number>());
  async function sendFeedback(payload: any) {
    const key = `${payload.project_id}|${payload.wall_id}|${payload.action}|${payload.corrected_classe ?? ""}`;
    const now = Date.now();
    const last = recentFeedbackKeys.get(key);
    if (last && (now - last) < 5000) return;
    recentFeedbackKeys.set(key, now);
    // Limpa entradas antigas (> 30s)
    for (const [k, t] of recentFeedbackKeys) if (now - t > 30000) recentFeedbackKeys.delete(k);
    try {
      await apiRequest("POST", "/api/wall-feedback", payload);
    } catch (e: any) {
      console.warn("wall-feedback falhou:", e);
      // 403/projeto-nao-pertence: avisa silenciosamente; 4xx/5xx outros tambem nao bloqueiam
    }
  }

  function buildFeedbackPayload(w: EditableWall, action: "confirm" | "correct" | "exemplar" | "not_wall", originalClasse: string | null, correctedClasse: string | null) {
    return {
      project_id: Number(projectId),
      wall_id: w.id,
      nivel: w.nivel,
      espessura_m: w.espessura_m,
      comprimento_m: w.comprimento_m,
      has_window: !!w.has_window,
      has_door: !!w.has_door,
      review_reason_bucket: w.review_reason ? (w.review_reason.split(" ")[0] || null) : null,
      original_classe: originalClasse,
      corrected_classe: correctedClasse,
      action,
      is_exemplar: action === "exemplar" || exemplarMode,
    };
  }

  useEffect(() => {
    const fusao = extractedData?.find((d: any) => d.elementType === "etapa4_fusao");
    if (fusao?.data?.resultado) {
      const r = fusao.data.resultado;
      setWalls((r.walls || []).map((w: any) => ({ ...w, enabled: w.enabled !== false })));
      setSlabs((r.slabs || []).map((s: any) => ({ ...s, enabled: s.enabled !== false })));
      setCorners((r.corners || []).map((c: any) => ({ ...c, enabled: c.enabled !== false })));
    }
  }, [extractedData]);

  useEffect(() => {
    if (onWallsChange) onWallsChange(walls);
  }, [walls, onWallsChange]);

  const markChanged = () => setHasChanges(true);

  const updateWall = (idx: number, field: string, value: any) => {
    setWalls(prev => {
      const next = [...prev];
      const before = next[idx];
      next[idx] = { ...before, [field]: value };
      if (field === "esquadrias") {
        let openingArea = 0;
        for (const esq of (value as Esquadria[])) {
          openingArea += esq.largura_m * esq.altura_m;
        }
        next[idx].opening_area_m2 = Math.round(openingArea * 100) / 100;
      }
      // Correcao de classe registra feedback automatico
      if (field === "classe" && value !== before.classe) {
        sendFeedback(buildFeedbackPayload(before, exemplarMode ? "exemplar" : "correct", before.classe, value));
      }
      if (field === "enabled" && value === false) {
        sendFeedback(buildFeedbackPayload(before, "not_wall", before.classe, "nao_parede"));
      }
      return next;
    });
    markChanged();
  };

  const toggleWallSelected = (id: string) => {
    setSelectedWallIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSlabSelected = (id: string) => {
    setSelectedSlabIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllWalls = (checked: boolean) => {
    if (checked) setSelectedWallIds(new Set(walls.map(w => w.id))); else setSelectedWallIds(new Set());
  };
  const selectAllSlabs = (checked: boolean) => {
    if (checked) setSelectedSlabIds(new Set(slabs.map(s => s.id))); else setSelectedSlabIds(new Set());
  };

  const applyBulkWalls = () => {
    if (selectedWallIds.size === 0) return;
    setWalls(prev => prev.map(w => {
      if (!selectedWallIds.has(w.id)) return w;
      const updated: EditableWall = { ...w };
      if (bulkClasseWall && (bulkClasseWall === "externa" || bulkClasseWall === "interna" || bulkClasseWall === "muro")) {
        if (updated.classe !== bulkClasseWall) {
          sendFeedback(buildFeedbackPayload(w, exemplarMode ? "exemplar" : "correct", w.classe, bulkClasseWall));
          updated.classe = bulkClasseWall as EditableWall["classe"];
        }
      }
      if (bulkPainelType && (bulkPainelType === "2P" || bulkPainelType === "SP" || bulkPainelType === "Muro")) {
        updated.painelType = bulkPainelType as EditableWall["painelType"];
      }
      return updated;
    }));
    markChanged();
    toast({ title: "Lote aplicado", description: `${selectedWallIds.size} parede(s) atualizada(s)` });
    setBulkClasseWall(""); setBulkPainelType(""); setSelectedWallIds(new Set());
  };

  const applyBulkSlabs = () => {
    if (selectedSlabIds.size === 0 || !bulkClasseSlab) return;
    setSlabs(prev => prev.map(s => selectedSlabIds.has(s.id) ? { ...s, classe: bulkClasseSlab as EditableSlab["classe"] } : s));
    markChanged();
    toast({ title: "Lote aplicado", description: `${selectedSlabIds.size} laje(s) atualizada(s)` });
    setBulkClasseSlab(""); setSelectedSlabIds(new Set());
  };

  const confirmWall = (w: EditableWall) => {
    sendFeedback(buildFeedbackPayload(w, "confirm", w.classe, w.classe));
    toast({ title: "Confirmado", description: `${w.id}: classificacao "${w.classe}" confirmada` });
  };
  const exemplifyWall = (w: EditableWall) => {
    sendFeedback(buildFeedbackPayload(w, "exemplar", w.classe, w.classe));
    setExemplifiedIds(prev => { const next = new Set(prev); next.add(w.id); return next; });
    toast({ title: "Marcada como exemplo", description: `${w.id} ira reforcar futuras classificacoes` });
  };
  // Correcao rapida direto do popover (sem precisar abrir o card)
  const correctWallTo = (w: EditableWall, target: "externa" | "interna" | "muro" | "nao_parede") => {
    const idx = walls.findIndex(x => x.id === w.id);
    if (idx < 0) return;
    if (target === "nao_parede") {
      updateWall(idx, "enabled", false);
      toast({ title: "Desligada", description: `${w.id} marcada como "nao e parede"` });
    } else {
      updateWall(idx, "classe", target);
      toast({ title: "Reclassificada", description: `${w.id}: ${w.classe} → ${target}` });
    }
  };

  const updateSlab = (idx: number, field: string, value: any) => {
    setSlabs(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
    markChanged();
  };

  const updateCorner = (idx: number, field: string, value: any) => {
    setCorners(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
    markChanged();
  };

  const addWall = () => {
    const newId = `P${walls.length + 1}`;
    setWalls(prev => [...prev, {
      id: newId,
      nivel: walls.length > 0 ? walls[0].nivel : "Terreo",
      classe: "interna",
      comprimento_m: 3,
      altura_m: 3,
      espessura_m: 0.09,
      measurement_source: "manual",
      confidence: 1,
      opening_area_m2: 0,
      has_door: false,
      has_window: false,
      esquadrias: [],
      enabled: true,
    }]);
    setExpandedWalls(prev => new Set(prev).add(newId));
    markChanged();
  };

  const addSlab = () => {
    setSlabs(prev => [...prev, {
      id: `L${slabs.length + 1}`,
      nivel: slabs.length > 0 ? slabs[0].nivel : "Terreo",
      classe: "piso",
      area_m2: 50,
      measurement_source: "manual",
      confidence: 1,
      enabled: true,
    }]);
    markChanged();
  };

  const removeWall = (idx: number) => {
    setWalls(prev => prev.filter((_, i) => i !== idx));
    markChanged();
  };

  const removeSlab = (idx: number) => {
    setSlabs(prev => prev.filter((_, i) => i !== idx));
    markChanged();
  };

  const addEsquadria = (wallIdx: number) => {
    const wall = walls[wallIdx];
    const newEsqs = [...wall.esquadrias, {
      tipo: "porta",
      codigo: `E${wall.esquadrias.length + 1}`,
      largura_m: 0.8,
      altura_m: 2.1,
      peitoril_m: 0,
    }];
    updateWall(wallIdx, "esquadrias", newEsqs);
  };

  const removeEsquadria = (wallIdx: number, esqIdx: number) => {
    const wall = walls[wallIdx];
    const newEsqs = wall.esquadrias.filter((_, i) => i !== esqIdx);
    updateWall(wallIdx, "esquadrias", newEsqs);
  };

  const updateEsquadria = (wallIdx: number, esqIdx: number, field: string, value: any) => {
    const wall = walls[wallIdx];
    const newEsqs = [...wall.esquadrias];
    newEsqs[esqIdx] = { ...newEsqs[esqIdx], [field]: value };
    updateWall(wallIdx, "esquadrias", newEsqs);
  };

  const toggleWallExpanded = (id: string) => {
    setExpandedWalls(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleRecalculate = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/quantitativos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walls, slabs, corners }),
      });
      if (!res.ok) throw new Error("Erro ao recalcular");
      toast({ title: "Recalculado", description: "Orcamento atualizado com os novos quantitativos" });
      setHasChanges(false);
      onRecalculated();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const enabledWalls = walls.filter(w => w.enabled);
  const enabledSlabs = slabs.filter(s => s.enabled);
  const totalWallArea = enabledWalls.reduce((s, w) => s + (Number(w.comprimento_m) || 0) * (Number(w.altura_m) || 0), 0);
  const totalOpeningArea = enabledWalls.reduce((s, w) => s + (Number(w.opening_area_m2) || 0), 0);
  const totalSlabArea = enabledSlabs.reduce((s, s2) => s + (Number(s2.area_m2) || 0), 0);

  if (walls.length === 0 && slabs.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <p className="text-slate-500">Nenhum dado de quantitativos disponivel. Processe o projeto primeiro.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold">Editor de Quantitativos</h3>
          <p className="text-sm text-muted-foreground">Edite paredes, lajes e aberturas. Desative elementos que nao devem ser considerados no orcamento.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none" title="Marca as correcoes deste projeto como exemplo, dando-lhes mais peso na aprendizagem da IA">
            <Switch checked={exemplarMode} onCheckedChange={setExemplarMode} data-testid="switch-exemplar-mode" />
            <span className="flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" /> Modo Exemplificar</span>
          </label>
          <Button
            onClick={handleRecalculate}
            disabled={saving || !hasChanges}
            className="gap-2"
            data-testid="button-recalculate"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
            Recalcular Orcamento
          </Button>
        </div>
      </div>

      {exemplifiedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 text-xs" data-testid="banner-exemplares">
          <Sparkles className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          <span className="font-medium">{exemplifiedIds.size} exemplo(s) nesta sessao:</span>
          <span className="text-muted-foreground truncate">
            {Array.from(exemplifiedIds).slice(0, 12).join(", ")}{exemplifiedIds.size > 12 ? "…" : ""}
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card className="glass-card">
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Area Bruta Paredes</p>
            <p className="text-2xl font-bold">{totalWallArea.toFixed(1)} m2</p>
            <p className="text-xs text-muted-foreground">{enabledWalls.length} parede(s) ativas</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Area Aberturas</p>
            <p className="text-2xl font-bold">{totalOpeningArea.toFixed(1)} m2</p>
            <p className="text-xs text-muted-foreground">{enabledWalls.reduce((s, w) => s + w.esquadrias.length, 0)} abertura(s)</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Area Total Lajes</p>
            <p className="text-2xl font-bold">{totalSlabArea.toFixed(1)} m2</p>
            <p className="text-xs text-muted-foreground">{enabledSlabs.length} laje(s) ativa(s)</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Paredes ({walls.length})
            </CardTitle>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Checkbox
                  checked={selectedWallIds.size > 0 && selectedWallIds.size === walls.length}
                  onCheckedChange={(c) => selectAllWalls(!!c)}
                  data-testid="checkbox-select-all-walls"
                />
                Selecionar todas
              </label>
              <Button variant="outline" size="sm" onClick={addWall} className="gap-1" data-testid="button-add-wall">
                <Plus className="h-3 w-3" /> Adicionar Parede
              </Button>
            </div>
          </div>
          {selectedWallIds.size > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap rounded-md border bg-muted/30 p-2 text-xs" data-testid="bulk-wall-bar">
              <span className="font-medium">{selectedWallIds.size} selecionada(s):</span>
              <Select value={bulkClasseWall} onValueChange={setBulkClasseWall}>
                <SelectTrigger className="h-7 w-32 text-xs" data-testid="select-bulk-classe-wall"><SelectValue placeholder="Classe..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="externa">Externa</SelectItem>
                  <SelectItem value="interna">Interna</SelectItem>
                  <SelectItem value="muro">Muro</SelectItem>
                </SelectContent>
              </Select>
              <Select value={bulkPainelType} onValueChange={setBulkPainelType}>
                <SelectTrigger className="h-7 w-32 text-xs" data-testid="select-bulk-painel"><SelectValue placeholder="Painel..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2P">2P</SelectItem>
                  <SelectItem value="SP">SP</SelectItem>
                  <SelectItem value="Muro">Muro</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="h-7 text-xs" onClick={applyBulkWalls} disabled={!bulkClasseWall && !bulkPainelType} data-testid="button-apply-bulk-walls">Aplicar</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedWallIds(new Set())}>Limpar</Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {walls.map((wall, idx) => (
              <div
                key={wall.id}
                id={`wall-row-${wall.id}`}
                className={`border rounded-lg transition-colors ${!wall.enabled ? "opacity-50 bg-muted/30" : ""} ${highlightedWallId === wall.id ? "ring-2 ring-primary bg-primary/5" : ""}`}
                data-testid={`wall-row-${idx}`}
                onMouseEnter={() => onHoverWall?.(wall.id)}
                onMouseLeave={() => onHoverWall?.(null)}
              >
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                  onClick={() => toggleWallExpanded(wall.id)}
                >
                  <Checkbox
                    checked={selectedWallIds.has(wall.id)}
                    onCheckedChange={() => toggleWallSelected(wall.id)}
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`checkbox-wall-${idx}`}
                  />
                  {expandedWalls.has(wall.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <Switch
                    checked={wall.enabled}
                    onCheckedChange={(v) => { updateWall(idx, "enabled", v); }}
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`switch-wall-${idx}`}
                  />
                  <Badge
                    variant={wall.classe === "externa" ? "default" : wall.classe === "muro" ? "outline" : "secondary"}
                    className="text-xs"
                  >
                    {wall.classe === "externa" ? "EXT" : wall.classe === "muro" ? "MURO" : "INT"}
                  </Badge>
                  <span className="text-sm font-medium">{wall.id}</span>
                  <span className="text-xs text-muted-foreground">{wall.nivel}</span>
                  {wall.needs_review && (
                    <Popover>
                      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400 cursor-pointer hover-elevate" data-testid={`badge-review-${idx}`}>
                          <AlertTriangle className="h-3 w-3" /> revisar
                        </Badge>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 text-xs" onClick={(e) => e.stopPropagation()}>
                        <div className="space-y-2">
                          <div className="font-semibold flex items-center gap-1"><HelpCircle className="h-3.5 w-3.5" /> Por que a IA marcou para revisar?</div>
                          <p className="text-muted-foreground">{wall.review_reason || "Sem detalhes."}</p>
                          <div className="text-[10px] text-muted-foreground">
                            Confianca: {(wall.confidence * 100).toFixed(0)}% · Fonte: {wall.measurement_source}
                          </div>
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => confirmWall(wall)} data-testid={`button-confirm-${idx}`}>
                              <CheckCircle2 className="h-3 w-3" /> Confirmar
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => exemplifyWall(wall)} data-testid={`button-exemplify-${idx}`}>
                              <Sparkles className="h-3 w-3" /> Exemplificar
                            </Button>
                          </div>
                          <div className="pt-1 border-t">
                            <div className="text-[10px] text-muted-foreground mb-1">Corrigir para:</div>
                            <div className="flex flex-wrap gap-1">
                              {(["externa","interna","muro"] as const).filter(c => c !== wall.classe).map(c => (
                                <Button key={c} size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => correctWallTo(wall, c)} data-testid={`button-fix-${c}-${idx}`}>{c}</Button>
                              ))}
                              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 text-destructive" onClick={() => correctWallTo(wall, "nao_parede")} data-testid={`button-fix-notwall-${idx}`}>nao e parede</Button>
                            </div>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                  {!wall.needs_review && (
                    <Popover>
                      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Por que IA decidiu?"
                          data-testid={`button-why-${idx}`}
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 text-xs" onClick={(e) => e.stopPropagation()}>
                        <div className="space-y-2">
                          <div className="font-semibold">Decisao da IA</div>
                          <div>Classe: <Badge variant="outline" className="text-[10px]">{wall.classe}</Badge></div>
                          <div className="text-[10px] text-muted-foreground">Confianca: {(wall.confidence * 100).toFixed(0)}% · Fonte: {wall.measurement_source}</div>
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => confirmWall(wall)} data-testid={`button-confirm-${idx}`}>
                              <CheckCircle2 className="h-3 w-3" /> Confirmar
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => exemplifyWall(wall)} data-testid={`button-exemplify-${idx}`}>
                              <Sparkles className="h-3 w-3" /> Exemplificar
                            </Button>
                          </div>
                          <div className="pt-1 border-t">
                            <div className="text-[10px] text-muted-foreground mb-1">Corrigir para:</div>
                            <div className="flex flex-wrap gap-1">
                              {(["externa","interna","muro"] as const).filter(c => c !== wall.classe).map(c => (
                                <Button key={c} size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => correctWallTo(wall, c)} data-testid={`button-fix-${c}-${idx}`}>{c}</Button>
                              ))}
                              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 text-destructive" onClick={() => correctWallTo(wall, "nao_parede")} data-testid={`button-fix-notwall-${idx}`}>nao e parede</Button>
                            </div>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                  <span className="text-sm ml-auto">
                    {wall.comprimento_m}m x {wall.altura_m}m = {(wall.comprimento_m * wall.altura_m).toFixed(1)} m2
                  </span>
                  {wall.painelType && (
                    <Badge variant="secondary" className="text-[10px]">{wall.painelType}</Badge>
                  )}
                  {wall.esquadrias.length > 0 && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <DoorOpen className="h-3 w-3" /> {wall.esquadrias.length}
                    </Badge>
                  )}
                </div>

                {expandedWalls.has(wall.id) && (
                  <div className="px-4 pb-4 border-t pt-3 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div>
                        <Label className="text-xs">Nivel</Label>
                        <Input
                          value={wall.nivel}
                          onChange={(e) => updateWall(idx, "nivel", e.target.value)}
                          className="h-8 text-sm"
                          data-testid={`input-wall-nivel-${idx}`}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Classe</Label>
                        <Select value={wall.classe} onValueChange={(v) => updateWall(idx, "classe", v)}>
                          <SelectTrigger className="h-8 text-sm" data-testid={`select-wall-classe-${idx}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="externa">Externa</SelectItem>
                            <SelectItem value="interna">Interna</SelectItem>
                            <SelectItem value="muro">Muro</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Comprimento (m)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={wall.comprimento_m}
                          onChange={(e) => updateWall(idx, "comprimento_m", parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm"
                          data-testid={`input-wall-comp-${idx}`}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Altura (m)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={wall.altura_m}
                          onChange={(e) => updateWall(idx, "altura_m", parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm"
                          data-testid={`input-wall-alt-${idx}`}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Espessura (m)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={wall.espessura_m}
                          onChange={(e) => updateWall(idx, "espessura_m", parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm"
                          data-testid={`input-wall-esp-${idx}`}
                        />
                      </div>
                    </div>

                    <div className="border-t pt-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium flex items-center gap-1">
                          <DoorOpen className="h-4 w-4" /> Aberturas ({wall.esquadrias.length})
                        </span>
                        <Button variant="outline" size="sm" onClick={() => addEsquadria(idx)} className="h-7 text-xs gap-1" data-testid={`button-add-esquadria-${idx}`}>
                          <Plus className="h-3 w-3" /> Abertura
                        </Button>
                      </div>
                      {wall.esquadrias.length > 0 && (
                        <div className="space-y-2">
                          {wall.esquadrias.map((esq, esqIdx) => (
                            <div key={esqIdx} className="flex items-center gap-2 bg-muted/30 rounded p-2" data-testid={`esquadria-${idx}-${esqIdx}`}>
                              <Select
                                value={esq.tipo}
                                onValueChange={(v) => {
                                  updateEsquadria(idx, esqIdx, "tipo", v);
                                  if (v === "porta") {
                                    updateEsquadria(idx, esqIdx, "largura_m", 0.8);
                                    updateEsquadria(idx, esqIdx, "altura_m", 2.1);
                                  } else {
                                    updateEsquadria(idx, esqIdx, "largura_m", 1.2);
                                    updateEsquadria(idx, esqIdx, "altura_m", 1.2);
                                  }
                                }}
                              >
                                <SelectTrigger className="h-7 text-xs w-24">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="porta">Porta</SelectItem>
                                  <SelectItem value="janela">Janela</SelectItem>
                                </SelectContent>
                              </Select>
                              <Input
                                value={esq.codigo}
                                onChange={(e) => updateEsquadria(idx, esqIdx, "codigo", e.target.value)}
                                className="h-7 text-xs w-16"
                                placeholder="Cod"
                              />
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={esq.largura_m}
                                  onChange={(e) => updateEsquadria(idx, esqIdx, "largura_m", parseFloat(e.target.value) || 0)}
                                  className="h-7 text-xs w-16"
                                />
                                <span className="text-xs text-muted-foreground">x</span>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={esq.altura_m}
                                  onChange={(e) => updateEsquadria(idx, esqIdx, "altura_m", parseFloat(e.target.value) || 0)}
                                  className="h-7 text-xs w-16"
                                />
                                <span className="text-xs text-muted-foreground">m</span>
                              </div>
                              <span className="text-xs text-muted-foreground ml-auto">
                                {(esq.largura_m * esq.altura_m).toFixed(2)} m2
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => removeEsquadria(idx, esqIdx)}
                              >
                                <Trash2 className="h-3 w-3 text-red-500" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end">
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 gap-1" onClick={() => removeWall(idx)}>
                        <Trash2 className="h-3 w-3" /> Remover Parede
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <SquareStack className="h-5 w-5" />
              Lajes ({slabs.length})
            </CardTitle>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Checkbox
                  checked={selectedSlabIds.size > 0 && selectedSlabIds.size === slabs.length}
                  onCheckedChange={(c) => selectAllSlabs(!!c)}
                  data-testid="checkbox-select-all-slabs"
                />
                Selecionar todas
              </label>
              <Button variant="outline" size="sm" onClick={addSlab} className="gap-1" data-testid="button-add-slab">
                <Plus className="h-3 w-3" /> Adicionar Laje
              </Button>
            </div>
          </div>
          {selectedSlabIds.size > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap rounded-md border bg-muted/30 p-2 text-xs" data-testid="bulk-slab-bar">
              <span className="font-medium">{selectedSlabIds.size} selecionada(s):</span>
              <Select value={bulkClasseSlab} onValueChange={setBulkClasseSlab}>
                <SelectTrigger className="h-7 w-32 text-xs" data-testid="select-bulk-classe-slab"><SelectValue placeholder="Classe..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="piso">Piso</SelectItem>
                  <SelectItem value="coberta">Coberta</SelectItem>
                  <SelectItem value="radier">Radier</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="h-7 text-xs" onClick={applyBulkSlabs} disabled={!bulkClasseSlab} data-testid="button-apply-bulk-slabs">Aplicar</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedSlabIds(new Set())}>Limpar</Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {slabs.map((slab, idx) => (
              <div
                key={slab.id}
                className={`border rounded-lg px-4 py-3 ${!slab.enabled ? "opacity-50 bg-muted/30" : ""}`}
                data-testid={`slab-row-${idx}`}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <Checkbox
                    checked={selectedSlabIds.has(slab.id)}
                    onCheckedChange={() => toggleSlabSelected(slab.id)}
                    data-testid={`checkbox-slab-${idx}`}
                  />
                  <Switch
                    checked={slab.enabled}
                    onCheckedChange={(v) => updateSlab(idx, "enabled", v)}
                    data-testid={`switch-slab-${idx}`}
                  />
                  <Badge variant={slab.classe === "coberta" ? "default" : slab.classe === "radier" ? "destructive" : "secondary"} className="text-xs">
                    {slab.classe.toUpperCase()}
                  </Badge>
                  <span className="text-sm font-medium">{slab.id}</span>
                  <div className="flex items-center gap-2 ml-auto">
                    <div>
                      <Input
                        value={slab.nivel}
                        onChange={(e) => updateSlab(idx, "nivel", e.target.value)}
                        className="h-8 text-sm w-28"
                        placeholder="Nivel"
                        data-testid={`input-slab-nivel-${idx}`}
                      />
                    </div>
                    <Select value={slab.classe} onValueChange={(v) => updateSlab(idx, "classe", v as any)}>
                      <SelectTrigger className="h-8 text-sm w-28" data-testid={`select-slab-classe-${idx}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="piso">Piso</SelectItem>
                        <SelectItem value="coberta">Coberta</SelectItem>
                        <SelectItem value="radier">Radier</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        step="0.01"
                        value={slab.area_m2}
                        onChange={(e) => updateSlab(idx, "area_m2", parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm w-24"
                        data-testid={`input-slab-area-${idx}`}
                      />
                      <span className="text-xs text-muted-foreground">m2</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeSlab(idx)}>
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {hasChanges && (
        <div className="sticky bottom-4 flex justify-center">
          <div className="glass-panel border border-primary/30 rounded-full px-6 py-3 flex items-center gap-4 shadow-lg">
            <span className="text-sm font-medium">Alteracoes pendentes</span>
            <Button onClick={handleRecalculate} disabled={saving} className="gap-2 rounded-full" data-testid="button-recalculate-sticky">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              Recalcular
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
