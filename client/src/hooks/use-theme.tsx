import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

interface ThemeContextValue {
  /** Preferencia escolhida pelo usuario (pode ser "system") */
  preference: ThemePref;
  /** Tema efetivamente aplicado (resolvido a partir do system quando preferencia=system) */
  theme: Theme;
  setPreference: (p: ThemePref) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const STORAGE_KEY = "lw-theme";

function readSystem(): Theme {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function readInitialPreference(): ThemePref {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage indisponivel — cai para system
  }
  return "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePref>(() => readInitialPreference());
  const [systemTheme, setSystemTheme] = useState<Theme>(() => readSystem());

  // Escuta mudancas do sistema operacional
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  const theme: Theme = preference === "system" ? systemTheme : preference;

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    root.style.colorScheme = theme;
    try { window.localStorage.setItem(STORAGE_KEY, preference); } catch { /* ignore */ }
  }, [theme, preference]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      theme,
      setPreference: setPreferenceState,
      toggleTheme: () => setPreferenceState(theme === "dark" ? "light" : "dark"),
    }),
    [preference, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme deve ser usado dentro de <ThemeProvider>");
  return ctx;
}
