import { Clock, CircleDollarSign, FileText, BadgeDollarSign, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtM2, fmtSeconds, fmtUsd, type VisionDirectResult } from "./types";

interface Props {
  result: VisionDirectResult;
  /** Custo do orçamento em R$ (vem do budget.totalCost). Opcional. */
  budgetTotalCost?: number | null;
}

function fmtBrl(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TIPOLOGIA_LABEL: Record<string, string> = {
  casa_terrea: "Casa térrea",
  sobrado: "Sobrado",
  edificio: "Edifício",
  comercial: "Comercial",
  misto: "Misto",
  outro: "—",
};

const PADRAO_LABEL: Record<string, string> = {
  popular: "popular",
  medio: "padrão médio",
  alto: "padrão alto",
};

export function VisionDirectSummary({ result, budgetTotalCost }: Props) {
  const heightEntries = Object.entries(result.pesDireitoPorPavimento ?? {}).filter(
    ([, v]) => Number.isFinite(v) && v > 0,
  );
  const showHeightMap = heightEntries.length > 1;
  const c = result.characterization;
  const programaResumo = c
    ? [
        c.programa.quartos > 0 && `${c.programa.quartos}Q`,
        c.programa.suites > 0 && `${c.programa.suites} suíte${c.programa.suites > 1 ? "s" : ""}`,
        c.programa.salas > 0 && `${c.programa.salas} sala${c.programa.salas > 1 ? "s" : ""}`,
        c.programa.banheiros > 0 && `${c.programa.banheiros} banh.`,
        c.programa.garagens > 0 && `${c.programa.garagens} gar.`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <Card className="p-4">
      {c && c.tipologia !== "outro" && (
        <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-border">
          <Badge variant="outline" className="text-xs gap-1.5">
            <Building2 className="h-3 w-3" />
            {TIPOLOGIA_LABEL[c.tipologia] ?? c.tipologia}
            {c.padrao && c.padrao !== "medio" ? ` · ${PADRAO_LABEL[c.padrao]}` : ""}
          </Badge>
          {programaResumo && (
            <span className="text-xs text-muted-foreground">{programaResumo}</span>
          )}
          {c.areaConstruidaEstimada_m2 > 0 && (
            <span className="text-xs text-muted-foreground">
              · ~{c.areaConstruidaEstimada_m2.toFixed(0)} m² constr.
            </span>
          )}
          {c.confidence === "low" && (
            <span className="text-[10px] text-muted-foreground italic">(baixa confiança)</span>
          )}
        </div>
      )}
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
          {showHeightMap && (
            <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
              {heightEntries.map(([k, v]) => `${k} ${v.toFixed(2)}m`).join(" · ")}
            </div>
          )}
        </div>
        {budgetTotalCost != null && budgetTotalCost > 0 && (
          <>
            <div className="h-10 w-px bg-border" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <BadgeDollarSign className="h-3 w-3" />
                Custo do orçamento
              </div>
              <div className="text-2xl font-bold tabular-nums">{fmtBrl(budgetTotalCost)}</div>
            </div>
          </>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1" title="Duração da análise">
            <Clock className="h-3 w-3" /> {fmtSeconds(result.durationMs)}
          </span>
          <span className="flex items-center gap-1" title="Custo das chamadas Gemini (IA)">
            <CircleDollarSign className="h-3 w-3 text-success" /> IA {fmtUsd(result.costUsd)}
          </span>
          <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> {result.preflight.pageCount} pag</span>
        </div>
      </div>
    </Card>
  );
}
