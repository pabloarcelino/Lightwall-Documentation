import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Conteudo posicionado a direita (botoes, badges, etc.) */
  actions?: ReactNode;
  /** Conteudo customizado abaixo do titulo (tabs, filtros, etc.) */
  children?: ReactNode;
  className?: string;
}

/**
 * Cabeçalho de página. Não é mais sticky — a topbar do AppShell cuida disso.
 * Use no topo da página para apresentar título + descrição + ações.
 */
export function PageHeader({ title, description, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cn("border-b border-border bg-background", className)}>
      <div className="container py-6 md:py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          {(title || description) && (
            <div className="min-w-0">
              {title && (
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground" data-testid="text-page-title">
                  {title}
                </h1>
              )}
              {description && (
                <p className="mt-1.5 text-sm md:text-base text-muted-foreground max-w-2xl">
                  {description}
                </p>
              )}
            </div>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </header>
  );
}
