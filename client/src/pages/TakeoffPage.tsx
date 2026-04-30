import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ArrowLeft, FileImage, Wand2, Download, AlertTriangle, FileText, FileJson, FileSpreadsheet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import TakeoffEditor from "@/components/takeoff/TakeoffEditor";

const PAGE_LABELS = [
  { value: "planta_baixa", label: "Planta baixa" },
  { value: "cobertura", label: "Cobertura" },
  { value: "situacao", label: "Situação" },
  { value: "corte", label: "Corte" },
  { value: "fachada", label: "Fachada" },
  { value: "outro", label: "Outro" },
];

const PAVIMENTO_OPTS = [
  { value: "1_pavimento", label: "1º Pavimento" },
  { value: "subsolo", label: "Subsolo" },
  { value: "caixa_dagua", label: "Caixa d'água" },
  { value: "situacao", label: "Situação" },
  { value: "cobertura", label: "Cobertura" },
  { value: "outro", label: "Outro" },
];

export default function TakeoffPage() {
  const params = useParams<{ id: string }>();
  const projectId = parseInt(params.id);
  const { toast } = useToast();

  const [activePageId, setActivePageId] = useState<number | null>(null);
  const [renderingPdf, setRenderingPdf] = useState(false);
  const [renderProgress, setRenderProgress] = useState({ done: 0, total: 0 });
  const [analyzingPages, setAnalyzingPages] = useState(false);
  const [defaultHeights, setDefaultHeights] = useState({ parede_externa: 3.0, parede_interna: 2.7, muro: 2.2 });

  // Project + files
  const { data: project } = useQuery<any>({ queryKey: ["/api/projects", projectId] });

  // Takeoff state
  const { data: takeoff, refetch: refetchTakeoff } = useQuery<any>({
    queryKey: [`/api/projects/${projectId}/takeoff`],
    enabled: !!projectId,
  });

  const pages: any[] = takeoff?.pages ?? [];
  const segments: any[] = takeoff?.segments ?? [];
  const slabs: any[] = takeoff?.slabs ?? [];
  const totals = takeoff?.totals ?? {};

  const activePage = useMemo(() => pages.find((p) => p.id === activePageId) ?? pages[0], [pages, activePageId]);

  const pdfFile = useMemo(
    () => (project?.files ?? []).find((f: any) => f.fileType === "pdf" || /\.pdf$/i.test(f.originalName ?? "")),
    [project],
  );
  const imgFile = useMemo(
    () => (project?.files ?? []).find((f: any) => f.fileType === "image" || /\.(png|jpe?g|webp)$/i.test(f.originalName ?? "")),
    [project],
  );

  // ---- Render PDF -> upload pages ----
  const uploadPagesMut = useMutation({
    mutationFn: async (body: any) => apiRequest("POST", `/api/projects/${projectId}/takeoff/pages`, body).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Páginas registradas" });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff`] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  async function renderAndUpload() {
    if (!pdfFile && !imgFile) {
      toast({ title: "Sem arquivos para processar", variant: "destructive" });
      return;
    }
    setRenderingPdf(true);
    try {
      const renderedPages: any[] = [];
      if (pdfFile) {
        const pdfjsLib = await import("pdfjs-dist");
        const workerModule = await import("pdfjs-dist/build/pdf.worker.mjs?url");
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;
        const url = `/api/files/${pdfFile.id}/content`;
        const pdf = await pdfjsLib.getDocument({ url, isEvalSupported: false }).promise;
        setRenderProgress({ done: 0, total: pdf.numPages });
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvas, canvasContext: ctx, viewport } as any).promise;
          const dataUrl = canvas.toDataURL("image/png");
          renderedPages.push({
            fileId: pdfFile.id,
            pageNumber: pageNum,
            imageData: dataUrl,
            widthPx: canvas.width,
            heightPx: canvas.height,
            pageLabel: pageNum === 1 ? "planta_baixa" : null,
          });
          setRenderProgress({ done: pageNum, total: pdf.numPages });
        }
      } else if (imgFile) {
        const url = `/api/files/${imgFile.id}/content`;
        const blob = await fetch(url, { credentials: "include" }).then((r) => r.blob());
        const dataUrl: string = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as string);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
        const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
          im.onerror = reject;
          im.src = dataUrl;
        });
        renderedPages.push({
          fileId: imgFile.id,
          pageNumber: 1,
          imageData: dataUrl,
          widthPx: dims.w,
          heightPx: dims.h,
          pageLabel: "planta_baixa",
        });
      }
      await uploadPagesMut.mutateAsync({ pages: renderedPages, replaceExisting: true });
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro ao renderizar PDF", description: err?.message, variant: "destructive" });
    } finally {
      setRenderingPdf(false);
      setRenderProgress({ done: 0, total: 0 });
    }
  }

  // ---- Mutations ----
  const updatePageMut = useMutation({
    mutationFn: async ({ pageId, data }: any) => apiRequest("PATCH", `/api/projects/${projectId}/takeoff/pages/${pageId}`, data).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff`] }),
  });

  const analyzeMut = useMutation({
    mutationFn: async (body: any) => apiRequest("POST", `/api/projects/${projectId}/takeoff/analyze`, body).then((r) => r.json()),
    onSuccess: (res: any) => {
      toast({ title: "Análise concluída", description: `${res.totalSegments ?? 0} segmentos / ${res.totalSlabs ?? 0} lajes` });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff`] });
      if (res?.errors?.length) {
        toast({ title: "Algumas páginas falharam", description: res.errors.map((e: any) => `Pag. ${e.pageNumber}: ${e.error}`).join("\n"), variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Erro na análise", description: e.message, variant: "destructive" }),
    onSettled: () => setAnalyzingPages(false),
  });

  function runAnalyze() {
    const selected = pages.filter((p) => p.selectedForAnalysis);
    if (selected.length === 0) {
      toast({ title: "Selecione pelo menos 1 página", variant: "destructive" });
      return;
    }
    setAnalyzingPages(true);
    analyzeMut.mutate({ defaultHeights });
  }

  async function downloadExport(type: "excel" | "pdf" | "json") {
    try {
      const res = await fetch(`/api/projects/${projectId}/takeoff/export?type=${type}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Erro ${res.status}`);
      }
      if (type === "json") {
        const data = await res.json();
        downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `${project?.project?.name || "takeoff"}.json`);
      } else {
        const blob = await res.blob();
        const filename = type === "excel" ? `${project?.project?.name || "takeoff"}.xlsx` : `${project?.project?.name || "takeoff"}.pdf`;
        downloadBlob(blob, filename);
      }
      toast({ title: "Exportação concluída" });
    } catch (e: any) {
      toast({ title: "Erro ao exportar", description: e.message, variant: "destructive" });
    }
  }

  async function downloadPng() {
    if (!activePage) return;
    const svg = document.querySelector('[data-testid="svg-takeoff-canvas"]') as SVGSVGElement | null;
    const imgRes = await fetch(`/api/projects/${projectId}/takeoff/pages/${activePage.id}/image`, { credentials: "include" });
    if (!imgRes.ok) {
      toast({ title: "Erro ao carregar imagem", variant: "destructive" });
      return;
    }
    const imgPayload = await imgRes.json();
    const imgData: string = imgPayload.imageData;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imgData.startsWith("data:") ? imgData : `data:image/png;base64,${imgData}`;
    await new Promise((r) => { img.onload = r; });
    const canvas = document.createElement("canvas");
    canvas.width = activePage.widthPx;
    canvas.height = activePage.heightPx;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (svg) {
      // Serialize SVG with explicit width/height so it rasterizes at full resolution
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("width", String(canvas.width));
      clone.setAttribute("height", String(canvas.height));
      const svgStr = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([svgStr], { type: "image/svg+xml" });
      const url = URL.createObjectURL(svgBlob);
      const svgImg = new Image();
      svgImg.src = url;
      await new Promise((r) => { svgImg.onload = r; });
      ctx.drawImage(svgImg, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
    }
    const dataUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `takeoff-pag${activePage.pageNumber}.png`;
    a.click();
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- UI ----
  const totalElements = (segments?.length ?? 0) + (slabs?.length ?? 0);
  const reviewedCount = (segments?.filter((s) => s.reviewed).length ?? 0) + (slabs?.filter((s) => s.reviewed).length ?? 0);
  const needsReviewCount = (segments?.filter((s) => s.needsReview && !s.reviewed).length ?? 0) + (slabs?.filter((s) => s.needsReview && !s.reviewed).length ?? 0);

  const calibratedSelected = pages.filter((p) => p.selectedForAnalysis && p.pxPerMeter && p.pxPerMeter > 0).length;
  const selectedCount = pages.filter((p) => p.selectedForAnalysis).length;
  const allSelectedCalibrated = selectedCount > 0 && calibratedSelected === selectedCount;

  return (
    <div className="container mx-auto p-4 max-w-[1600px]">
      <div className="flex items-center gap-3 mb-3">
        <Link href={`/project/${projectId}`}>
          <Button variant="ghost" size="sm" data-testid="link-back-project"><ArrowLeft className="w-4 h-4 mr-1" /> Voltar ao projeto</Button>
        </Link>
        <h1 className="text-2xl font-bold flex-1">OpenAI Vision Takeoff — {project?.project?.name ?? "..."}</h1>
        <Badge variant="secondary">{pages.length} págs</Badge>
        <Badge variant="secondary">{segments.length} segm.</Badge>
        <Badge variant="secondary">{slabs.length} lajes</Badge>
      </div>

      <Alert className="mb-3" variant="default">
        <AlertTriangle className="w-4 h-4" />
        <AlertDescription>
          <strong>Quantitativo assistido por IA.</strong> Revise antes de usar em orçamento executivo.
          {needsReviewCount > 0 && <span className="ml-2 text-orange-600 font-medium">{needsReviewCount} item(ns) marcado(s) como "revisar".</span>}
          {totalElements > 0 && <span className="ml-2 text-muted-foreground">Revisados: {reviewedCount}/{totalElements}</span>}
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="pages" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="pages" data-testid="tab-pages"><FileImage className="w-4 h-4 mr-1" /> 1. Páginas</TabsTrigger>
          <TabsTrigger value="analyze" data-testid="tab-analyze" disabled={pages.length === 0}><Wand2 className="w-4 h-4 mr-1" /> 2. Analisar</TabsTrigger>
          <TabsTrigger value="review" data-testid="tab-review" disabled={pages.length === 0}><FileText className="w-4 h-4 mr-1" /> 3. Revisar</TabsTrigger>
          <TabsTrigger value="export" data-testid="tab-export" disabled={totalElements === 0}><Download className="w-4 h-4 mr-1" /> 4. Exportar</TabsTrigger>
        </TabsList>

        {/* ============ PAGES ============ */}
        <TabsContent value="pages" className="space-y-3">
          <Card className="p-4">
            <h3 className="text-lg font-semibold mb-2">Renderizar páginas</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Convertemos cada página do PDF em PNG (2x). Em seguida você seleciona quais analisar e calibra a escala.
            </p>
            <div className="flex gap-2 items-center">
              <Button onClick={renderAndUpload} disabled={renderingPdf || (!pdfFile && !imgFile)} data-testid="button-render-pdf">
                {renderingPdf ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileImage className="w-4 h-4 mr-2" />}
                {renderingPdf ? `Renderizando ${renderProgress.done}/${renderProgress.total}` : pages.length > 0 ? "Re-renderizar" : "Renderizar PDF"}
              </Button>
              {!pdfFile && !imgFile && <span className="text-xs text-destructive">Nenhum PDF/imagem encontrado neste projeto.</span>}
            </div>
          </Card>

          {pages.length > 0 && (
            <Card className="p-4">
              <h3 className="text-lg font-semibold mb-3">Selecione as páginas para analisar</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {pages.map((p) => (
                  <PageCard key={p.id} page={p} onUpdate={(data) => updatePageMut.mutate({ pageId: p.id, data })} />
                ))}
              </div>
            </Card>
          )}
        </TabsContent>

        {/* ============ ANALYZE ============ */}
        <TabsContent value="analyze" className="space-y-3">
          <Card className="p-4">
            <h3 className="text-lg font-semibold mb-2">Calibrar escala (recomendado antes de analisar)</h3>
            <p className="text-sm text-muted-foreground mb-3">
              A calibração permite recalcular comprimentos e áreas com precisão geométrica. Para cada página selecionada, abra-a na aba "Revisar", use a ferramenta "Calibrar" e clique em 2 pontos cuja distância real você conhece (ex.: cota explícita).
            </p>
            <div className="text-sm">
              Páginas selecionadas: <strong>{selectedCount}</strong> | Calibradas: <strong>{calibratedSelected}</strong>
              {!allSelectedCalibrated && selectedCount > 0 && (
                <span className="ml-2 text-orange-600">— faltam {selectedCount - calibratedSelected} página(s).</span>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="text-lg font-semibold mb-2">Alturas padrão por categoria</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Parede externa (m)</Label>
                <Input type="number" step="0.1" value={defaultHeights.parede_externa} onChange={(e) => setDefaultHeights((s) => ({ ...s, parede_externa: parseFloat(e.target.value) || 0 }))} className="h-8" />
              </div>
              <div>
                <Label className="text-xs">Parede interna (m)</Label>
                <Input type="number" step="0.1" value={defaultHeights.parede_interna} onChange={(e) => setDefaultHeights((s) => ({ ...s, parede_interna: parseFloat(e.target.value) || 0 }))} className="h-8" />
              </div>
              <div>
                <Label className="text-xs">Muro (m)</Label>
                <Input type="number" step="0.1" value={defaultHeights.muro} onChange={(e) => setDefaultHeights((s) => ({ ...s, muro: parseFloat(e.target.value) || 0 }))} className="h-8" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Usadas quando a IA não detecta altura na planta.</p>
          </Card>

          <Card className="p-4">
            <h3 className="text-lg font-semibold mb-2">Rodar análise OpenAI Vision</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Cada página selecionada é enviada à OpenAI com schema estrito de saída. Os resultados são geometricamente recalculados pela escala calibrada e salvos para revisão.
            </p>
            <Button onClick={runAnalyze} disabled={analyzingPages || selectedCount === 0} data-testid="button-analyze">
              {analyzingPages ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
              {analyzingPages ? "Analisando..." : `Analisar ${selectedCount} página(s)`}
            </Button>
          </Card>

          {takeoff?.aiRuns?.length > 0 && (
            <Card className="p-4">
              <h3 className="text-lg font-semibold mb-2">Histórico de execuções IA</h3>
              <div className="space-y-1 text-xs max-h-60 overflow-auto">
                {takeoff.aiRuns.map((r: any) => (
                  <div key={r.id} className="flex gap-2 items-center border-b pb-1">
                    <Badge variant={r.status === "ok" ? "secondary" : "destructive"}>{r.status}</Badge>
                    <span className="font-mono">{r.model}</span>
                    <span className="text-muted-foreground">{r.inputSummary}</span>
                    <span className="ml-auto">{r.durationMs}ms</span>
                    {r.errorMessage && <span className="text-destructive truncate max-w-md" title={r.errorMessage}>{r.errorMessage}</span>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </TabsContent>

        {/* ============ REVIEW ============ */}
        <TabsContent value="review" className="space-y-3">
          <Card className="p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Label className="text-sm">Página:</Label>
              <Select value={String(activePage?.id ?? "")} onValueChange={(v) => setActivePageId(parseInt(v))}>
                <SelectTrigger className="h-8 w-72" data-testid="select-active-page"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {pages.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      Pag {p.pageNumber} • {p.pageLabel || "—"} {p.pxPerMeter ? `• ${p.pxPerMeter.toFixed(1)} px/m` : "• não calibrada"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="ml-auto flex gap-2">
                {Object.entries(totals).map(([cat, t]: any) => (
                  <Badge key={cat} variant="outline">{cat}: {t.count} • {t.m2?.toFixed(1)}m²</Badge>
                ))}
              </div>
            </div>
          </Card>

          {activePage ? (
            <TakeoffEditor
              projectId={projectId}
              page={activePage}
              segments={segments}
              slabs={slabs}
              defaultHeight={
                defaultHeights.parede_externa // editor uses heightM passed at draw-time
              }
              onChanged={() => refetchTakeoff()}
            />
          ) : (
            <Card className="p-6 text-center text-muted-foreground">Renderize as páginas primeiro.</Card>
          )}
        </TabsContent>

        {/* ============ EXPORT ============ */}
        <TabsContent value="export" className="space-y-3">
          <Card className="p-4">
            <h3 className="text-lg font-semibold mb-2">Resumo</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {Object.entries(totals).map(([cat, t]: any) => (
                <div key={cat} className="border rounded p-3">
                  <div className="text-xs text-muted-foreground">{cat.replace("_", " ")}</div>
                  <div className="text-lg font-semibold">{t.count}</div>
                  <div className="text-sm">{t.m2?.toFixed(2)} m²</div>
                </div>
              ))}
            </div>
          </Card>

          {!allSelectedCalibrated && (
            <Alert variant="destructive">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>
                Algumas páginas selecionadas não estão calibradas. Excel/PDF serão bloqueados — calibre antes de exportar.
              </AlertDescription>
            </Alert>
          )}

          <Card className="p-4">
            <h3 className="text-lg font-semibold mb-2">Exportar</h3>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => downloadExport("excel")} data-testid="button-export-excel"><FileSpreadsheet className="w-4 h-4 mr-2" /> Excel</Button>
              <Button onClick={() => downloadExport("pdf")} variant="secondary" data-testid="button-export-pdf"><FileText className="w-4 h-4 mr-2" /> PDF</Button>
              <Button onClick={downloadPng} variant="secondary" data-testid="button-export-png" disabled={!activePage}><FileImage className="w-4 h-4 mr-2" /> PNG da página atual</Button>
              <Button onClick={() => downloadExport("json")} variant="outline" data-testid="button-export-json"><FileJson className="w-4 h-4 mr-2" /> JSON</Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PageCard({ page, onUpdate }: { page: any; onUpdate: (data: any) => void }) {
  const projectId = page.projectId;
  const { data: imgData } = useQuery<{ imageData: string } | null>({
    queryKey: [`/api/projects/${projectId}/takeoff/pages/${page.id}/image`],
    enabled: !!page.id,
    staleTime: 5 * 60 * 1000,
  });
  const raw = imgData?.imageData;
  const imgSrc = raw ? (raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`) : "";
  return (
    <Card className="p-3 space-y-2">
      <div className="aspect-[4/3] bg-muted/30 border rounded overflow-hidden">
        <img src={imgSrc} alt={`Pag ${page.pageNumber}`} className="w-full h-full object-contain" />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={!!page.selectedForAnalysis}
          onCheckedChange={(v) => onUpdate({ selectedForAnalysis: !!v })}
          data-testid={`check-select-page-${page.pageNumber}`}
        />
        <span className="text-sm font-medium">Página {page.pageNumber}</span>
        {page.pxPerMeter ? (
          <Badge variant="secondary" className="ml-auto text-[10px]">cal {page.pxPerMeter.toFixed(0)} px/m</Badge>
        ) : (
          <Badge variant="outline" className="ml-auto text-[10px]">não calibrada</Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={page.pageLabel ?? ""} onValueChange={(v) => onUpdate({ pageLabel: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>{PAGE_LABELS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={page.pavimento ?? ""} onValueChange={(v) => onUpdate({ pavimento: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pavimento" /></SelectTrigger>
          <SelectContent>{PAVIMENTO_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </Card>
  );
}
