import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";

interface ThemeToggleProps {
  variant?: "floating" | "inline";
  className?: string;
}

export function ThemeToggle({ variant = "floating", className = "" }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Mudar para tema claro" : "Mudar para tema escuro";

  if (variant === "floating") {
    return (
      <Button
        variant="outline"
        size="icon"
        onClick={toggleTheme}
        aria-label={label}
        title={label}
        data-testid="button-theme-toggle"
        className={`fixed bottom-4 right-4 z-[60] h-10 w-10 rounded-full shadow-lg backdrop-blur bg-white/80 dark:bg-slate-900/80 border-white/40 dark:border-white/10 ${className}`}
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      data-testid="button-theme-toggle"
      className={className}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
