import { Layers } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtM2, type PageResult } from "./types";

interface Props {
  pages: PageResult[];
  /** Mapa pe-direito por pavimento (de A2). Quando presente, mostra
   *  o pe-direito especifico abaixo do rotulo do pavimento. */
  pesDireitoPorPavimento?: Record<string, number>;
}

/**
 * Quantitativos por pavimento — quebra cada pagina (planta_baixa) em uma
 * linha com seus m² por categoria + total parede e total laje. O footer
 * mostra os totais consolidados (mesmos numeros do ConsolidatedTable).
 *
 * Reaproveita os dados ja persistidos em vision_direct_summary.data.pages[];
 * nao faz fetch adicional.
 */
export function VisionDirectBudgetByPavimento({ pages, pesDireitoPorPavimento }: Props) {
  if (!pages || pages.length === 0) return null;

  const rows = pages.map((p) => {
    const ext = p.paredes_externas.area_liquida_m2;
    const int = p.paredes_internas.area_liquida_m2;
    const mur = p.muros.area_bruta_m2;
    const piso = p.laje_piso_m2;
    const cob = p.laje_coberta_m2;
    return {
      pageIndex: p.pageIndex,
      pavimento: p.pavimento || `Pavimento ${p.pageIndex}`,
      ext,
      int,
      mur,
      piso,
      cob,
      totalParede: ext + int + mur,
      totalLaje: piso + cob,
      peSpecific: pesDireitoPorPavimento?.[p.pavimento || ""],
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      ext: acc.ext + r.ext,
      int: acc.int + r.int,
      mur: acc.mur + r.mur,
      piso: acc.piso + r.piso,
      cob: acc.cob + r.cob,
      totalParede: acc.totalParede + r.totalParede,
      totalLaje: acc.totalLaje + r.totalLaje,
    }),
    { ext: 0, int: 0, mur: 0, piso: 0, cob: 0, totalParede: 0, totalLaje: 0 },
  );

  return (
    <Card>
      <div className="p-3 border-b border-border flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Quantitativos por pavimento</h2>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {rows.length} pavimento{rows.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pavimento</TableHead>
              <TableHead className="text-right">Par. ext.</TableHead>
              <TableHead className="text-right">Par. int.</TableHead>
              <TableHead className="text-right">Muros</TableHead>
              <TableHead className="text-right">Piso</TableHead>
              <TableHead className="text-right">Cobertura</TableHead>
              <TableHead className="text-right border-l border-border/60">Σ parede</TableHead>
              <TableHead className="text-right">Σ laje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.pageIndex} data-testid={`pavimento-row-${r.pageIndex}`}>
                <TableCell className="font-medium">
                  <div className="text-sm">{r.pavimento}</div>
                  <div className="text-[10px] text-muted-foreground">
                    pg {r.pageIndex}
                    {r.peSpecific != null && Number.isFinite(r.peSpecific) ? ` · pé ${r.peSpecific.toFixed(2)}m` : ""}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums font-mono text-xs">{fmtM2(r.ext)}</TableCell>
                <TableCell className="text-right tabular-nums font-mono text-xs">{fmtM2(r.int)}</TableCell>
                <TableCell className="text-right tabular-nums font-mono text-xs">{fmtM2(r.mur)}</TableCell>
                <TableCell className="text-right tabular-nums font-mono text-xs">{fmtM2(r.piso)}</TableCell>
                <TableCell className="text-right tabular-nums font-mono text-xs">{fmtM2(r.cob)}</TableCell>
                <TableCell className="text-right tabular-nums font-mono text-xs font-semibold border-l border-border/60">
                  {fmtM2(r.totalParede)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-mono text-xs font-semibold">
                  {fmtM2(r.totalLaje)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="bg-muted/30">
              <TableCell className="font-semibold text-xs uppercase tracking-wider">Total</TableCell>
              <TableCell className="text-right tabular-nums font-mono text-xs font-bold">{fmtM2(totals.ext)}</TableCell>
              <TableCell className="text-right tabular-nums font-mono text-xs font-bold">{fmtM2(totals.int)}</TableCell>
              <TableCell className="text-right tabular-nums font-mono text-xs font-bold">{fmtM2(totals.mur)}</TableCell>
              <TableCell className="text-right tabular-nums font-mono text-xs font-bold">{fmtM2(totals.piso)}</TableCell>
              <TableCell className="text-right tabular-nums font-mono text-xs font-bold">{fmtM2(totals.cob)}</TableCell>
              <TableCell className="text-right tabular-nums font-mono text-xs font-bold border-l border-border/60">
                {fmtM2(totals.totalParede)}
              </TableCell>
              <TableCell className="text-right tabular-nums font-mono text-xs font-bold">{fmtM2(totals.totalLaje)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <div className="p-2 text-[10px] text-muted-foreground bg-muted/10 border-t border-border">
        Valores em m². Σ parede = ext. + int. + muros. Σ laje = piso + cobertura.
      </div>
    </Card>
  );
}
