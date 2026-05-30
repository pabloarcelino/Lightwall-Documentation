/**
 * Mecanismo de aborto cooperativo do pipeline de processamento.
 *
 * Como funciona:
 *  - Endpoint POST /api/projects/:id/abort chama `requestAbort(projectId)` —
 *    insere o projectId num Set em memoria.
 *  - O loop principal do pipeline (em routes.ts) chama `throwIfAborted(...)`
 *    em checkpoints (entre etapas grandes). Se o id estiver no Set, lanca
 *    um erro que abortar o try/catch externo, marca o projeto como "error"
 *    com mensagem "Abortado pelo usuario", e libera SSE.
 *  - `clearAbort(...)` e chamado no inicio de cada novo run (caso o usuario
 *    reprocess um projeto previamente abortado).
 *
 * Sem tentar interromper chamadas Gemini em voo — o cancelamento e best-effort
 * e so toma efeito no proximo checkpoint. Operacoes longas (extracao
 * geometrica 2-3min) so abortam quando terminam, mas o pipeline para na
 * fronteira da proxima etapa. Resultado: cancelamento "responsivo o
 * suficiente" sem complexidade de AbortController em N chamadas.
 */

const abortedProjects = new Set<number>();

export class PipelineAbortedError extends Error {
  constructor(projectId: number) {
    super(`Pipeline do projeto ${projectId} foi abortado pelo usuario`);
    this.name = "PipelineAbortedError";
  }
}

/** Sinaliza que o usuario solicitou o aborto. */
export function requestAbort(projectId: number): void {
  abortedProjects.add(projectId);
  console.log(`[ABORT] Aborto solicitado para projeto ${projectId}`);
}

/** Limpa a flag — chamado no inicio de cada novo run. */
export function clearAbort(projectId: number): void {
  abortedProjects.delete(projectId);
}

/** True se ja foi pedido pra abortar este projeto. */
export function isAborted(projectId: number): boolean {
  return abortedProjects.has(projectId);
}

/**
 * Chamado em checkpoints do pipeline. Quando aborto foi pedido, lanca
 * PipelineAbortedError — o try/catch externo fecha o pipeline e marca o
 * projeto como "error".
 */
export function throwIfAborted(projectId: number): void {
  if (abortedProjects.has(projectId)) {
    throw new PipelineAbortedError(projectId);
  }
}
