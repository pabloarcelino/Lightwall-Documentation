/**
 * Prompts do Modo Visão Direta (experimental).
 *
 * 3 prompts:
 *  - buildClassificationPrompt: classifica cada página como planta_baixa / corte /
 *    fachada / outro. Curto, Gemini Flash. ~US$ 0,01.
 *  - buildSectionHeightPrompt: olha o corte e extrai o pé-direito real. Curto,
 *    Gemini Pro. ~US$ 0,01.
 *  - buildAreaPrompt: o coração. Por planta_baixa, devolve quantitativos em m²
 *    por categoria (externa, interna, muros, piso, coberta), descontando
 *    aberturas. Gemini Pro. ~US$ 0,02-0,03 por página.
 */

export function buildClassificationPrompt(pageIndexes: number[]): string {
  return `Classifique cada uma das ${pageIndexes.length} pagina(s) deste documento arquitetonico.

Para cada pagina, indique o tipo:
- "planta_baixa": vista superior 2D ortogonal de um pavimento (paredes em linhas finas, comodos rotulados, cotas dimensionais)
- "corte": vista vertical da edificacao mostrando andares empilhados (pe-direito visivel)
- "fachada": vista frontal externa da edificacao (sem interior visivel)
- "outro": qualquer outra coisa (tabela, quadro, capa, detalhe, vista 3D)

Responda EXCLUSIVAMENTE com JSON valido, sem markdown:
{
  "paginas": [
    { "page_index": ${pageIndexes[0] ?? 0}, "tipo": "planta_baixa" | "corte" | "fachada" | "outro" }
  ]
}`;
}

export function buildSectionHeightPrompt(): string {
  return `Esta pagina e um CORTE ou FACHADA da edificacao. Leia as cotas verticais e me diga o PE-DIREITO em metros.

Pe-direito = distancia entre o piso e a face inferior da laje superior (ou do teto, em caso de cobertura).

Se houver multiplos pavimentos, retorne o pe-direito predominante (o mais comum).
Se nao for possivel determinar, retorne null.

Responda EXCLUSIVAMENTE com JSON valido, sem markdown:
{
  "pe_direito_m": 2.80 | null,
  "confidence": "high" | "medium" | "low",
  "observacoes": "frase curta opcional"
}`;
}

export function buildAreaPrompt(peDireitoM: number): string {
  return `Voce e um engenheiro orcamentista. Analise esta planta arquitetonica e extraia areas em m² por categoria.

PE-DIREITO A USAR: ${peDireitoM.toFixed(2)}m (multiplique TODOS os comprimentos de parede por este valor)

DEFINICOES (siga literalmente):
- Paredes EXTERNAS: pelo menos UMA face em contato com o ambiente externo (rua, jardim, ar livre, garagem aberta, varanda aberta).
- Paredes INTERNAS: AMBAS as faces tocam ambientes internos (separa quarto/sala, banheiro/quarto, etc).
- MUROS: vedacao do terreno, fora da edificacao, dentro do lote (sem cobertura). Nao confunda com parede externa.
- LAJE DE PISO: area horizontal do pavimento — soma das areas dos comodos cobertos.
- LAJE DE COBERTURA: projecao total da edificacao coberta vista de cima (inclui beirais visiveis se mostrados).

REGRA OBRIGATORIA — ABERTURAS:
Para CADA tipo de parede (externa e interna), DESCONTAR a area das aberturas (janelas, portas, cobogos, ventilacao):
  - area_bruta_m2 = soma(comprimentos da classe) * ${peDireitoM.toFixed(2)}m
  - area_aberturas_m2 = soma das areas das aberturas atribuidas aquela classe
  - area_liquida_m2 = bruta - aberturas (numero final que vale)

ETAPAS DE ANALISE (siga a ordem):
1) Identifique os comodos visiveis (sala, quarto, cozinha, banheiro, garagem, varanda, etc).
2) Trace mentalmente o poligono externo da edificacao coberta.
3) Para CADA parede, classifique: externa, interna ou muro. (REGRA: nunca interna fora do poligono externo.)
4) Some os comprimentos por classe.
5) Multiplique por ${peDireitoM.toFixed(2)}m -> bruta_externa, bruta_interna.
6) Liste TODAS aberturas visiveis (janela, porta, cobogo, outro) com dimensoes em metros (W x H).
7) Atribua cada abertura a classe da parede onde esta (externa ou interna).
8) Calcule liquida = bruta - aberturas.
9) Para MUROS: meca o perimetro do lote (ou o que houver de muro visivel) e multiplique por altura. Se nao houver cota de altura, use 2.0m.
10) Para LAJES: meca a area do poligono fechado em m² (piso e coberta podem ser iguais se nao houver beiral).

REGRA TOPOLOGICA: nunca uma parede "interna" pode estar FORA do poligono das externas. Antes de marcar como interna, confirme que esta DENTRO do poligono fechado.

Responda EXCLUSIVAMENTE com este JSON (sem markdown, sem texto antes ou depois):
{
  "pavimento": "Terreo" | "Superior" | "Subsolo" | "Cobertura" | "Pavimento1" | etc,
  "paredes_externas": {
    "area_bruta_m2": 0.00,
    "area_aberturas_m2": 0.00,
    "area_liquida_m2": 0.00
  },
  "paredes_internas": {
    "area_bruta_m2": 0.00,
    "area_aberturas_m2": 0.00,
    "area_liquida_m2": 0.00
  },
  "muros": {
    "area_bruta_m2": 0.00,
    "altura_assumida_m": 2.00
  },
  "laje_piso_m2": 0.00,
  "laje_coberta_m2": 0.00,
  "aberturas": [
    { "tipo": "janela" | "porta" | "cobogo" | "outro", "parede": "externa" | "interna", "largura_m": 0.00, "altura_m": 0.00, "area_m2": 0.00 }
  ],
  "confidence": "high" | "medium" | "low",
  "observacoes": "frase curta sobre incertezas ou suposicoes feitas"
}`;
}
