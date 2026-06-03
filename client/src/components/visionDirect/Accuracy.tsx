import { Target, CheckCircle2, AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtM2, type VisionDirectResult } from "./types";

export interface RealAreasInput {
  paredes_externas?: number | null;
  paredes_internas?: number | null;
  muros?: number | null;
  laje_piso?: number | null;
  laje_coberta?: number | null;
}

interface Props {
  totais: VisionDirectResult["totais"];
  realAreas: RealAreasInput;
}

interface CategoryRow {
  key: string;
  label: string;
  calc: number;
  real: number | null;
  deviation: number | null; // (calc-real)/real * 100
  accuracy: number | null; // 100 - |dev| capped 0..100
}

function computeAccuracy(calc: number, real: number | null): { deviation: number | null; accuracy: number | null } {
  if (real == null || real <= 0) return { deviation: null, accuracy: null };
  const dev = ((calc - real) / real) * 100;
  const acc = Math.max(0, (1 - Math.abs(calc - real) / real) * 100);
  return {
    deviation: Math.round(dev * 10) / 10,
    accuracy: Math.round(acc * 10) / 10,
  };
}

function accuracyColor(acc: number | null): string {
  if (acc == null) return "text-muted-foreground";
  if (acc >= 50) return "text-success";
  return "text-error";
}

function accuracyBadgeClass(acc: number | null): string {
  if (acc == null) return "border-muted-foreground/30 text-muted-foreground";
  if (acc >= 50) return "border-success/40 text-success bg-success/5";
  return "border-error/40 text-error bg-error/5";
}

export function VisionDirectAccuracy({ totais, realAreas }: Props) {
  const rows: CategoryRow[] = [
    {
      key: "ext",
      label: "Paredes externas (líquida)",
      calc: totais.paredes_externas_liquida_m2,
      real: realAreas.paredes_externas ?? null,
      ...computeAccuracy(totais.paredes_externas_liquida_m2, realAreas.paredes_externas ?? null),
    },
    {
      key: "int",
      label: "Paredes internas (líquida)",
      calc: totais.paredes_internas_liquida_m2,
      real: realAreas.paredes_internas ?? null,
      ...computeAccuracy(totais.paredes_internas_liquida_m2, realAreas.paredes_internas ?? null),
    },
    {
      key: "muros",
      label: "Muros",
      calc: totais.muros_m2,
      real: realAreas.muros ?? null,
      ...computeAccuracy(totais.muros_m2, realAreas.muros ?? null),
    },
    {
      key: "piso",
      label: "Laje de piso",
      calc: totais.laje_piso_m2,
      real: realAreas.laje_piso ?? null,
      ...computeAccuracy(totais.laje_piso_m2, realAreas.laje_piso ?? null),
    },
    {
      key: "coberta",
      label: "Laje de cobertura",
      calc: totais.laje_coberta_m2,
      real: realAreas.laje_coberta ?? null,
      ...computeAccuracy(totais.laje_coberta_m2, realAreas.laje_coberta ?? null),
    },
  ];

  // Acuracia geral ponderada por area real
  let weightedAccSum = 0;
  let totalRealWeight = 0;
  for (const r of rows) {
    if (r.accuracy != null && r.real != null && r.real > 0) {
      weightedAccSum += r.accuracy * r.real;
      totalRealWeight += r.real;
    }
  }
  const overallAccuracy = totalRealWeight > 0 ? Math.round((weightedAccSum / totalRealWeight) * 10) / 10 : null;
  const categoriesCompared = rows.filter((r) => r.accuracy != null).length;

  if (categoriesCompared === 0) {
    return (
      <Card className="p-4 border-warning/40 bg-warning/5">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-semibold mb-1">Projeto teste sem valores reais</p>
            <p className="text-muted-foreground">
              Preencha pelo menos um valor real (m²) na configuração para comparar com o extraído pela IA.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-3 border-b border-border flex items-center gap-2">
        <Target className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">Precisão da análise (modo teste)</h2>
        {overallAccuracy != null && (
          <Badge
            variant="outline"
            className={cn("text-xs font-bold", accuracyBadgeClass(overallAccuracy))}
            data-testid="overall-accuracy"
          >
            Acurácia geral: {overallAccuracy.toFixed(1)}%
          </Badge>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Categoria</TableHead>
            <TableHead className="text-right">Extraído (m²)</TableHead>
            <TableHead className="text-right">Real (m²)</TableHead>
            <TableHead className="text-right">Desvio</TableHead>
            <TableHead className="text-right">Precisão</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="font-medium text-sm">{r.label}</TableCell>
              <TableCell className="text-right tabular-nums font-mono">{fmtM2(r.calc)}</TableCell>
              <TableCell className="text-right tabular-nums font-mono">
                {r.real != null ? fmtM2(r.real) : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums font-mono">
                {r.deviation != null ? (
                  <span className={cn("inline-flex items-center gap-1", r.deviation > 0 ? "text-warning" : r.deviation < 0 ? "text-info" : "")}>
                    {r.deviation > 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : r.deviation < 0 ? (
                      <TrendingDown className="h-3 w-3" />
                    ) : null}
                    {r.deviation > 0 ? "+" : ""}{r.deviation.toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {r.accuracy != null ? (
                  <span className={cn("font-mono tabular-nums font-semibold inline-flex items-center gap-1", accuracyColor(r.accuracy))}>
                    {r.accuracy >= 50 && <CheckCircle2 className="h-3 w-3" />}
                    {r.accuracy.toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="p-3 border-t border-border text-[11px] text-muted-foreground bg-muted/20">
        <strong>Cálculo:</strong> Desvio = (Extraído − Real) ÷ Real × 100%. Precisão = max(0, 100 − |Desvio|).
        Acurácia geral é ponderada pela área real de cada categoria. Verde ≥ 50%, vermelho &lt; 50%.
      </div>
    </Card>
  );
}
