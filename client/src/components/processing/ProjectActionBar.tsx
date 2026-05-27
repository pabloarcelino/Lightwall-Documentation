import { Download, RefreshCw, Save, FileText, FileSpreadsheet, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProjectActionBarProps {
  hasPendingChanges?: boolean;
  isProcessing?: boolean;
  onSave?: () => void;
  onReprocess?: () => void;
  onRegenerateAnnotation?: () => void;
  onExport?: (format: "pdf" | "excel" | "json") => void;
}

export function ProjectActionBar({
  hasPendingChanges,
  isProcessing,
  onSave,
  onReprocess,
  onRegenerateAnnotation,
  onExport,
}: ProjectActionBarProps) {
  return (
    <div className="sticky bottom-0 z-10 bg-card/95 backdrop-blur border-t border-border">
      <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap">
        {hasPendingChanges && onSave && (
          <Button
            onClick={onSave}
            size="sm"
            className="gap-1.5"
            data-testid="action-save"
          >
            <Save className="h-4 w-4" /> Salvar mudanças
          </Button>
        )}

        {onExport && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onExport("pdf")} data-testid="action-export-pdf">
              <FileText className="h-4 w-4" /> PDF
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onExport("excel")} data-testid="action-export-excel">
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onExport("json")} data-testid="action-export-json">
              <Code2 className="h-4 w-4" /> JSON
            </Button>
          </div>
        )}

        <div className="flex-1" />

        {onRegenerateAnnotation && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onRegenerateAnnotation}
            disabled={isProcessing}
            data-testid="action-regenerate"
          >
            <Download className="h-4 w-4" /> Regenerar imagem
          </Button>
        )}

        {onReprocess && (
          <Button
            size="sm"
            variant={isProcessing ? "outline" : "default"}
            className="gap-1.5"
            onClick={onReprocess}
            disabled={isProcessing}
            data-testid="action-reprocess"
          >
            <RefreshCw className={isProcessing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {isProcessing ? "Processando..." : "Reprocessar"}
          </Button>
        )}
      </div>
    </div>
  );
}
