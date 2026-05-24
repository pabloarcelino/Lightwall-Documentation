import type { ExtractedWall } from "../gemini/planAnalyzer";

/**
 * Estagio S8 da metodologia: cruzamento de quadro_esquadrias com paredes.
 *
 * Quando existe um quadro de esquadrias no projeto (tabela com codigos
 * P1, J1, J2 e suas dimensoes), o quadro e GROUND TRUTH para dimensoes
 * de portas e janelas — supera qualquer leitura visual.
 *
 * Aqui fazemos a logica de "linker":
 *  1. Para cada parede que tem has_door/has_window mas SEM esquadrias
 *     listadas, marca needs_review (faltou identificar o codigo).
 *  2. Para cada esquadria DA PAREDE cujo codigo casa com o quadro,
 *     atualiza largura/altura para os valores do quadro (precisao maior).
 *  3. Calcula opening_area_m2 = soma das areas das esquadrias.
 *  4. Sanity check: opening_area_m2 nao pode exceder area total da parede
 *     (comprimento × altura). Se exceder, marca needs_review.
 */

export interface TableEsquadria {
  codigo: string;       // "P1", "J2"
  tipo: string;         // "porta", "janela"
  largura_m: number;
  altura_m: number;
  quantidade: number;
}

export interface LinkEsquadriasResult {
  /** Paredes que tiveram dimensoes de esquadrias atualizadas pelo quadro. */
  updated: number;
  /** Paredes que tem porta/janela visual mas nao tem codigo identificado. */
  unresolved: number;
  /** Paredes com area de aberturas > area da parede (impossivel). */
  conflicts: number;
}

export function linkEsquadriasWithTable(
  walls: ExtractedWall[],
  table: TableEsquadria[] | undefined | null,
): LinkEsquadriasResult {
  const byCode = new Map<string, TableEsquadria>();
  if (table) {
    for (const e of table) {
      const code = (e.codigo || "").toUpperCase().trim();
      if (code) byCode.set(code, e);
    }
  }

  let updated = 0;
  let unresolved = 0;
  let conflicts = 0;

  for (const w of walls) {
    // 1. Atualiza dimensoes pelas do quadro quando o codigo casa.
    if (w.esquadrias && w.esquadrias.length > 0 && byCode.size > 0) {
      let touched = false;
      for (const esq of w.esquadrias) {
        const code = (esq.codigo || "").toUpperCase().trim();
        if (!code) continue;
        const tbl = byCode.get(code);
        if (!tbl) continue;
        esq.largura_m = tbl.largura_m;
        esq.altura_m = tbl.altura_m;
        esq.measurement_source = "table";
        touched = true;
      }
      if (touched) updated++;
    }

    // 2. Paredes com porta/janela mas sem esquadria identificada.
    const hasOpening = !!(w.has_door || w.has_window);
    const hasCode = (w.esquadrias?.length ?? 0) > 0;
    if (hasOpening && !hasCode) {
      unresolved++;
      w.needs_review = true;
      w.review_reason =
        (w.review_reason ? w.review_reason + " | " : "") +
        "abertura visual sem codigo de esquadria identificado";
    }

    // 3. Recalcula opening_area_m2 com as dimensoes (atualizadas) do quadro.
    if (w.esquadrias && w.esquadrias.length > 0) {
      const total = w.esquadrias.reduce(
        (s, e) => s + (Number(e.largura_m) || 0) * (Number(e.altura_m) || 0),
        0,
      );
      w.opening_area_m2 = Math.max(0, total);

      // 4. Sanity check vs area da parede.
      const wallArea = (w.comprimento_m || 0) * (w.altura_m || 0);
      if (wallArea > 0 && w.opening_area_m2 > wallArea) {
        conflicts++;
        w.needs_review = true;
        w.review_reason =
          (w.review_reason ? w.review_reason + " | " : "") +
          `area de aberturas (${w.opening_area_m2.toFixed(2)}m²) excede area da parede (${wallArea.toFixed(2)}m²)`;
      }
    }
  }

  return { updated, unresolved, conflicts };
}
