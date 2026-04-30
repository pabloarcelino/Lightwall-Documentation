export const PROMPT_TAKEOFF_VERSION = "prompt_takeoff_v1";

export const TAKEOFF_SYSTEM_PROMPT = `Voce e um especialista em levantamento quantitativo de projetos arquitetonicos. Sua tarefa e identificar paredes externas, paredes internas, muros, muretas, arrimos, lajes de piso e lajes de cobertura em plantas arquitetonicas, diagramas de cobertura, planta de situacao, cortes e memoria de calculo.

Retorne SOMENTE JSON estruturado conforme o schema fornecido. Nao invente medidas. Quando a medida estiver explicita em cota ou memoria de calculo, use essa fonte como prioridade. Quando a medida for estimada visualmente, marque como estimada no campo evidence e reduza a confianca.

Use coordenadas normalizadas de 0 a 1 relativas a imagem analisada (x cresce para direita, y cresce para baixo). Divida paredes em segmentos continuos.

Classificacao:
- parede_externa: fechamento externo da edificacao
- parede_interna: divisoria interna entre ambientes
- muro: divisa, mureta, contencao ou arrimo
- laje_piso: area construida de piso
- laje_cobertura: projecao de laje/telhado/cobertura

Para cada parede ou muro, retorne comprimento em metros (length_m_ai), altura considerada quando houver evidencia (height_m), area de uma face (area_m2_one_face) e, para paredes internas, area de duas faces (area_m2_two_faces). Se nao tiver evidencia para um campo numerico, retorne null.

Para lajes, retorne polygon (3+ pontos normalizados) e area_m2_ai. Se houver area declarada na planta/memoria (A1, A2...), preencha area_m2_declared.

Inclua sempre confidence (0..1) e evidence explicando de onde saiu a informacao. Marque needs_review=true quando a confianca for baixa ou houver ambiguidade.

Use openings_detected=true quando perceber portas/janelas no segmento.
gross_or_net="bruta" se a medida ainda nao desconta vaos; "liquida" se ja desconta; "nao_aplicavel" para muros sem aberturas.`;

/**
 * JSON Schema for OpenAI Responses API Structured Outputs (strict mode).
 */
export const TAKEOFF_RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["project_name", "assumptions", "sheets"],
  properties: {
    project_name: { type: "string" },
    assumptions: { type: "string" },
    sheets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "sheet_id",
          "sheet_name",
          "page_number",
          "scale_detected",
          "image_width_px",
          "image_height_px",
          "segments",
          "slabs",
        ],
        properties: {
          sheet_id: { type: "string" },
          sheet_name: { type: "string" },
          page_number: { type: "number" },
          scale_detected: { type: ["string", "null"] },
          image_width_px: { type: "number" },
          image_height_px: { type: "number" },
          segments: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "category",
                "level",
                "geometry_type",
                "points",
                "length_m_ai",
                "length_m_calculated",
                "height_m",
                "area_m2_one_face",
                "area_m2_two_faces",
                "openings_detected",
                "gross_or_net",
                "confidence",
                "evidence",
                "needs_review",
              ],
              properties: {
                id: { type: "string" },
                category: { type: "string", enum: ["parede_externa", "parede_interna", "muro"] },
                level: {
                  type: "string",
                  enum: ["1_pavimento", "subsolo", "caixa_dagua", "situacao", "cobertura", "outro"],
                },
                geometry_type: { type: "string", enum: ["line", "polyline", "arc"] },
                points: {
                  type: "array",
                  minItems: 2,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["x", "y"],
                    properties: {
                      x: { type: "number" },
                      y: { type: "number" },
                    },
                  },
                },
                length_m_ai: { type: ["number", "null"] },
                length_m_calculated: { type: ["number", "null"] },
                height_m: { type: ["number", "null"] },
                area_m2_one_face: { type: ["number", "null"] },
                area_m2_two_faces: { type: ["number", "null"] },
                openings_detected: { type: "boolean" },
                gross_or_net: { type: "string", enum: ["bruta", "liquida", "nao_aplicavel"] },
                confidence: { type: "number" },
                evidence: { type: "string" },
                needs_review: { type: "boolean" },
              },
            },
          },
          slabs: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "category",
                "level",
                "polygon",
                "area_m2_ai",
                "area_m2_declared",
                "area_m2_calculated",
                "confidence",
                "evidence",
                "needs_review",
              ],
              properties: {
                id: { type: "string" },
                category: { type: "string", enum: ["laje_piso", "laje_cobertura"] },
                level: { type: "string" },
                polygon: {
                  type: "array",
                  minItems: 3,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["x", "y"],
                    properties: {
                      x: { type: "number" },
                      y: { type: "number" },
                    },
                  },
                },
                area_m2_ai: { type: ["number", "null"] },
                area_m2_declared: { type: ["number", "null"] },
                area_m2_calculated: { type: ["number", "null"] },
                confidence: { type: "number" },
                evidence: { type: "string" },
                needs_review: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
} as const;

export function buildUserPrompt(opts: {
  pageNumber: number;
  pageLabel?: string | null;
  pavimento?: string | null;
  scaleText?: string | null;
  pxPerMeter?: number | null;
  imageWidthPx: number;
  imageHeightPx: number;
}): string {
  const lines: string[] = [];
  lines.push(`Pagina ${opts.pageNumber} (${opts.imageWidthPx}x${opts.imageHeightPx} px).`);
  if (opts.pageLabel) lines.push(`Tipo: ${opts.pageLabel}.`);
  if (opts.pavimento) lines.push(`Pavimento: ${opts.pavimento}.`);
  if (opts.scaleText) lines.push(`Escala detectada na planta: ${opts.scaleText}.`);
  if (opts.pxPerMeter) lines.push(`Calibracao informada pelo usuario: ${opts.pxPerMeter.toFixed(2)} px/m.`);
  lines.push("");
  lines.push("Identifique paredes externas, internas, muros e lajes (piso/cobertura).");
  lines.push("Use coordenadas normalizadas (0..1).");
  lines.push("Inclua todos os segmentos visiveis. Quando nao tiver certeza, retorne needs_review=true e confidence baixa.");
  return lines.join("\n");
}
