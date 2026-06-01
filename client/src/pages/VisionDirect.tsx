import { useEffect, useState, useRef } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useDropzone } from "react-dropzone";
import {
  Sparkles, ArrowLeft, Upload, Download, Trash2, Loader2, RefreshCw, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { VisionDirectSummary } from "@/components/visionDirect/Summary";
import { VisionDirectAnnotatedImages } from "@/components/visionDirect/AnnotatedImages";
import { VisionDirectConsolidatedTable } from "@/components/visionDirect/ConsolidatedTable";
import { VisionDirectPageBreakdown } from "@/components/visionDirect/PageBreakdown";
import { VisionDirectNotes } from "@/components/visionDirect/Notes";
import { fmtSeconds, fmtUsd, type VisionDirectResult } from "@/components/visionDirect/types";

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

  // Hidratar resultado salvo se houver :id.
  // Se status="processing", entra em modo polling (mesmo que o usuario tenha
  // reaberto a aba ou recarregado a pagina enquanto a analise rodava).
  useEffect(() => {
    const id = params?.id;
    if (!id) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const POLL_INTERVAL_MS = 2500;

    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await fetch(`/api/vision-direct/${id}`);
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        if (data.fileName) setFileName(data.fileName);
        if (data.status === "completed") {
          setResult({ id: data.id, ...(data.results as VisionDirectResult) });
          setAnalyzing(false);
        } else if (data.status === "error") {
          setAnalyzing(false);
          toast({
            title: "Erro na analise",
            description: data.errorMessage || "Falha no servidor",
            variant: "destructive",
          });
        } else {
          // status === "processing" — segue polling
          setAnalyzing(true);
          setProgressMsg("Analise em andamento...");
          pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      } catch {
        /* noop — vai tentar denovo */
        if (!cancelled) pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.id]);

  const submitFile = async (file: File) => {
    setAnalyzing(true);
    setResult(null);
    setFileName(file.name);
    setProgressMsg("Enviando arquivo...");

    // Mensagens roladas durante o polling
    const messages = [
      "Inspecionando arquivo...",
      "Rasterizando paginas (se PDF)...",
      "Classificando paginas...",
      "Detectando pe-direito...",
      "Extraindo areas em m² + inventario de paredes (paralelo)...",
      "Renderizando plantas anotadas...",
      "Aguardando ultimas paginas...",
      "Quase la — agregando totais...",
    ];
    let idx = 0;
    progressTimerRef.current = setInterval(() => {
      if (idx < messages.length) {
        setProgressMsg(messages[idx]);
        idx++;
      }
    }, 8000);

    const stopProgress = () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("peDireito", peDireito);

      // 1) Inicia analise — devolve {id, status: "processing"} imediatamente
      const res = await fetch("/api/vision-direct/analyze", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const startData = await res.json();
      const runId = startData.id;
      if (!runId) throw new Error("Servidor nao devolveu id da analise");
      window.history.replaceState({}, "", `/vision-direct/${runId}`);

      // 2) Polling ate status="completed" ou "error"
      const POLL_INTERVAL_MS = 2500;
      const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutos absolutos
      const start = Date.now();
      let finalRun: any = null;
      while (Date.now() - start < MAX_WAIT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const pollRes = await fetch(`/api/vision-direct/${runId}`);
        if (!pollRes.ok) continue;
        const run = await pollRes.json();
        if (run.status === "completed") {
          finalRun = run;
          break;
        }
        if (run.status === "error") {
          throw new Error(run.errorMessage || "Erro durante analise no servidor");
        }
      }
      if (!finalRun) throw new Error("Tempo limite excedido (5 min)");

      // 3) Mostra resultado
      const results = finalRun.results as VisionDirectResult;
      setResult({ id: finalRun.id, ...results });
      toast({
        title: "Analise concluida",
        description: `Tempo: ${fmtSeconds(results.durationMs)} · Custo: ${fmtUsd(results.costUsd)}`,
      });
    } catch (err: any) {
      toast({
        title: "Erro na analise",
        description: err?.message || "Falha desconhecida",
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
      setProgressMsg("");
      stopProgress();
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
            <VisionDirectSummary result={result} />
            <VisionDirectAnnotatedImages pages={result.pages} />
            <VisionDirectConsolidatedTable totais={result.totais} />
            <VisionDirectPageBreakdown pages={result.pages} />
            <VisionDirectNotes pages={result.pages} />

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
