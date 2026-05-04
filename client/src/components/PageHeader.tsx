import type { ReactNode } from "react";

interface PageHeaderProps {
  children: ReactNode;
}

export function PageHeader({ children }: PageHeaderProps) {
  return (
    <header className="glass-header border-b border-white/20 dark:border-white/5 sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4">{children}</div>
    </header>
  );
}
