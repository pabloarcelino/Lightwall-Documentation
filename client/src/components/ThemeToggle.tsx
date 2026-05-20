import { Moon, Sun, Monitor, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, type ThemePref } from "@/hooks/use-theme";

interface ThemeToggleProps {
  /**
   * variant="inline" usa apenas o botao com icone — ideal para topbar.
   * variant="floating" mantem compatibilidade (botao no canto), nao recomendado.
   */
  variant?: "inline" | "floating";
  className?: string;
}

const OPTIONS: Array<{ value: ThemePref; label: string; Icon: typeof Sun }> = [
  { value: "light",  label: "Claro",     Icon: Sun },
  { value: "dark",   label: "Escuro",    Icon: Moon },
  { value: "system", label: "Sistema",   Icon: Monitor },
];

export function ThemeToggle({ variant = "inline", className = "" }: ThemeToggleProps) {
  const { preference, theme, setPreference } = useTheme();

  const ActiveIcon = preference === "system" ? Monitor : theme === "dark" ? Moon : Sun;
  const baseTrigger =
    variant === "floating"
      ? "fixed bottom-4 right-4 z-[60] h-10 w-10 rounded-full shadow-lg"
      : "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant === "floating" ? "outline" : "ghost"}
          size="icon"
          aria-label="Alternar tema"
          title="Alternar tema"
          data-testid="button-theme-toggle"
          className={`${baseTrigger} ${className}`}
        >
          <ActiveIcon className="h-[1.1rem] w-[1.1rem]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Aparência</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = preference === value;
          return (
            <DropdownMenuItem
              key={value}
              onClick={() => setPreference(value)}
              data-testid={`theme-option-${value}`}
              className="flex items-center justify-between gap-2 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {label}
              </span>
              {active && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
