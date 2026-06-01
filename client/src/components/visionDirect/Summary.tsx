import { Clock, CircleDollarSign, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { fmtM2, fmtSeconds, fmtUsd, type VisionDirectResult } from "./types";

interface Props {
  result: VisionDirectResult;
}

export function VisionDirectSummary({ result }: Props) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total parede</div>
          <div className="text-2xl font-bold tabular-nums">
            {fmtM2(
              result.totais.paredes_externas_liquida_m2 +
                result.totais.paredes_internas_liquida_m2 +
                result.totais.muros_m2,
            )} m²
          </div>
        </div>
        <div className="h-10 w-px bg-border" />
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total laje</div>
          <div className="text-2xl font-bold tabular-nums">
            {fmtM2(result.totais.laje_piso_m2 + result.totais.laje_coberta_m2)} m²
          </div>
        </div>
        <div className="h-10 w-px bg-border" />
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pé-direito</div>
          <div className="text-sm font-semibold">
            {result.peDireitoUsadoM.toFixed(2)}m
            <span className="text-[10px] text-muted-foreground ml-1">
              ({result.peDireitoFonte === "corte" ? "do corte" : "padrão"})
            </span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtSeconds(result.durationMs)}</span>
          <span className="flex items-center gap-1"><CircleDollarSign className="h-3 w-3 text-success" /> {fmtUsd(result.costUsd)}</span>
          <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> {result.preflight.pageCount} pag</span>
        </div>
      </div>
    </Card>
  );
}
