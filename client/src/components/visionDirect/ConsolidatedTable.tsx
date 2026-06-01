import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtM2, type VisionDirectResult } from "./types";

interface Props {
  totais: VisionDirectResult["totais"];
}

export function VisionDirectConsolidatedTable({ totais }: Props) {
  return (
    <Card>
      <div className="p-3 border-b border-border">
        <h2 className="text-sm font-semibold">Quantitativos consolidados</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Categoria</TableHead>
            <TableHead className="text-right">Área (m²)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">
              <span className="inline-block w-2 h-2 rounded-full bg-error mr-2" />
              Paredes externas (líquida)
            </TableCell>
            <TableCell className="text-right tabular-nums font-mono">
              {fmtM2(totais.paredes_externas_liquida_m2)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">
              <span className="inline-block w-2 h-2 rounded-full bg-success mr-2" />
              Paredes internas (líquida)
            </TableCell>
            <TableCell className="text-right tabular-nums font-mono">
              {fmtM2(totais.paredes_internas_liquida_m2)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">
              <span className="inline-block w-2 h-2 rounded-full bg-primary mr-2" />
              Muros
            </TableCell>
            <TableCell className="text-right tabular-nums font-mono">
              {fmtM2(totais.muros_m2)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Laje de piso</TableCell>
            <TableCell className="text-right tabular-nums font-mono">
              {fmtM2(totais.laje_piso_m2)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Laje de cobertura</TableCell>
            <TableCell className="text-right tabular-nums font-mono">
              {fmtM2(totais.laje_coberta_m2)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}
