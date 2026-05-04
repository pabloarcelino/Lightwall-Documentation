import type { ReactNode } from "react";
import { Loader2, AlertTriangle, Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface BaseStateProps {
  title?: string;
  message?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  testId?: string;
}

export function LoadingState({
  title = "Carregando",
  message = "Aguarde enquanto buscamos as informacoes...",
  className = "",
  testId = "state-loading",
}: BaseStateProps) {
  return (
    <Card className={className} data-testid={testId}>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <Loader2 className="h-10 w-10 mb-3 text-muted-foreground animate-spin" aria-hidden="true" />
        <p className="text-base font-medium" data-testid={`${testId}-title`}>{title}</p>
        {message && (
          <p className="text-sm text-muted-foreground mt-1" data-testid={`${testId}-message`}>
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ErrorState({
  title = "Nao foi possivel carregar",
  message = "Ocorreu um erro ao buscar os dados. Tente novamente.",
  icon,
  action,
  className = "",
  testId = "state-error",
}: BaseStateProps) {
  return (
    <Card className={className} data-testid={testId}>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        {icon ?? <AlertTriangle className="h-10 w-10 mb-3 text-destructive" aria-hidden="true" />}
        <p className="text-base font-medium" data-testid={`${testId}-title`}>{title}</p>
        {message && (
          <p className="text-sm text-muted-foreground mt-1 max-w-md" data-testid={`${testId}-message`}>
            {message}
          </p>
        )}
        {action && <div className="mt-4">{action}</div>}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  title = "Nada por aqui",
  message,
  icon,
  action,
  className = "",
  testId = "state-empty",
}: BaseStateProps) {
  return (
    <Card className={className} data-testid={testId}>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        {icon ?? <Inbox className="h-10 w-10 mb-3 text-muted-foreground" aria-hidden="true" />}
        <p className="text-base font-medium" data-testid={`${testId}-title`}>{title}</p>
        {message && (
          <p className="text-sm text-muted-foreground mt-1 max-w-md" data-testid={`${testId}-message`}>
            {message}
          </p>
        )}
        {action && <div className="mt-4">{action}</div>}
      </CardContent>
    </Card>
  );
}
