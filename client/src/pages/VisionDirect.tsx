import { useEffect, useState, useRef } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useDropzone } from "react-dropzone";
import {
  Sparkles, ArrowLeft, Upload, Download, Trash2, Loader2,
  RefreshCw, Clock, CircleDollarSign, FileText, AlertOctagon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ParedeBreakdown {
  area_bruta_m2: number;
  area_aberturas_m2: number;
  area_liquida_m2: number;
}

interface PageResult {
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

interface VisionDirectResult {
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

function fmtM2(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSeconds(ms: number | undefined | null): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function fmtUsd(usd: number | undefined | null): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd < 0.01) return "< US$ 0.01";
  return `US$ ${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

export default function VisionDirect() {
  const [, params] = useRoute("/vision-direct/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [peDireito, setPeDireito] = useState<string>("3.0");
  const [analyzing, setAnalyzing] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string>("");
  const [result, setResult] = useState<VisionDirectResult | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Hidratar resultado salvo se houver :id
  useEffect(() => {
    const id = params?.id;
    if (!id) return;
    fetch(`/api/vision-direct/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setResult({ id: data.id, ...(data.results as VisionDirectResult) });
          setFileName(data.fileName);
        }
      })
      .catch(() => {/* noop */});
  }, [params?.id]);

  const submitFile = async (file: File) => {
    setAnalyzing(true);
    setResult(null);
    setFileName(file.name);
    setProgressMsg("Enviando arquivo...");

    // Simula mensagens de progresso enquanto espera (o backend é síncrono)
    const messages = [
      "Inspecionando arquivo...",
      "Dividindo páginas...",
      "Classificando páginas (planta/corte/fachada)...",
      "Detectando pé-direito (se houver corte)...",
      "Analisando planta — extraindo áreas em m²...",
      "Calculando aberturas e descontos...",
      "Agregando totais...",
    ];
    let idx = 0;
    progressTimerRef.current = setInterval(() => {
      if (idx < messages.length) {
        setProgressMsg(messages[idx]);
        idx++;
      }
    }, 6000);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("peDireito", peDireito);
      const res = await fetch("/api/vision-direct/analyze", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult(data);
      // Atualiza URL com o id para hidratação
      if (data.id) {
        window.history.replaceState({}, "", `/vision-direct/${data.id}`);
      }
      toast({ title: "Análise concluída", description: `Tempo: ${fmtSeconds(data.durationMs)} · Custo: ${fmtUsd(data.costUsd)}` });
    } catch (err: any) {
      toast({ title: "Erro na análise", description: err?.message || "Falha desconhecida", variant: "destructive" });
    } finally {
      setAnalyzing(false);
      setProgressMsg("");
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "application/pdf": [".pdf"],
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
      "image/bmp": [".bmp"],
      "image/tiff": [".tif", ".tiff"],
    },
    maxFiles: 1,
    disabled: analyzing,
    onDrop: (accepted) => {
      if (accepted.length > 0) submitFile(accepted[0]);
    },
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setResult(null);
    setFileName("");
    setLocation("/vision-direct");
  };

  const deleteRun = async () => {
    if (!result?.id) return reset();
    if (!confirm("Excluir esta análise? Não pode ser desfeito.")) return;
    try {
      await fetch(`/api/vision-direct/${result.id}`, { method: "DELETE" });
      toast({ title: "Análise excluída" });
      reset();
    } catch (err: any) {
      toast({ title: "Erro", description: err?.message || "Falha ao excluir", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col" data-testid="vision-direct-page">
      {/* Header próprio (não usa ProjectHeader) */}
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-20">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm" data-testid="vd-back">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Voltar
            </Button>
          </Link>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-base font-bold">Modo Visão Direta</h1>
            <Badge variant="outline" className="text-[10px] border-warning/40 text-warning bg-warning/10">
              EXPERIMENTAL
            </Badge>
          </div>
          {fileName && (
            <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              <span className="truncate max-w-[200px]" title={fileName}>{fileName}</span>
            </div>
          )}
        </div>
        <div className="container mx-auto px-4 pb-2">
          <p className="text-xs text-muted-foreground">
            Análise rápida em m² via Gemini — sem etapas técnicas, sem editor, sem orçamento. Resultado direto.
          </p>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 max-w-5xl">
        {/* Estado vazio: dropzone + pé-direito */}
        {!analyzing && !result && (
          <Card className="p-8">
            <div
              {...getRootProps()}
              className={cn(
                "rounded-xl border-2 border-dashed py-16 px-6 text-center cursor-pointer transition",
                isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
              )}
            >
              <input {...getInputProps()} ref={fileInputRef} />
              <Upload className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
              <h3 className="text-base font-semibold">Solte uma planta aqui ou clique para selecionar</h3>
              <p className="text-sm text-muted-foreground mt-1">
                PDF, PNG, JPG, WEBP, BMP, TIFF · até 50 MB
              </p>
              <Button
                type="button"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                variant="outline"
                className="mt-4"
                data-testid="vd-select-file"
              >
                <Upload className="h-4 w-4 mr-1.5" />
                Selecionar arquivo
              </Button>
            </div>

            <div className="mt-6 max-w-sm mx-auto">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Pé-direito padrão (m)
              </label>
              <input
                type="number"
                value={peDireito}
                onChange={(e) => setPeDireito(e.target.value)}
                min={2.0}
                max={6.0}
                step={0.1}
                className="w-full mt-1 px-3 py-2 rounded-md border border-border bg-background text-sm"
                data-testid="vd-pe-direito"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Será usado quando não houver corte na planta. Se houver corte, o Gemini extrai o pé-direito real.
              </p>
            </div>
          </Card>
        )}

        {/* Estado de processamento */}
        {analyzing && (
          <Card className="p-12 text-center">
            <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-4" />
            <h3 className="text-base font-semibold mb-1">Analisando planta…</h3>
            <p className="text-sm text-muted-foreground min-h-[1.25rem]">{progressMsg}</p>
            {fileName && (
              <p className="text-[11px] text-muted-foreground mt-3">
                Arquivo: <span className="font-mono">{fileName}</span> · Pé-direito padrão: {peDireito}m
              </p>
            )}
            <p className="text-[11px] text-muted-foreground mt-4">
              Latência típica: 30-60s para projetos residenciais. Não recarregue a página.
            </p>
          </Card>
        )}

        {/* Resultado */}
        {!analyzing && result && (
          <div className="space-y-4">
            {/* Sumário */}
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

            {/* Planta(s) anotada(s) — geradas exclusivamente pela IA */}
            {result.pages.some((p) => p.annotatedImage || p.originalImage) && (
              <Card>
                <div className="p-3 border-b border-border flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Planta anotada (gerada pela IA)</h2>
                  <Badge variant="outline" className="text-[10px] ml-auto">
                    gemini-2.5-flash-image
                  </Badge>
                </div>
                <div className="p-3 space-y-4">
                  {result.pages.map((p) => (
                    <div key={`img-${p.pageIndex}`} className="space-y-2">
                      {result.pages.length > 1 && (
                        <div className="text-xs font-mono text-muted-foreground">
                          Página {p.pageIndex} — {p.pavimento}
                        </div>
                      )}
                      {p.annotatedImage ? (
                        <div className="rounded-lg border border-border overflow-hidden bg-black/40">
                          <img
                            src={p.annotatedImage}
                            alt={`Planta anotada — pag ${p.pageIndex}`}
                            className="w-full h-auto max-h-[80vh] object-contain"
                            data-testid={`annotated-img-${p.pageIndex}`}
                          />
                        </div>
                      ) : p.originalImage ? (
                        <div className="rounded-lg border border-warning/30 overflow-hidden bg-black/40 relative">
                          <img
                            src={p.originalImage}
                            alt={`Planta original — pag ${p.pageIndex}`}
                            className="w-full h-auto max-h-[80vh] object-contain"
                          />
                          <div className="absolute top-2 left-2 bg-warning/90 text-warning-foreground text-[10px] uppercase tracking-wider px-2 py-1 rounded">
                            Anotação IA falhou — mostrando original
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Tabela consolidada */}
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
                      {fmtM2(result.totais.paredes_externas_liquida_m2)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      <span className="inline-block w-2 h-2 rounded-full bg-success mr-2" />
                      Paredes internas (líquida)
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-mono">
                      {fmtM2(result.totais.paredes_internas_liquida_m2)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">
                      <span className="inline-block w-2 h-2 rounded-full bg-primary mr-2" />
                      Muros
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-mono">
                      {fmtM2(result.totais.muros_m2)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Laje de piso</TableCell>
                    <TableCell className="text-right tabular-nums font-mono">
                      {fmtM2(result.totais.laje_piso_m2)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Laje de cobertura</TableCell>
                    <TableCell className="text-right tabular-nums font-mono">
                      {fmtM2(result.totais.laje_coberta_m2)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Card>

            {/* Breakdown por página */}
            {result.pages.length > 1 && (
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
                    {result.pages.map((p) => (
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
            )}

            {/* Observações */}
            {result.pages.some((p) => p.observacoes) && (
              <Card className="p-4">
                <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                  <AlertOctagon className="h-3.5 w-3.5 text-warning" />
                  Observações da IA
                </h2>
                <ul className="text-xs space-y-1.5">
                  {result.pages.filter((p) => p.observacoes).map((p) => (
                    <li key={p.pageIndex}>
                      <strong className="font-mono text-[10px] mr-1">Pag {p.pageIndex} ({p.pavimento}):</strong>
                      {p.observacoes}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* Ações */}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={reset} variant="outline" data-testid="vd-new">
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Nova análise
              </Button>
              {result.id && (
                <a
                  href={`/api/vision-direct/${result.id}/export/csv`}
                  download
                  className="inline-flex"
                  data-testid="vd-export"
                >
                  <Button variant="default">
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Baixar CSV
                  </Button>
                </a>
              )}
              {result.id && (
                <Button onClick={deleteRun} variant="destructive" data-testid="vd-delete">
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Excluir análise
                </Button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
