import { useCallback, useState } from "react";

/**
 * Hook compartilhado para sincronizar hover/click entre a planta (esquerda)
 * e o inspector (direita) na nova interface da aba de processamento.
 *
 * - hoveredId: parede destacada por hover (mouse over). Resetada quando o
 *   mouse sai. Usada pra pulse/highlight em ambos os lados.
 * - selectedId: parede selecionada por click (persistente ate outra ser
 *   clicada). Pode abrir um detalhe lateral.
 * - activePavimento: pavimento atualmente exibido. Inspector filtra por isso.
 */
export interface ProcessingSync {
  hoveredId: string | null;
  selectedId: string | null;
  activePavimento: string;
  setHovered: (id: string | null) => void;
  setSelected: (id: string | null) => void;
  setActivePavimento: (pav: string) => void;
  /** Helper: classes Tailwind aplicaveis ao elemento conforme estado. */
  classFor: (id: string) => string;
}

export function useProcessingSync(initialPavimento = "all"): ProcessingSync {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePavimento, setActivePavimento] = useState<string>(initialPavimento);

  const setHovered = useCallback((id: string | null) => setHoveredId(id), []);
  const setSelected = useCallback((id: string | null) => setSelectedId(id), []);

  const classFor = useCallback(
    (id: string) => {
      if (selectedId === id) return "ring-2 ring-primary bg-primary/10";
      if (hoveredId === id) return "ring-2 ring-primary/50 bg-accent/40";
      return "";
    },
    [hoveredId, selectedId],
  );

  return {
    hoveredId,
    selectedId,
    activePavimento,
    setHovered,
    setSelected,
    setActivePavimento,
    classFor,
  };
}

// ============================================================
// Feature flag
// ============================================================

const FLAG_KEY = "lw-use-new-workspace-ui";

/** Le flag do localStorage. Default false (UI legada). */
export function useNewWorkspaceUI(): { enabled: boolean; toggle: () => void } {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(FLAG_KEY) === "1"; } catch { return false; }
  });
  const toggle = useCallback(() => {
    setEnabled(prev => {
      const next = !prev;
      try { window.localStorage.setItem(FLAG_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  return { enabled, toggle };
}
