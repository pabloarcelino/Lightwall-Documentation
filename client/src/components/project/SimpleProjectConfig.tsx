import { useDropzone } from "react-dropzone";
import { Upload, FileText, X, Play, Loader2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface SimpleScope {
  paredesExternas: boolean;
  paredesInternas: boolean;
  muros: boolean;
  lajePiso: boolean;
  lajeCoberta: boolean;
}

export interface SimpleProjectFile {
  id: number;
  originalName: string;
  fileType: string;
  fileSize?: number;
}

export interface PanelProduct {
  id: string;
  label: string;
  panelType?: string;
}

export interface ProductIds {
  ext: string;
  int: string;
  muros: string;
  piso: string;
  coberta: string;
}

const BUILDING_TYPES = ["residencial", "comercial", "industrial", "misto"] as const;
type BuildingType = (typeof BUILDING_TYPES)[number];

interface Props {
  files: SimpleProjectFile[];
  onUpload: (files: File[]) => Promise<void> | void;
  onDeleteFile: (fileId: number) => Promise<void> | void;
  onPreview?: (file: SimpleProjectFile) => void;
  peDireito: number;
  onPeDireitoChange: (v: number) => void;
  scope: SimpleScope;
  onScopeChange: (s: SimpleScope) => void;
  // SKU por categoria
  productIds: ProductIds;
  onProductIdChange: (kind: keyof ProductIds, value: string) => void;
  productOptions: PanelProduct[];
  // Tipo de edificacao
  buildingType: BuildingType;
  onBuildingTypeChange: (v: BuildingType) => void;
  onProcess: () => void;
  isProcessing: boolean;
}

const SCOPE_OPTIONS: Array<{ key: keyof SimpleScope; label: string }> = [
  { key: "paredesExternas", label: "Paredes externas" },
  { key: "paredesInternas", label: "Paredes internas" },
  { key: "muros", label: "Muros" },
  { key: "lajePiso", label: "Laje de piso" },
  { key: "lajeCoberta", label: "Laje de cobertura" },
];

const PANEL_LABELS: Record<keyof ProductIds, string> = {
  ext: "Painel — Paredes externas",
  int: "Painel — Paredes internas",
  muros: "Painel — Muros",
  piso: "Painel — Laje de piso",
  coberta: "Painel — Laje de cobertura",
};

export function SimpleProjectConfig(props: Props) {
  const {
    files, onUpload, onDeleteFile, onPreview,
    peDireito, onPeDireitoChange,
    scope, onScopeChange,
    productIds, onProductIdChange, productOptions,
    buildingType, onBuildingTypeChange,
    onProcess, isProcessing,
  } = props;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "application/pdf": [".pdf"],
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
      "image/bmp": [".bmp"],
      "image/tiff": [".tif", ".tiff"],
    },
    multiple: true,
    maxFiles: 20,
    disabled: isProcessing,
    onDrop: async (accepted) => {
      if (accepted.length > 0) await onUpload(accepted);
    },
  });

  const canProcess = files.length > 0 && !isProcessing;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Upload */}
      <Card className="p-6">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Arquivos da planta
        </h2>
        <div
          {...getRootProps()}
          className={`rounded-xl border-2 border-dashed py-10 px-6 text-center cursor-pointer transition ${
            isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
          } ${isProcessing ? "opacity-50 pointer-events-none" : ""}`}
        >
          <input {...getInputProps()} />
          <Upload className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm">Solte plantas aqui ou clique para selecionar</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            PDF, PNG, JPG, WEBP, BMP, TIFF · até 20 arquivos · 50 MB cada
          </p>
        </div>

        {files.length > 0 && (
          <ul className="mt-4 space-y-2">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-sm bg-card border border-border rounded-md px-3 py-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="truncate flex-1" title={f.originalName}>{f.originalName}</span>
                <span className="text-[10px] text-muted-foreground">{f.fileType}</span>
                {onPreview && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-primary transition"
                    onClick={() => onPreview(f)}
                    aria-label="Pré-visualizar"
                    title="Pré-visualizar"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-error transition"
                  onClick={() => onDeleteFile(f.id)}
                  disabled={isProcessing}
                  aria-label="Remover arquivo"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Configuração */}
      <Card className="p-6">
        <h2 className="text-sm font-semibold mb-3">Configuração</h2>

        {/* Tipo de edificacao */}
        <div className="space-y-1 mb-5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Tipo de edificação
          </label>
          <Select
            value={buildingType}
            onValueChange={(v) => onBuildingTypeChange(v as BuildingType)}
            disabled={isProcessing}
          >
            <SelectTrigger className="w-full mt-1" data-testid="building-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUILDING_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 mb-5">
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
            disabled={isProcessing}
            className="w-full mt-1 px-3 py-2 rounded-md border border-border bg-background text-sm"
            data-testid="pe-direito"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Será usado quando não houver corte na planta. Se houver corte, o Gemini extrai o pé-direito real.
          </p>
        </div>

        <div className="mb-5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-2">
            Elementos a calcular
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SCOPE_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-background cursor-pointer hover:border-primary/40 transition"
              >
                <Checkbox
                  checked={scope[opt.key]}
                  onCheckedChange={(v) => onScopeChange({ ...scope, [opt.key]: v === true })}
                  disabled={isProcessing}
                  data-testid={`scope-${opt.key}`}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* SKU por categoria */}
        {productOptions.length > 0 && (
          <details className="border-t border-border pt-4">
            <summary className="text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition">
              Painel por categoria (opcional)
            </summary>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(["ext", "int", "muros", "piso", "coberta"] as const).map((kind) => {
                // Para piso/coberta filtra paineis SP (mesma logica do DraftWorkspace antigo)
                const filtered = (kind === "piso" || kind === "coberta")
                  ? productOptions.filter((p) => p.panelType === "SP")
                  : productOptions.filter((p) => p.panelType !== "SP" || productOptions.length < 2);
                const options = filtered.length > 0 ? filtered : productOptions;
                return (
                  <div key={kind} className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      {PANEL_LABELS[kind]}
                    </label>
                    <Select
                      value={productIds[kind]}
                      onValueChange={(v) => onProductIdChange(kind, v)}
                      disabled={isProcessing}
                    >
                      <SelectTrigger className="w-full text-xs" data-testid={`panel-${kind}`}>
                        <SelectValue placeholder="(padrão)" />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((opt) => (
                          <SelectItem key={opt.id} value={opt.id} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </Card>

      {/* Ação */}
      <div className="flex justify-end">
        <Button
          onClick={onProcess}
          disabled={!canProcess}
          size="lg"
          data-testid="process-project"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processando...
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Processar projeto
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
