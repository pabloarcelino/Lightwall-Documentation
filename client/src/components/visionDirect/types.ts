/**
 * Tipos compartilhados pelos componentes do Vision Direct (sumario, tabela,
 * plantas anotadas, observacoes). Sao consumidos tanto pela pagina
 * /vision-direct quanto pelo ProjectDetails quando o projeto foi analisado
 * pelo motor enxuto.
 */

export interface ParedeBreakdown {
  area_bruta_m2: number;
  area_aberturas_m2: number;
  area_liquida_m2: number;
}

export interface PageResult {
  pageIndex: number;
  pavimento: string;
  paredes_externas: ParedeBreakdown;
  paredes_internas: ParedeBreakdown;
  muros: { area_bruta_m2: number; altura_assumida_m: number };
  laje_piso_m2: number;
  laje_coberta_m2: number;
  aberturas: Array<{ tipo: string; parede: string; largura_m: number; altura_m: number; area_m2: number }>;
  confidence: "high" | "medium" | "low";
  observacoes: string;
  originalImage?: string;
  annotatedImage?: string | null;
}

export interface VisionDirectResult {
  id?: number;
  peDireitoUsadoM: number;
  peDireitoFonte: "corte" | "default";
  pages: PageResult[];
  totais: {
    paredes_externas_liquida_m2: number;
    paredes_internas_liquida_m2: number;
    muros_m2: number;
    laje_piso_m2: number;
    laje_coberta_m2: number;
  };
  costUsd: number;
  durationMs: number;
  preflight: {
    fileType: string;
    pageCount: number;
    isPdfVector: boolean | null;
  };
}

export function fmtM2(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtSeconds(ms: number | undefined | null): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

export function fmtUsd(usd: number | undefined | null): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd < 0.01) return "< US$ 0.01";
  return `US$ ${usd.toFixed(usd < 1 ? 3 : 2)}`;
}
