import { useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, X, Eye, Settings2, Play, Loader2, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface DraftFile {
  id: number;
  originalName: string;
  fileType: string;
  fileSize?: number;
  pageType?: string | null;
}

export interface DraftScope {
  paredesExternas: boolean;
  paredesInternas: boolean;
  muros: boolean;
  lajePiso: boolean;
  lajeCoberta: boolean;
  cantos: boolean;
}

export interface ProductOption {
  id: string;
  label: string;
  panelType?: string;
}

interface DraftWorkspaceProps {
  files: DraftFile[];
  onUpload: (files: File[]) => Promise<void> | void;
  onDeleteFile: (fileId: number) => Promise<void> | void;
  onPreviewFile: (file: DraftFile) => void;
  // Configuração
  analysisMode: string;
  onAnalysisModeChange: (v: string) => void;
  peDireito: number;
  onPeDireitoChange: (v: number) => void;
  scope: DraftScope;
  onScopeChange: (next: DraftScope) => void;
  panelExt: string;
  panelInt: string;
  panelMuros: string;
  panelPiso: string;
  panelCoberta: string;
  onPanelChange: (kind: "ext" | "int" | "muros" | "piso" | "coberta", value: string) => void;
  productOptions: ProductOption[];
  // CTA
  onProcess: () => void;
  isProcessing: boolean;
  // Preview da planta crua (1ª imagem ou 1ª página do PDF)
  previewSrc?: string | null;
  previewMimeType?: string | null;
}

export function DraftWorkspace({
  files,
  onUpload,
  onDeleteFile,
  onPreviewFile,
  analysisMode,
  onAnalysisModeChange,
  peDireito,
  onPeDireitoChange,
  scope,
  onScopeChange,
  panelExt, panelInt, panelMuros, panelPiso, panelCoberta,
  onPanelChange,
  productOptions,
  onProcess,
  isProcessing,
  previewSrc,
  previewMimeType,
}: DraftWorkspaceProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "application/pdf": [".pdf"],
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
      "image/bmp": [".bmp"],
      "image/tiff": [".tif", ".tiff"],
      "application/octet-stream": [".ifc"],
    },
    noClick: true,
    noKeyboard: true,
    onDrop: (accepted) => onUpload(accepted),
  });

  const hasFiles = files.length > 0;
  const canProcess = hasFiles && !isProcessing;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4 h-full min-h-[600px]" data-testid="draft-workspace">
      {/* ESQUERDA: arquivos + preview */}
      <div className="space-y-3 min-w-0">
        <div
          {...getRootProps()}
          className={cn(
            "rounded-xl border-2 border-dashed transition-colors overflow-hidden flex flex-col bg-card",
            isDragActive ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <input {...getInputProps()} ref={fileInputRef} />
          {!hasFiles ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <Upload className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <h3 className="text-base font-semibold text-foreground">Solte plantas aqui ou clique para selecionar</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Formatos: PDF, PNG, JPG, WEBP, BMP, TIFF, IFC
              </p>
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4"
                variant="outline"
              >
                <Upload className="h-4 w-4 mr-2" />
                Selecionar arquivos
              </Button>
            </div>
          ) : (
            <>
              {/* Preview grande da planta crua (1º arquivo). Se for PDF, mostra um placeholder
                  - o user pode clicar pra abrir o viewer completo via onPreviewFile. */}
              <div className="relative bg-slate-50 dark:bg-slate-900 min-h-[300px] max-h-[500px] overflow-hidden flex items-center justify-center">
                {previewSrc ? (
                  previewMimeType?.startsWith("image/") ? (
                    <img
                      src={previewSrc}
                      alt="Preview da planta"
                      className="max-w-full max-h-[500px] object-contain"
                    />
                  ) : (
                    <div className="text-center text-muted-foreground p-6">
                      <FileText className="h-12 w-12 mx-auto mb-2 opacity-40" />
                      <div className="text-sm">PDF — clique no arquivo abaixo para visualizar</div>
                    </div>
                  )
                ) : (
                  <div className="text-center text-muted-foreground p-6">
                    <ImageIcon className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    <div className="text-sm">Preview indisponível</div>
                  </div>
                )}
              </div>
              {/* Lista de arquivos */}
              <div className="border-t border-border bg-card divide-y divide-border">
                {files.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 px-4 py-2 hover:bg-accent/30">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{f.originalName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {f.fileType}{f.fileSize ? ` · ${(f.fileSize / 1024).toFixed(0)} KB` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onPreviewFile(f)}
                      className="p-1.5 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
                      title="Visualizar"
                      data-testid={`preview-file-${f.id}`}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteFile(f.id)}
                      className="p-1.5 hover:bg-error/10 rounded text-muted-foreground hover:text-error"
                      title="Remover"
                      data-testid={`delete-file-${f.id}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <div className="p-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full text-xs text-muted-foreground hover:text-foreground py-1.5"
                  >
                    + Adicionar mais arquivos
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* DIREITA: configuração + CTA */}
      <Card className="p-4 space-y-4 self-start sticky top-4">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <Settings2 className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Configuração</h3>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Provider da extração
          </label>
          <Select value={analysisMode} onValueChange={onAnalysisModeChange}>
            <SelectTrigger data-testid="select-analysis-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gemini-only">Gemini (padrão)</SelectItem>
              <SelectItem value="openai-only">OpenAI</SelectItem>
              <SelectItem value="openai-vision-takeoff">OpenAI Vision Takeoff</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            A metodologia completa (envelope, cotas, topologia, esquadrias, CV↔LLM, self-check) roda em <strong>todos</strong> os modos.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Pé-direito (m)
          </label>
          <input
            type="number"
            value={peDireito}
            onChange={(e) => onPeDireitoChange(parseFloat(e.target.value) || 3.0)}
            min={2.0}
            max={6.0}
            step={0.1}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
            data-testid="input-pe-direito"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Escopo (elementos a calcular)
          </label>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <ScopeToggle label="Paredes externas" value={scope.paredesExternas} onChange={(v) => onScopeChange({ ...scope, paredesExternas: v })} />
            <ScopeToggle label="Paredes internas" value={scope.paredesInternas} onChange={(v) => onScopeChange({ ...scope, paredesInternas: v })} />
            <ScopeToggle label="Muros" value={scope.muros} onChange={(v) => onScopeChange({ ...scope, muros: v })} />
            <ScopeToggle label="Laje piso" value={scope.lajePiso} onChange={(v) => onScopeChange({ ...scope, lajePiso: v })} />
            <ScopeToggle label="Laje coberta" value={scope.lajeCoberta} onChange={(v) => onScopeChange({ ...scope, lajeCoberta: v })} />
            <ScopeToggle label="Cantos" value={scope.cantos} onChange={(v) => onScopeChange({ ...scope, cantos: v })} />
          </div>
        </div>

        <details className="rounded border border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium hover:bg-accent/30">
            Painéis (opcional — atribui SKU por categoria)
          </summary>
          <div className="p-3 space-y-2 border-t border-border">
            <PanelSelect label="Externas" value={panelExt} options={productOptions} onChange={(v) => onPanelChange("ext", v)} />
            <PanelSelect label="Internas" value={panelInt} options={productOptions} onChange={(v) => onPanelChange("int", v)} />
            <PanelSelect label="Muros" value={panelMuros} options={productOptions} onChange={(v) => onPanelChange("muros", v)} />
            <PanelSelect label="Piso" value={panelPiso} options={productOptions} onChange={(v) => onPanelChange("piso", v)} />
            <PanelSelect label="Coberta" value={panelCoberta} options={productOptions} onChange={(v) => onPanelChange("coberta", v)} />
          </div>
        </details>

        <Button
          type="button"
          onClick={onProcess}
          disabled={!canProcess}
          size="lg"
          className="w-full"
          data-testid="button-process-project"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processando…
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Processar Projeto
            </>
          )}
        </Button>
        {!hasFiles && (
          <p className="text-[11px] text-muted-foreground text-center">
            Adicione pelo menos 1 arquivo para processar.
          </p>
        )}
      </Card>
    </div>
  );
}

function ScopeToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-accent/30 cursor-pointer">
      <Checkbox checked={value} onCheckedChange={(v) => onChange(!!v)} className="h-3.5 w-3.5" />
      <span className="truncate">{label}</span>
    </label>
  );
}

function PanelSelect({ label, value, options, onChange }: { label: string; value: string; options: ProductOption[]; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-center gap-2">
      <label className="text-[11px] text-muted-foreground">{label}</label>
      <Select value={value || "auto"} onValueChange={(v) => onChange(v === "auto" ? "" : v)}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder="Auto" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Auto (padrão)</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
