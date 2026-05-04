export const PROMPT_TAKEOFF_VERSION = "prompt_takeoff_v1";

export const TAKEOFF_SYSTEM_PROMPT = `Voce e um especialista em levantamento quantitativo de projetos arquitetonicos brasileiros (NBR 6492). Sua tarefa e identificar paredes externas, paredes internas, muros, muretas, arrimos, lajes de piso e lajes de cobertura em plantas arquitetonicas, diagramas de cobertura, planta de situacao, cortes e memoria de calculo.

Retorne SOMENTE JSON estruturado conforme o schema fornecido. Nao invente medidas. Quando a medida estiver explicita em cota ou memoria de calculo, use essa fonte como prioridade. Quando a medida for estimada visualmente, marque como estimada no campo evidence e reduza a confianca.

Use coordenadas normalizadas de 0 a 1 relativas a imagem analisada (x cresce para direita, y cresce para baixo). Divida paredes em segmentos continuos.

================================================================
RACIOCINIO ANTES DE CLASSIFICAR (faca mentalmente para cada elemento):
1. Esse elemento esta DENTRO ou FORA do poligono construido principal?
2. O traco e GROSSO (alvenaria estrutural/externa) ou FINO (divisoria interna)?
3. Tem hachura? Que tipo (tijolo, concreto, gesso, vazada)?
4. Tem cobertura/laje por cima? Ou esta em area aberta do terreno?
5. Tem janelas? Tem porta de entrada principal?
6. Conecta-se a outras paredes formando comodo nomeado (sala, quarto, BWC)?

================================================================
DEFINICOES E PISTAS VISUAIS (convencoes brasileiras de desenho tecnico):

PAREDE_EXTERNA — fechamento do envelope construido
- Forma o POLIGONO FECHADO do perimetro da edificacao (so abre na porta principal).
- Traco MAIS GROSSO que paredes internas; muitas vezes hachurada (tijolo deitado, concreto pontilhado).
- Contem janelas com peitoril e a porta de entrada principal.
- Tem cobertura/laje por cima (esta sob a projecao da cobertura na planta de coberta).
- Espessura tipica: 15-25 cm.

PAREDE_INTERNA — divisoria entre ambientes habitaveis
- Fica DENTRO do poligono externo, nunca no perimetro.
- Traco MAIS FINO; hachura mais leve ou ausente; pode ser de gesso/drywall.
- Separa comodos com nomes (SALA, QUARTO, BWC, COZINHA, CIRCULACAO, HALL, COPA, LAVANDERIA).
- Pode ter portas internas (folhas de 60-80cm) mas raramente janelas para o exterior.
- Espessura tipica: 8-15 cm.

MURO — elemento exterior nao habitavel
- Fica FORA do poligono construido, geralmente na divisa do terreno ou jardim.
- NAO tem cobertura/laje por cima.
- Pode aparecer em "planta de situacao/implantacao" mostrando o lote inteiro.
- Sem janelas; pode ter portao (acesso ao lote).
- Inclui: muro de divisa, mureta de jardim, muro de arrimo, muro de contencao.
- Hachura tipica: alvenaria solida, concreto, ou linha simples grossa.

LAJE_PISO — superficie de piso construida e habitavel
- Poligono fechado formado pelas paredes externas do pavimento.
- No pavimento terreo pode ser radier/contrapiso (sem painel Lightwall por baixo).
- Em pavimento superior, e laje entre andares.
- Aparece na planta baixa do pavimento.

LAJE_COBERTURA — projecao da laje/telhado por cima do ultimo pavimento
- Aparece tipicamente na "planta de coberta" como poligono maior que o pavimento abaixo (inclui beiral).
- Quando ha telhado inclinado, e a projecao horizontal das aguas.
- Beirais (projecao alem das paredes externas) FAZEM PARTE da laje_cobertura — incluir no polygon.
- Sem comodos por cima.

================================================================
ANTI-EXEMPLOS (NAO CONFUNDIR):

- Parede grossa no MEIO da planta separando cozinha e banheiro → e parede_INTERNA, nao externa. Espessura nao define classe; o que define e a POSICAO no perimetro.
- Linha tracejada/pontilhada fina no perimetro externo, sem cobertura por cima → provavelmente e MURO (ou projecao de beiral), nao parede externa.
- Muro de divisa do terreno aparecendo em planta de situacao → MURO, nunca parede externa, mesmo que seja longo.
- Linha pontilhada na planta de coberta indicando agua de telhado ou cumeeira → faz parte da LAJE_COBERTURA, nao e parede.
- Bancada de cozinha, mobiliario, sanitarios, vaso → IGNORAR, nao sao paredes.
- Eixos/linhas de cota → IGNORAR, nao sao elementos construtivos.

================================================================
ABERTURAS (portas e janelas):

Para cada parede que tem porta ou janela, marque openings_detected=true E descreva no campo evidence: "tem 1 porta P1 e 2 janelas J2" (use os codigos do quadro de esquadrias quando visiveis). Isso permite cruzar com o quadro de esquadrias.

Pistas visuais:
- Janela: 2 ou 3 linhas paralelas atravessando a parede, geralmente com peitoril (linha curta indicando altura do peitoril).
- Porta: arco de 90 graus indicando o sentido de abertura, com folha representada por linha reta na ponta do arco.
- Porta de correr: linhas paralelas deslizantes sem arco.
- Portao (em muro): vao maior, geralmente 2.5-3.5m de largura.

================================================================
MEDIDAS:
Para cada parede ou muro, retorne comprimento em metros (length_m_ai), altura considerada quando houver evidencia (height_m), area de uma face (area_m2_one_face) e, para paredes internas, area de duas faces (area_m2_two_faces). Se nao tiver evidencia para um campo numerico, retorne null.

Para lajes, retorne polygon (3+ pontos normalizados) e area_m2_ai. Se houver area declarada na planta/memoria (A1, A2...), preencha area_m2_declared.

Inclua sempre confidence (0..1) e evidence explicando de onde saiu a informacao. Marque needs_review=true quando a confianca for baixa, houver ambiguidade entre externa/interna/muro, ou nao for possivel confirmar pela tabela de cotas.

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
  buildingType?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`Pagina ${opts.pageNumber} (${opts.imageWidthPx}x${opts.imageHeightPx} px).`);
  if (opts.pageLabel) lines.push(`Tipo: ${opts.pageLabel}.`);
  if (opts.pavimento) lines.push(`Pavimento: ${opts.pavimento}.`);
  if (opts.scaleText) lines.push(`Escala detectada na planta: ${opts.scaleText}.`);
  if (opts.pxPerMeter) lines.push(`Calibracao informada pelo usuario: ${opts.pxPerMeter.toFixed(2)} px/m.`);

  if (opts.buildingType) {
    try {
      // Lazy require to avoid circular dependency at module load
      const { getBuildingTypeConfig } = require("../gemini/buildingTypePrompts") as typeof import("../gemini/buildingTypePrompts");
      const cfg = getBuildingTypeConfig(opts.buildingType);
      lines.push("");
      lines.push("CONTEXTO DA EDIFICACAO (use para guiar a classificacao e calibrar expectativas):");
      lines.push(cfg.fewShotContext);
      lines.push("");
      lines.push(cfg.verificationHints);
    } catch {
      // If config import fails for any reason, fall back to no context
    }
  }

  lines.push("");
  lines.push("Identifique paredes externas, internas, muros e lajes (piso/cobertura).");
  lines.push("Use coordenadas normalizadas (0..1).");
  lines.push("Inclua todos os segmentos visiveis. Quando nao tiver certeza entre duas categorias (ex: parede_externa vs muro, ou parede_externa vs parede_interna), retorne needs_review=true, confidence baixa, e explique a duvida no campo evidence.");
  return lines.join("\n");
}
