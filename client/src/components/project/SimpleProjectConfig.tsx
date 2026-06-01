import { useDropzone } from "react-dropzone";
import { Upload, FileText, X, Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

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

interface Props {
  files: SimpleProjectFile[];
  onUpload: (files: File[]) => Promise<void> | void;
  onDeleteFile: (fileId: number) => Promise<void> | void;
  peDireito: number;
  onPeDireitoChange: (v: number) => void;
  scope: SimpleScope;
  onScopeChange: (s: SimpleScope) => void;
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

export function SimpleProjectConfig(props: Props) {
  const { files, onUpload, onDeleteFile, peDireito, onPeDireitoChange, scope, onScopeChange, onProcess, isProcessing } = props;

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

        <div>
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
