export function LightwallDots({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} fill="currentColor">
      <circle cx="8" cy="8" r="3.5" />
      <circle cx="20" cy="8" r="3.5" />
      <circle cx="32" cy="8" r="3.5" />
      <circle cx="8" cy="20" r="3.5" />
      <circle cx="20" cy="20" r="3.5" />
      <circle cx="32" cy="20" r="3.5" />
      <circle cx="8" cy="32" r="3.5" />
      <circle cx="20" cy="32" r="3.5" />
      <circle cx="32" cy="32" r="2" />
    </svg>
  );
}

export function LightwallBrand({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <LightwallDots className="h-6 w-6 lw-text-accent" />
        <span className="text-sm font-semibold tracking-tight lw-text-brand">Lightwall</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <LightwallDots className="h-9 w-9 lw-text-accent" />
      <div>
        <h1 className="text-2xl font-bold tracking-tight lw-text-brand" data-testid="text-page-title">
          Lightwall <span className="text-foreground">Orcamento Automatico</span>
        </h1>
        <p className="text-xs text-muted-foreground tracking-wide uppercase">
          Sistema Parametrico de Paineis v01
        </p>
      </div>
    </div>
  );
}
