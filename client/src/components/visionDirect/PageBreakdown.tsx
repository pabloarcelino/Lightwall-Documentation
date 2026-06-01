import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtM2, type PageResult } from "./types";

interface Props {
  pages: PageResult[];
  /** Forca mostrar mesmo com 1 pagina (default: so se >1) */
  alwaysShow?: boolean;
}

export function VisionDirectPageBreakdown({ pages, alwaysShow }: Props) {
  if (pages.length <= 1 && !alwaysShow) return null;

  return (
    <Card>
      <div className="p-3 border-b border-border">
        <h2 className="text-sm font-semibold">Detalhamento por página</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pág</TableHead>
            <TableHead>Pavimento</TableHead>
            <TableHead className="text-right">Ext (m²)</TableHead>
            <TableHead className="text-right">Int (m²)</TableHead>
            <TableHead className="text-right">Muros (m²)</TableHead>
            <TableHead className="text-right">Piso (m²)</TableHead>
            <TableHead className="text-right">Coberta (m²)</TableHead>
            <TableHead className="text-right">Aberturas</TableHead>
            <TableHead>Conf.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pages.map((p) => (
            <TableRow key={p.pageIndex}>
              <TableCell className="font-mono text-xs">{p.pageIndex}</TableCell>
              <TableCell className="text-sm">{p.pavimento}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtM2(p.paredes_externas.area_liquida_m2)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtM2(p.paredes_internas.area_liquida_m2)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtM2(p.muros.area_bruta_m2)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtM2(p.laje_piso_m2)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtM2(p.laje_coberta_m2)}</TableCell>
              <TableCell className="text-right tabular-nums">{p.aberturas.length}</TableCell>
              <TableCell>
                <Badge variant="outline" className={cn(
                  "text-[10px]",
                  p.confidence === "high" && "border-success/40 text-success",
                  p.confidence === "medium" && "border-warning/40 text-warning",
                  p.confidence === "low" && "border-error/40 text-error",
                )}>
                  {p.confidence}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
