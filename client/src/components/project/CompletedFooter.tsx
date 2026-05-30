import { useState } from "react";
import { ChevronDown, ChevronUp, Download, RefreshCw, Receipt, Clock, CircleDollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BudgetCategory {
  label: string;
  area: number;
  cost: number;
}

interface CompletedFooterProps {
  totalCost: number;
  totalArea: number;
  totalPaneis?: number;
  categories: BudgetCategory[];
  discountPct?: number;
  freightCost?: number;
  biomassCost?: number;
  /** Tempo total do processamento em ms (do startedAt ao finishedAt). */
  elapsedMs?: number | null;
  /** Custo total das chamadas IA em USD. */
  aiCostUsd?: number | null;
  onExportXlsx?: () => void;
  onMoreOptions?: () => void;
  onReprocess?: () => void;
}

function formatElapsed(ms: number | null | undefined): string | null {
  if (ms == null || ms < 0) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function formatUsd(usd: number | null | undefined): string | null {
  if (usd == null || usd <= 0) return null;
  if (usd < 0.01) return "< US$ 0.01";
  return `US$ ${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

function num(n: number, digits = 2): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function CompletedFooter({
  totalCost,
  totalArea,
  totalPaneis,
  categories,
  discountPct = 0,
  freightCost = 0,
  biomassCost = 0,
  elapsedMs,
  aiCostUsd,
  onExportXlsx,
  onMoreOptions,
  onReprocess,
}: CompletedFooterProps) {
  const [expanded, setExpanded] = useState(false);

  const subtotalCategorias = categories.reduce((s, c) => s + c.cost, 0);
  const totalAreaCategorias = categories.reduce((s, c) => s + c.area, 0);
  const elapsedStr = formatElapsed(elapsedMs);
  const aiCostStr = formatUsd(aiCostUsd);

  return (
    <div className={cn(
      "border-t border-border bg-card/95 backdrop-blur transition-all overflow-hidden",
      expanded ? "max-h-[60vh]" : "max-h-20",
    )}>
      {/* Linha resumo — sempre visível */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-3 hover:bg-accent/30 rounded px-2 py-1 -mx-2 transition"
          data-testid="footer-toggle"
        >
          <Receipt className="h-5 w-5 text-primary" />
          <div className="text-left">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Orçamento total</div>
            <div className="text-xl font-bold text-foreground tabular-nums">{brl(totalCost)}</div>
          </div>
          <span className="text-xs text-muted-foreground ml-2">
            · {num(totalArea, 1)} m² {totalPaneis ? `· ${totalPaneis} painéis` : ""}
          </span>
          {expanded ? <ChevronDown className="h-4 w-4 ml-1" /> : <ChevronUp className="h-4 w-4 ml-1" />}
        </button>
        <div className="hidden md:flex items-center gap-2 ml-2 mr-auto">
          {elapsedStr && (
            <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground" title="Tempo de processamento">
              <Clock className="h-3 w-3" />
              {elapsedStr}
            </span>
          )}
          {aiCostStr && (
            <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground" title="Custo IA">
              <CircleDollarSign className="h-3 w-3 text-success" />
              {aiCostStr}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onReprocess && (
            <Button variant="outline" size="sm" onClick={onReprocess} data-testid="footer-reprocess">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Reprocessar
            </Button>
          )}
          {onExportXlsx && (
            <Button variant="default" size="sm" onClick={onExportXlsx} data-testid="footer-export-xlsx">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Exportar XLSX
            </Button>
          )}
          {onMoreOptions && (
            <Button variant="ghost" size="sm" onClick={onMoreOptions}>
              Outras opções
            </Button>
          )}
        </div>
      </div>

      {/* Detalhes expandidos */}
      {expanded && (
        <div className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 max-h-[50vh] overflow-y-auto">
          {/* Categorias */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Detalhamento por categoria
            </h4>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Categoria</th>
                    <th className="text-right px-3 py-2">Área (m²)</th>
                    <th className="text-right px-3 py-2">Custo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {categories.map((c, i) => (
                    <tr key={i} className="hover:bg-accent/20">
                      <td className="px-3 py-1.5">{c.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{num(c.area, 1)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{brl(c.cost)}</td>
                    </tr>
                  ))}
                  <tr className="bg-muted/30 font-semibold">
                    <td className="px-3 py-2">Subtotal categorias</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(totalAreaCategorias, 1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl(subtotalCategorias)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Ajustes */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Ajustes
            </h4>
            <div className="rounded-lg border border-border p-3 text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Desconto painéis</span>
                <span className="tabular-nums">{discountPct.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Frete</span>
                <span className="tabular-nums">{brl(freightCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Biomassa</span>
                <span className="tabular-nums">{brl(biomassCost)}</span>
              </div>
              <div className="border-t border-border pt-1.5 mt-1.5 flex justify-between font-semibold">
                <span>Total final</span>
                <span className="tabular-nums text-primary">{brl(totalCost)}</span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground px-1">
              Para editar ajustes (desconto, frete, biomassa), use a aba <strong>"Outras opções"</strong>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
