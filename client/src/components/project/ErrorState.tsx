import { AlertOctagon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  message?: string;
  hint?: string;
  onReprocess?: () => void;
  isReprocessing?: boolean;
}

export function ErrorState({ message, hint, onReprocess, isReprocessing }: ErrorStateProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px] p-6">
      <div className="max-w-lg w-full rounded-xl border-2 border-error/30 bg-error/5 p-6 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-error/10 mb-3">
          <AlertOctagon className="h-6 w-6 text-error" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Processamento falhou</h2>
        <p className="text-sm text-muted-foreground mb-4 break-words">
          {message ?? "Algo deu errado durante o processamento. Veja a aba detalhes técnicos no menu para mais informações."}
        </p>
        {hint && (
          <p className="text-xs text-muted-foreground mb-4 italic">
            Dica: {hint}
          </p>
        )}
        {onReprocess && (
          <Button
            type="button"
            onClick={onReprocess}
            disabled={isReprocessing}
            variant="default"
            className="gap-2"
            data-testid="error-reprocess"
          >
            <RefreshCw className={`h-4 w-4 ${isReprocessing ? "animate-spin" : ""}`} />
            Reprocessar projeto
          </Button>
        )}
      </div>
    </div>
  );
}
