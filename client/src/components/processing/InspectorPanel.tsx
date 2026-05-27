import { useMemo, useState } from "react";
import { Search, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProcessingSync } from "./useProcessingSync";

interface Wall {
  id: string;
  displayLabel?: string;
  classe: "externa" | "interna" | "muro";
  nivel: string;
  comprimento_m: number;
  altura_m: number;
  needs_review?: boolean;
  review_reason?: string;
  sourceContribution?: {
    primary?: { view?: string };
    enrichments?: Array<{ view?: string; reason?: string }>;
  };
  enabled?: boolean;
}

interface Slab {
  id: string;
  displayLabel?: string;
  classe: "piso" | "coberta" | "radier";
  nivel: string;
  area_m2: number;
  enabled?: boolean;
}

interface AuditNote {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  relatedIds?: string[];
}

interface InspectorPanelProps {
  walls: Wall[];
  slabs: Slab[];
  auditNotes: AuditNote[];
  sync: ProcessingSync;
}

const CLASSE_COLORS: Record<string, string> = {
  externa: "bg-error-soft text-error border-error/30",
  interna: "bg-success-soft text-success border-success/30",
  muro:    "bg-info-soft text-info border-info/30",
  piso:    "bg-success-soft text-success border-success/30",
  coberta: "bg-warning-soft text-warning border-warning/30",
  radier:  "bg-info-soft text-info border-info/30",
};

export function InspectorPanel({ walls, slabs, auditNotes, sync }: InspectorPanelProps) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"paredes" | "lajes" | "audit">("paredes");

  // Filtrar por pavimento ativo + busca + enabled
  const filteredWalls = useMemo(() => {
    const q = search.trim().toLowerCase();
    return walls
      .filter(w => w.enabled !== false)
      .filter(w => sync.activePavimento === "all" || w.nivel === sync.activePavimento)
      .filter(w => {
        if (!q) return true;
        const label = (w.displayLabel || w.id).toLowerCase();
        return label.includes(q) || w.classe.includes(q) || w.nivel.toLowerCase().includes(q);
      });
  }, [walls, sync.activePavimento, search]);

  const filteredSlabs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return slabs
      .filter(s => s.enabled !== false)
      .filter(s => sync.activePavimento === "all" || s.nivel === sync.activePavimento)
      .filter(s => {
        if (!q) return true;
        const label = (s.displayLabel || s.id).toLowerCase();
        return label.includes(q) || s.classe.includes(q);
      });
  }, [slabs, sync.activePavimento, search]);

  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return auditNotes;
    return auditNotes.filter(n => n.message.toLowerCase().includes(q) || n.code.toLowerCase().includes(q));
  }, [auditNotes, search]);

  const errorCount = auditNotes.filter(n => n.severity === "error").length;
  const warningCount = auditNotes.filter(n => n.severity === "warning").length;

  return (
    <div className="flex flex-col h-full overflow-hidden border-l border-border bg-card">
      <div className="px-3 pt-3 pb-2 border-b border-border">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="w-full grid grid-cols-3 h-9">
            <TabsTrigger value="paredes" className="text-xs" data-testid="inspector-tab-paredes">
              Paredes <span className="ml-1 text-muted-foreground">({filteredWalls.length})</span>
            </TabsTrigger>
            <TabsTrigger value="lajes" className="text-xs" data-testid="inspector-tab-lajes">
              Lajes <span className="ml-1 text-muted-foreground">({filteredSlabs.length})</span>
            </TabsTrigger>
            <TabsTrigger value="audit" className="text-xs" data-testid="inspector-tab-audit">
              Auditoria
              {(errorCount > 0 || warningCount > 0) && (
                <span className={cn(
                  "ml-1 inline-flex items-center justify-center rounded-full text-[9px] font-bold px-1.5 h-4 min-w-4",
                  errorCount > 0 ? "bg-error text-error-foreground" : "bg-warning text-warning-foreground",
                )}>
                  {errorCount + warningCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar..."
            className="h-8 pl-8 text-xs"
            data-testid="inspector-search"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "paredes" && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border">
              <tr className="text-left">
                <th className="p-2 font-medium">ID</th>
                <th className="p-2 font-medium">Classe</th>
                <th className="p-2 font-medium text-right">Comp.</th>
                <th className="p-2 font-medium">Origem</th>
              </tr>
            </thead>
            <tbody>
              {filteredWalls.length === 0 && (
                <tr><td colSpan={4} className="p-4 text-center text-muted-foreground text-xs">Nenhuma parede</td></tr>
              )}
              {filteredWalls.map(w => {
                const label = w.displayLabel || w.id;
                const cvMatch = w.sourceContribution?.enrichments?.some(e => e.view === "cv_match");
                const cvDisagree = w.sourceContribution?.enrichments?.some(e => e.view === "cv_disagreement");
                return (
                  <tr
                    key={w.id}
                    id={`inspector-wall-${w.id}`}
                    className={cn(
                      "border-b border-border hover:bg-accent/40 cursor-pointer transition-colors",
                      sync.classFor(w.id),
                    )}
                    onMouseEnter={() => sync.setHovered(w.id)}
                    onMouseLeave={() => sync.setHovered(null)}
                    onClick={() => sync.setSelected(w.id === sync.selectedId ? null : w.id)}
                    data-testid={`inspector-row-wall-${w.id}`}
                  >
                    <td className="p-2 font-mono font-semibold">{label}</td>
                    <td className="p-2">
                      <Badge variant="outline" className={cn("text-[10px] border", CLASSE_COLORS[w.classe])}>
                        {w.classe}
                      </Badge>
                    </td>
                    <td className="p-2 text-right font-mono tabular-nums">{(w.comprimento_m ?? 0).toFixed(2)}m</td>
                    <td className="p-2 text-[10px] text-muted-foreground">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span>{w.sourceContribution?.primary?.view || "—"}</span>
                        {cvMatch && <span className="text-success" title="CV confirma">✓ CV</span>}
                        {cvDisagree && <span className="text-warning" title="CV diverge">⚠ CV</span>}
                        {w.needs_review && (
                          <span className="text-warning" title={w.review_reason}>⚠ revisar</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {tab === "lajes" && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border">
              <tr className="text-left">
                <th className="p-2 font-medium">ID</th>
                <th className="p-2 font-medium">Classe</th>
                <th className="p-2 font-medium text-right">Área</th>
                <th className="p-2 font-medium">Pavimento</th>
              </tr>
            </thead>
            <tbody>
              {filteredSlabs.length === 0 && (
                <tr><td colSpan={4} className="p-4 text-center text-muted-foreground text-xs">Nenhuma laje</td></tr>
              )}
              {filteredSlabs.map(s => {
                const label = s.displayLabel || s.id;
                return (
                  <tr
                    key={s.id}
                    className="border-b border-border hover:bg-accent/40 transition-colors"
                    data-testid={`inspector-row-slab-${s.id}`}
                  >
                    <td className="p-2 font-mono font-semibold">{label}</td>
                    <td className="p-2">
                      <Badge variant="outline" className={cn("text-[10px] border", CLASSE_COLORS[s.classe])}>
                        {s.classe}
                      </Badge>
                    </td>
                    <td className="p-2 text-right font-mono tabular-nums">{(s.area_m2 ?? 0).toFixed(2)}m²</td>
                    <td className="p-2 text-muted-foreground">{s.nivel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {tab === "audit" && (
          <ul className="divide-y divide-border">
            {filteredNotes.length === 0 && (
              <li className="p-4 text-center text-muted-foreground text-xs">Nenhuma nota de auditoria</li>
            )}
            {filteredNotes.map((n, i) => {
              const Icon = n.severity === "error" ? AlertCircle : n.severity === "warning" ? AlertTriangle : Info;
              const tone =
                n.severity === "error" ? "text-error" :
                n.severity === "warning" ? "text-warning" :
                "text-info";
              return (
                <li
                  key={`${n.code}-${i}`}
                  className="px-3 py-2.5 hover:bg-accent/40 cursor-pointer"
                  onClick={() => {
                    if (n.relatedIds && n.relatedIds.length > 0) {
                      sync.setSelected(n.relatedIds[0]);
                    }
                  }}
                  data-testid={`audit-note-${n.code}`}
                >
                  <div className="flex items-start gap-2">
                    <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", tone)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{n.code}</div>
                      <p className="text-xs text-foreground/90">{n.message}</p>
                      {n.relatedIds && n.relatedIds.length > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate">
                          {n.relatedIds.slice(0, 5).join(", ")}{n.relatedIds.length > 5 ? ` +${n.relatedIds.length - 5}` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
