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

/**
 * Prompt para gerar a IMAGEM anotada via IA (gemini-2.5-flash-image), no
 * estilo do chat do Gemini Web. Recebe a planta original + instrucao de
 * pintar paredes externas em vermelho, internas em verde, e muros em azul,
 * com legenda no canto. Devolve a imagem editada como inline data.
 */
export function buildImageAnnotationPrompt(): string {
  return `Esta e uma planta arquitetonica. Crie uma VERSAO ANOTADA desta mesma imagem aplicando os seguintes destaques:

1) PINTE em VERMELHO semi-transparente (50% opacidade) as PAREDES EXTERNAS (aquelas que tocam o ambiente externo: rua, jardim, ar livre, garagem aberta, varanda aberta).
2) PINTE em VERDE semi-transparente (50% opacidade) as PAREDES INTERNAS (aquelas que separam ambientes internos da casa — ambas as faces dao para dentro).
3) PINTE em AZUL semi-transparente (50% opacidade) os MUROS (vedacao do terreno, fora da edificacao, dentro do lote).
4) PRESERVE o restante da planta intacto: textos, cotas, simbolos, mobiliario, hachuras, carimbo. NAO REDESENHE — apenas adicione as cores sobre as paredes existentes.
5) Adicione uma LEGENDA pequena no canto inferior direito mostrando:
   - Quadrado vermelho: "Paredes externas"
   - Quadrado verde: "Paredes internas"
   - Quadrado azul: "Muros"

REGRA CRITICA — UMA COR POR PAREDE (nao duplicar):
- Cada parede fisica do desenho recebe UMA UNICA cor sobre toda sua extensao.
- NUNCA pinte duas cores paralelas na mesma parede (ex: contorno vermelho de um lado + verde do outro). Isso esta PROIBIDO.
- NUNCA pinte uma linha de cor PARALELA a outra parede ja pintada — uma parede no desenho ocupa UM trecho geometrico unico; cubra com UMA cor.
- Hierarquia de prevalencia quando ha ambiguidade:
    a) Se PELO MENOS UMA face da parede toca ambiente externo -> VERMELHO (externa prevalece)
    b) Caso contrario, se ambas as faces tocam interno -> VERDE (interna)
    c) Se esta no contorno do lote, fora da edificacao -> AZUL (muro)

REGRA TOPOLOGICA: paredes internas NUNCA podem estar fora do poligono formado pelas paredes externas. Antes de pintar uma parede como interna, confirme que ela esta DENTRO do contorno fechado.

RESULTADO ESPERADO: a mesma planta original, com cada parede destacada em UMA UNICA cor (vermelho OU verde OU azul, nunca duas), e legenda no canto. Mantenha o mesmo tamanho e proporcao.`;
}

export function buildAreaPrompt(peDireitoM: number): string {
  return `Engenheiro orcamentista. Meca areas em m² desta planta. Pe-direito = ${peDireitoM.toFixed(2)}m.

DEFINICOES (hierarquia: externa > interna > muro — cada parede UMA classe):
- EXTERNA: ao menos 1 face fora da residencia (rua, jardim, quintal, varanda/garagem ABERTA, divisa com vizinho).
- INTERNA: ambas as faces em comodos internos cobertos+fechados. So conta paredes do piso ao teto.
- MURO: vedacao do TERRENO (fora da edificacao). Se nao ha contorno de lote no desenho -> 0.
- LAJE PISO: area horizontal coberta+fechada (exclui varanda aberta, jardim, garagem aberta).
- LAJE COBERTA: = laje_piso, salvo se houver linhas tracejadas de beiral no perimetro (entao maior).

CONTEXTO VISUAL (use ativamente): rotulos textuais (SALA/QUARTO/COZINHA/BANHEIRO/GARAGEM/VARANDA/JARDIM/RUA), mobiliario (sanitario=banheiro, fogao/pia dupla=cozinha, cama=quarto, sofa=sala, carro=garagem), linhas tracejadas no perimetro=beiral, cotas dimensionais, carimbo=pavimento.

CALCULO:
1) Classifique cada parede usando a hierarquia acima.
2) Some comprimentos por classe (use as cotas), multiplique por ${peDireitoM.toFixed(2)}m -> area_bruta.
3) Liste aberturas (porta, janela, cobogo) com largura x altura. area_liquida = bruta - aberturas.

ANTI-ZERO: toda planta residencial tem paredes externas > 0 e laje de piso > 0. Se cotas ilegiveis, estime visualmente (porta=0.8m, sala=4-6m, quarto=3-4m, banheiro=1.5-2.5m) e marque confidence="low".

OBRIGATORIO preencher TODOS os 5 campos numericos: paredes_externas, paredes_internas, muros, laje_piso_m2, laje_coberta_m2. NAO ENVIE JSON parcial — se um campo nao se aplica, use 0.0 explicito.

Responda EXCLUSIVAMENTE com este JSON (sem markdown):
{
  "pavimento": "Terreo",
  "paredes_externas": { "area_bruta_m2": 0.0, "area_aberturas_m2": 0.0, "area_liquida_m2": 0.0 },
  "paredes_internas": { "area_bruta_m2": 0.0, "area_aberturas_m2": 0.0, "area_liquida_m2": 0.0 },
  "muros": { "area_bruta_m2": 0.0, "altura_assumida_m": 2.0 },
  "laje_piso_m2": 0.0,
  "laje_coberta_m2": 0.0,
  "aberturas": [ { "tipo": "janela", "parede": "externa", "largura_m": 0.0, "altura_m": 0.0, "area_m2": 0.0 } ],
  "confidence": "high",
  "observacoes": "Cite os sinais visuais usados (rotulos, mobiliario, beiral, muro) e estimativas."
}

Os 0.0 sao EXEMPLOS — substitua por numeros reais. Enums: pavimento (Terreo/Superior/Subsolo/Cobertura/Pavimento1/...), aberturas.tipo (janela/porta/cobogo/outro), aberturas.parede (externa/interna), confidence (high/medium/low).`;
}
