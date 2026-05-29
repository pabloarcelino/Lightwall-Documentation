import { useCallback, useEffect, useRef, useState } from "react";

interface UseSseWithRetryOptions {
  url: string;
  /** Lista de event names (addEventListener) a registrar. Default ["message"]. */
  events?: string[];
  /** Chamado para cada evento parseado (JSON). Se o parse falhar, este callback recebe `null` e o `raw` string. */
  onEvent: (eventName: string, payload: unknown, rawData: string) => void;
  /** Chamado quando o numero maximo de retries e exaurido — caller decide o que fazer (toast com botao reconectar). */
  onMaxRetriesExceeded?: () => void;
  /** Pausa/abre o stream. Quando false, fecha o EventSource e nao tenta reconectar. */
  enabled?: boolean;
  /** Maximo de tentativas de reconexao com backoff exponencial. Default 5. */
  maxRetries?: number;
  /** Backoff base em ms (primeira tentativa). Default 1500. Dobra a cada falha. */
  baseBackoffMs?: number;
}

interface UseSseWithRetryReturn {
  /** EventSource conectado e recebendo eventos. */
  connected: boolean;
  /** True apos exaurir maxRetries. Chama reconnect() para tentar de novo. */
  exhausted: boolean;
  /** Forca uma reconexao manual (ex: ao usuario clicar "Reconectar agora"). */
  reconnect: () => void;
}

/**
 * Hook generico para consumir SSE com:
 * - reconexao automatica bounded (max retries + backoff exponencial),
 * - cleanup em unmount,
 * - callback quando o limite e atingido (caller mostra toast/cta).
 *
 * Extraido do padrao usado em ProjectDetails (/progress) — pra que multiplos
 * canais SSE (/ai-events, /pipeline-events streaming, etc) compartilhem a
 * mesma logica de resiliencia sem duplicar codigo.
 */
export function useSseWithRetry({
  url,
  events = ["message"],
  onEvent,
  onMaxRetriesExceeded,
  enabled = true,
  maxRetries = 5,
  baseBackoffMs = 1500,
}: UseSseWithRetryOptions): UseSseWithRetryReturn {
  const [connected, setConnected] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guarda a versao mais recente do onEvent sem reabrir o stream a cada render.
  const onEventRef = useRef(onEvent);
  const onMaxRef = useRef(onMaxRetriesExceeded);

  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);
  useEffect(() => { onMaxRef.current = onMaxRetriesExceeded; }, [onMaxRetriesExceeded]);

  const open = useCallback(() => {
    if (!enabled) return;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      retryCountRef.current = 0;
      setConnected(true);
      setExhausted(false);
    };

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconecta sozinho enquanto nao for fechado. Tratamos
      // como morto so quando o browser reporta CLOSED — evita fechar feed em
      // hiccups transitorios (proxy intermediario, redes flutuando).
      if (es.readyState !== EventSource.CLOSED) return;

      if (retryCountRef.current >= maxRetries) {
        setExhausted(true);
        onMaxRef.current?.();
        return;
      }

      const attempt = retryCountRef.current + 1;
      retryCountRef.current = attempt;
      const backoff = baseBackoffMs * Math.pow(2, attempt - 1);
      timeoutRef.current = setTimeout(() => {
        // Caso o usuario tenha desmontado ou outro reconnect tenha tomado o
        // ref, abandona silenciosamente.
        if (esRef.current !== es) return;
        try { es.close(); } catch { /* noop */ }
        open();
      }, backoff);
    };

    const dispatchHandler = (eventName: string) => (raw: MessageEvent) => {
      try {
        const parsed = JSON.parse(raw.data);
        onEventRef.current(eventName, parsed, raw.data);
      } catch {
        onEventRef.current(eventName, null, raw.data);
      }
    };

    for (const evName of events) {
      if (evName === "message") {
        es.onmessage = dispatchHandler("message");
      } else {
        es.addEventListener(evName, dispatchHandler(evName));
      }
    }
  }, [url, enabled, maxRetries, baseBackoffMs, events]);

  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    setExhausted(false);
    try { esRef.current?.close(); } catch { /* noop */ }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    open();
  }, [open]);

  useEffect(() => {
    if (!enabled) {
      try { esRef.current?.close(); } catch { /* noop */ }
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setConnected(false);
      return;
    }
    open();
    return () => {
      try { esRef.current?.close(); } catch { /* noop */ }
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setConnected(false);
    };
  }, [enabled, open]);

  return { connected, exhausted, reconnect };
}
