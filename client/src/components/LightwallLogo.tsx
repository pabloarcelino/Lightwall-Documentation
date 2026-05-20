type DotsProps = { className?: string; accent?: boolean };

/**
 * LightwallDots — assinatura visual da marca em formato 3x3 modular.
 * Por padrao usa `currentColor` para herdar a cor do contexto (token --primary).
 * Quando `accent` esta ativo, o ponto central usa o token --secondary (anil),
 * conforme paleta do Manual de Marca.
 */
export function LightwallDots({ className = "h-8 w-8", accent = true }: DotsProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="8"  cy="8"  r="3.4" />
      <circle cx="20" cy="8"  r="3.4" />
      <circle cx="32" cy="8"  r="3.4" />
      <circle cx="8"  cy="20" r="3.4" />
      {accent ? (
        <circle cx="20" cy="20" r="3.4" fill="hsl(var(--secondary))" />
      ) : (
        <circle cx="20" cy="20" r="3.4" />
      )}
      <circle cx="32" cy="20" r="3.4" />
      <circle cx="8"  cy="32" r="3.4" />
      <circle cx="20" cy="32" r="3.4" />
      <circle cx="32" cy="32" r="3.4" />
    </svg>
  );
}

type BrandProps = {
  compact?: boolean;
  showTagline?: boolean;
  className?: string;
};

export function LightwallBrand({ compact = false, showTagline = true, className = "" }: BrandProps) {
  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <LightwallDots className="h-6 w-6 text-primary" />
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Lightwall
        </span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <LightwallDots className="h-9 w-9 text-primary" />
      <div className="leading-tight">
        <h1
          className="text-xl md:text-2xl font-bold tracking-tight text-foreground"
          data-testid="text-page-title"
        >
          Lightwall <span className="font-medium text-muted-foreground">Orcamento</span>
        </h1>
        {showTagline && (
          <p className="text-[11px] text-muted-foreground tracking-[0.18em] uppercase mt-0.5">
            Sistema parametrico de paineis
          </p>
        )}
      </div>
    </div>
  );
}
