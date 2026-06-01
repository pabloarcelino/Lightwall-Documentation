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
  return `Esta e uma planta arquitetonica. Crie uma VERSAO ANOTADA pintando TODAS as paredes do desenho.

============================================================
CONVENCAO DE CORES — FIXA E NAO-NEGOCIAVEL
============================================================
SEMPRE use exatamente este mapeamento (NAO INVENTE convencoes proprias):
- VERMELHO #FF0000 a 50% opacidade  ->  PAREDES EXTERNAS (edificacao)
- VERDE    #00C853 a 50% opacidade  ->  PAREDES INTERNAS (divisorias)
- AZUL     #2962FF a 50% opacidade  ->  MUROS (vedacao do terreno/lote)

LEGENDA OBRIGATORIA no canto inferior direito, com EXATAMENTE essas 3 linhas e nessa ORDEM:
  [quadrado vermelho] Paredes externas
  [quadrado verde]    Paredes internas
  [quadrado azul]     Muros

NUNCA escreva outras palavras na legenda. NUNCA inverta cores. NUNCA omita uma linha. Se ha so 1 ou 2 categorias na planta, ainda assim escreva as 3 linhas da legenda com seus respectivos quadrados de cor.

============================================================
DEFINICOES — leia com cuidado
============================================================
PAREDE EXTERNA (VERMELHO): parede da EDIFICACAO COBERTA que tem ao menos UMA face em contato com ambiente externo (rua, jardim, quintal, varanda aberta, garagem aberta, divisa com vizinho). E uma das paredes que FORMA o contorno do volume coberto da casa.

PAREDE INTERNA (VERDE): parede DENTRO da edificacao coberta que separa dois ambientes internos cobertos+fechados (ex: SALA/QUARTO, COZINHA/BANHEIRO, HALL/CORREDOR). Geralmente mais finas que as externas. Inclui divisorias de drywall.

MURO (AZUL): vedacao do TERRENO/LOTE, fora da edificacao coberta. Pista visual primaria: existem AREAS verdes (jardim/grama) ou cinzas (calcada/passeio/piso descoberto) DESENHADAS ao redor da edificacao, e ha LINHAS no perimetro dessas areas externas separando-as da rua ou do lote vizinho. O muro PODE encostar na parede externa ou continuar a partir dela. Em plantas SUBSOLO/PAVIMENTO sem jardim ao redor, normalmente nao ha muro.

============================================================
REGRA CRITICA — COBERTURA TOTAL DAS PAREDES
============================================================
Toda parede desenhada na planta DEVE receber UMA cor. NAO DEIXE NENHUMA PAREDE SEM COR.

Antes de finalizar, percorra a planta cômodo por cômodo e confira:
- Toda parede que circunda cada cômodo coberto esta pintada?
- Toda parede entre dois cômodos cobertos esta pintada de verde?
- Toda parede no contorno do volume coberto esta pintada de vermelho?
- O contorno do lote (se houver) esta pintado de azul?

Especial atencao: paredes INTERNAS finas (divisorias de banheiro, closet, corredor, despensa) sao facilmente esquecidas. Pinte TODAS.

============================================================
REGRA CRITICA — UMA UNICA COR POR PAREDE FISICA
============================================================
Cada parede do desenho recebe UMA UNICA cor sobre toda sua extensao.

PROIBIDO:
- Pintar duas cores paralelas na mesma parede (ex: linha vermelha de um lado + linha verde do outro).
- Desenhar uma faixa de cor PARALELA a uma parede ja pintada (uma parede e UMA linha unica).
- Trocar a cor no meio da parede.
- Encostar uma linha vermelha e uma linha azul paralelas (isso e o BUG MAIS COMUM — leia o bloco abaixo).

============================================================
REGRA SUPER-CRITICA — NUNCA VERMELHO E AZUL COLADOS
============================================================
Quando a parede EXTERNA da casa coincide com o limite do LOTE (ex: a casa esta encostada na divisa, ou a parede da garagem aberta serve tambem de limite do terreno), essa parede e UMA UNICA parede fisica — NAO sao duas paredes diferentes.

Nesse caso, pinte APENAS de VERMELHO (externa prevalece). NUNCA desenhe uma linha azul paralela colada/encostada na linha vermelha. NUNCA mostre vermelho e azul lado a lado na mesma posicao do desenho.

Como saber se voce esta fazendo errado: olhe a planta depois de pintar. Se voce ve uma faixa vermelha e uma faixa azul paralelas, encostadas uma na outra ou separadas por 1-2mm — esta ERRADO. Apague uma das duas. A externa (vermelho) prevalece.

Regra mecanica: para CADA trecho geometrico do desenho (cada segmento de linha que representa uma parede), escolha UMA cor com base na hierarquia abaixo, e pinte SO uma faixa daquela cor sobre a linha. Nunca duas faixas paralelas no mesmo trecho.

============================================================
HIERARQUIA DE PREVALENCIA (uma cor por trecho)
============================================================
  1. Se ao menos UMA face toca ambiente externo -> VERMELHO (externa)
  2. Caso ambas as faces toquem interno coberto -> VERDE (interna)
  3. Se esta no contorno do LOTE e NAO existe parede da edificacao na mesma posicao -> AZUL (muro)

Exemplos:
- Parede que separa SALA (interna) da VARANDA ABERTA (externa) -> VERMELHO unico. Nao pinte verde tambem.
- Parede da garagem aberta que e tambem o limite do lote -> VERMELHO unico. Nao pinte azul paralelo.
- Linha do perimetro do lote em trecho onde NAO ha edificacao (so jardim/grama externa) -> AZUL.
- Onde a edificacao se afasta do limite do lote (ha jardim entre a parede externa e o muro) -> VERMELHO na parede da casa E AZUL na linha do muro, mas elas estao a varios metros de distancia, NAO encostadas/paralelas.

REGRA TOPOLOGICA: parede VERDE (interna) NUNCA pode estar fora do contorno fechado formado pelas paredes VERMELHAS (externas). Antes de pintar verde, confirme que esta DENTRO da edificacao.

============================================================
PRESERVACAO DO DESENHO ORIGINAL
============================================================
PRESERVE intacto: textos, cotas, simbolos, mobiliario, hachuras, carimbo, tabela de areas, titulo. NAO REDESENHE — apenas adicione as cores transparentes sobre as paredes existentes.

RESULTADO: a planta original identica, com TODAS as paredes destacadas em UMA UNICA cor (vermelho/verde/azul conforme convencao fixa), e legenda padronizada no canto. Mesmo tamanho e proporcao.`;
}

export function buildAreaPrompt(peDireitoM: number): string {
  return `Engenheiro orcamentista. Meca areas em m² desta planta. Pe-direito = ${peDireitoM.toFixed(2)}m.

DEFINICOES (hierarquia: externa > interna > muro — cada parede UMA UNICA classe):
- EXTERNA: parede da EDIFICACAO COBERTA com ao menos 1 face fora da residencia (rua, jardim, quintal, varanda/garagem ABERTA, divisa com vizinho).
- INTERNA: ambas as faces em comodos internos cobertos+fechados. So conta paredes do piso ao teto. Inclui divisorias finas (banheiro, closet, corredor, despensa, drywall).
- MURO: vedacao do TERRENO/LOTE, FORA da edificacao coberta. SINAL VISUAL: a planta mostra areas verdes (jardim/grama) ou cinzas (calcada/passeio/piso descoberto) AO REDOR da edificacao, e ha linhas no perimetro dessas areas externas. O contorno do lote ESTA presente quando a planta mostra "terreno" (jardim/quintal/garagem) alem do volume coberto. Se a planta mostra SO o interior da edificacao (sem terreno ao redor, ex: apartamento, pavimento superior, subsolo enterrado) -> muros = 0.
- LAJE PISO: area horizontal coberta+fechada (exclui varanda aberta, jardim, garagem aberta).
- LAJE COBERTA: = laje_piso, salvo se houver linhas tracejadas de beiral no perimetro (entao maior).

IMPORTANTE — REGRA ANTI-PARALELA: nao pode haver duas paredes paralelas no mesmo lugar fisico. Cada trecho de parede do desenho recebe UMA UNICA classificacao. Onde tem parede EXTERNA, nao tem parede INTERNA paralela colada nela — se voce duvidar entre as duas, externa prevalece.

IMPORTANTE — EXTERNA vs MURO no MESMO TRECHO: quando a parede externa da edificacao coincide com o limite do lote (a casa esta encostada na divisa, ou a parede da garagem aberta tambem e limite do terreno), conte esse trecho APENAS como parede EXTERNA, NAO some o mesmo trecho tambem em muros. Muro entra so para os trechos do perimetro do lote onde NAO ha edificacao na mesma linha (ex: cerca/muro do jardim, frente do lote onde so tem grama, divisa lateral entre lote e vizinho sem casa encostada).

REGRA — IDENTIFIQUE TODAS AS PAREDES: varra a planta comodo por comodo. Toda parede desenhada (espessa ou fina) DEVE entrar em uma das 3 classes. Atencao especial as divisorias FINAS de banheiro, closet, corredor — sao facilmente esquecidas.

CONTEXTO VISUAL (use ativamente): rotulos textuais (SALA/QUARTO/COZINHA/BANHEIRO/GARAGEM/VARANDA/JARDIM/RUA), mobiliario (sanitario=banheiro, fogao/pia dupla=cozinha, cama=quarto, sofa=sala, carro=garagem), linhas tracejadas no perimetro=beiral, cotas dimensionais, carimbo=pavimento. Para MUROS: olhe se ha JARDIM/GRAMA/CALCADA desenhados em volta da edificacao — se sim, ha lote e provavelmente muro no perimetro.

CALCULO:
1) Classifique cada parede usando a hierarquia acima (varredura completa, sem deixar parede sem classe).
2) Some comprimentos por classe (use as cotas), multiplique por ${peDireitoM.toFixed(2)}m -> area_bruta.
3) Liste aberturas (porta, janela, cobogo) com largura x altura. area_liquida = bruta - aberturas.
4) Para MURO: se ha jardim/quintal/calcada desenhados, identifique o perimetro do LOTE (nao o da edificacao), some seus lados (descontando portao se visivel) e multiplique por altura (cota visivel ou 2.0m).

ANTI-ZERO: toda planta residencial tem paredes externas > 0 e laje de piso > 0. Plantas TERREO de casa quase sempre tem MURO > 0 (a casa fica num lote com vedacao). Se cotas ilegiveis, estime visualmente (porta=0.8m, sala=4-6m, quarto=3-4m, banheiro=1.5-2.5m) e marque confidence="low".

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
