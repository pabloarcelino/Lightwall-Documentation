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

REGRA TOPOLOGICA: paredes internas NUNCA podem estar fora do poligono formado pelas paredes externas. Antes de pintar uma parede como interna, confirme que ela esta DENTRO do contorno fechado.

RESULTADO ESPERADO: a mesma planta original, com as paredes destacadas em vermelho/verde/azul e legenda no canto. Mantenha o mesmo tamanho e proporcao.`;
}

export function buildAreaPrompt(peDireitoM: number): string {
  return `Voce e um engenheiro orcamentista experiente analisando uma planta arquitetonica residencial. Use TODOS os elementos visuais da imagem para entender o contexto antes de medir.

PE-DIREITO A USAR: ${peDireitoM.toFixed(2)}m (multiplique TODOS os comprimentos de parede por este valor).

============================================================
FASE 1 — LEITURA DO CONTEXTO VISUAL
============================================================
Antes de classificar qualquer parede, varra a imagem procurando:

1. ROTULOS TEXTUAIS de ambientes: SALA, QUARTO, SUITE, COZINHA, COPA, BANHEIRO, WC, LAVABO, AREA DE SERVICO, AREA, LAVANDERIA, GARAGEM, VARANDA, SACADA, TERRACO, CHURRASQUEIRA, JARDIM, QUINTAL, RUA, CALCADA, ENTRADA, HALL, CORREDOR, ESCRITORIO, DEPOSITO, DESPENSA. Use-os para saber qual ambiente esta de cada lado de cada parede.

2. SIMBOLOS DE MOBILIARIO/EQUIPAMENTO que confirmam o tipo do comodo quando o rotulo esta ausente ou ilegivel:
   - Vaso sanitario, bide, pia com cuba pequena = BANHEIRO/WC
   - Pia grande com cuba dupla, fogao, geladeira = COZINHA
   - Cama, criado-mudo, guarda-roupa = QUARTO
   - Sofa, mesa de centro, TV = SALA
   - Carro/garagem hachurada = GARAGEM
   - Tanque, maquina de lavar = AREA DE SERVICO
   - Churrasqueira, bancada externa = AREA GOURMET/VARANDA

3. LINHAS TRACEJADAS no PERIMETRO externo da edificacao = projecao do TELHADO/BEIRAL/LAJE DE COBERTURA. Se houver, a coberta e MAIOR que o piso.

4. HACHURAS dentro das paredes (preenchidas, listradas, com pontilhado) = indicam tipo construtivo (alvenaria/concreto/drywall). TODAS contam como parede — nao filtre por tipo.

5. COTAS DIMENSIONAIS (numeros em metros ou centimetros proximos das paredes) = comprimento real para o calculo. Procure tambem cotas gerais nas bordas da planta.

6. CONTORNO DO LOTE (linhas finas mais externas, geralmente com texto "DIVISA", "MURO", "PORTAO", "PASSEIO", "MEIO-FIO", "RUA") = onde fica o muro do terreno (se existir).

7. CARIMBO ou TITULO da prancha (TERREO, SUPERIOR, COBERTURA, SUBSOLO, PAV. 1, PAV. 2) = define o campo "pavimento" da resposta.

============================================================
FASE 2 — DEFINICOES REFINADAS
============================================================

PAREDES EXTERNAS — pelo menos UMA face em contato com a PARTE DE FORA da residencia. "Fora" inclui:
  - Rua, calcada, jardim, quintal, patio descoberto
  - Varanda ABERTA (sem fechamento vertical do piso ao teto)
  - Garagem ABERTA (sem porta basculante/portao com fechamento vertical)
  - Area de servico externa descoberta
  - Divisa com lote vizinho (caso de casa geminada: a parede compartilhada com o vizinho ainda e EXTERNA pela otica desta residencia)
  Sinal visual primario: a parede esta na BORDA do poligono fechado da edificacao coberta. Do lado de fora ha rotulo externo (RUA/JARDIM/QUINTAL) OU simplesmente espaco em branco fora do poligono.

PAREDES INTERNAS — AMBAS as faces tocam ambientes internos, cobertos e FECHADOS, da mesma residencia. Exemplos:
  - Separa quarto/sala, banheiro/quarto, cozinha/sala, copa/cozinha, hall/corredor, etc.
  - Drywall e divisorias leves CONTAM como interna se vao do piso ao teto separando ambientes cobertos.
  - Paredes de MEIA-ALTURA (peitoris, balcoes de cozinha, parapeitos) NAO contam — soma so paredes que vao do piso ao teto.
  Sinal visual primario: a parede esta DENTRO do poligono externo, com rotulo de comodo coberto/fechado de CADA UM dos dois lados (ex: "SALA" e "QUARTO 1").
  REGRA TOPOLOGICA: nunca uma parede classificada como interna pode estar FORA do poligono das externas. Antes de marcar como interna, confirme que esta DENTRO do contorno fechado.

MUROS — vedacao do TERRENO, fora da edificacao, sem cobertura. So conta quando ha SINAL VISUAL CLARO:
  - Linhas no CONTORNO DO LOTE (nao da edificacao)
  - Texto "MURO", "DIVISA", "PORTAO" proximo
  - Pode haver abertura (portao de carro/pedestre)
  Se NAO houver muro desenhado na planta (ex: apartamento, planta interna apenas, planta sem o lote completo), retorne area_bruta_m2 = 0 para muros. NAO INVENTE perimetro de lote.
  Altura: use a cota visivel (1.80m, 2.00m, 2.20m, etc). Sem cota, use 2.0m.

LAJE DE PISO — area horizontal da edificacao COBERTA E FECHADA:
  - Inclui: quartos, salas, cozinhas, banheiros, hall, corredor, area de servico coberta, garagem fechada/coberta, escritorio
  - EXCLUI: varandas/sacadas abertas, jardins, patios descobertos, garagem aberta sem cobertura, piscina
  Sinal visual: poligono fechado da edificacao principal (linhas CONTINUAS das paredes externas — NAO as tracejadas de projecao de telhado).

LAJE DE COBERTURA — projecao horizontal vista de cima, INCLUINDO BEIRAIS quando indicados:
  - Sinal visual: linhas TRACEJADAS ao redor da edificacao = projecao do telhado/laje superior
  - Se ha beiral: laje_coberta > laje_piso (a diferenca e a area do beiral)
  - Se NAO ha projecao tracejada: laje_coberta = laje_piso
  NAO invente beiral; se a planta nao mostra, considere igual ao piso.

============================================================
FASE 3 — CALCULO (siga a ordem)
============================================================
1) Identifique os comodos visiveis usando rotulos + simbolos da fase 1.
2) Trace mentalmente o POLIGONO EXTERNO da edificacao coberta (linhas continuas).
3) Para CADA parede, classifique: externa, interna ou muro (regras da fase 2). Em caso de duvida, leia o rotulo dos dois lados.
4) Some os comprimentos por classe usando as cotas visiveis.
5) Multiplique por ${peDireitoM.toFixed(2)}m -> bruta_externa, bruta_interna.
6) Liste TODAS as aberturas visiveis (janela, porta, cobogo, outro) com dimensoes (largura x altura) em metros. Use simbolos: arco = porta, linha cortada na parede com 2 paralelas = janela, retangulo perfurado = cobogo.
7) Atribua cada abertura a classe da parede onde esta (externa ou interna).
8) area_liquida = area_bruta - soma(area das aberturas daquela classe).
9) MUROS: se houver no desenho, meca perimetro do lote * altura. Se NAO houver, retorne zero.
10) LAJE PISO: meca a area do poligono fechado em m². LAJE COBERTA: se houver tracejado de beiral, meca o poligono tracejado; senao, igual ao piso.

============================================================
ANTI-ZERO / ANTI-TEMPLATE
============================================================
- Toda planta arquitetonica residencial tem pelo menos paredes externas e laje de piso. NUNCA devolva tudo zero.
- Se cotas estao ilegiveis, ESTIME visualmente usando referencias:
   * Porta de comodo ≈ 0.80m de largura
   * Janela tipica ≈ 1.20m de largura
   * Sala/cozinha tipica ≈ 4-6m de lado
   * Quarto tipico ≈ 3-4m de lado
   * Banheiro ≈ 1.5-2.5m de lado
- Faixas plausiveis (casa 50-150m²): externas 30-70m², internas 30-80m², laje piso 50-150m².
- Quando estimar por falta de cota, defina confidence="low" e explique nas observacoes quais sinais voce usou.

============================================================
SOBRE OS NUMEROS DO SCHEMA ABAIXO
============================================================
Os 0.0 que aparecem no schema sao EXEMPLOS ILUSTRATIVOS apenas para mostrar o TIPO esperado (numero decimal). VOCE DEVE SUBSTITUIR CADA 0.0 por um numero real apurado da planta usando as etapas da fase 3.

PERMITIDO devolver 0.0 SOMENTE quando aquela categoria GENUINAMENTE nao existe na planta:
  - muros.area_bruta_m2 = 0.0 se nao ha vedacao de lote no desenho
  - paredes_internas.area_liquida_m2 = 0.0 so se a planta for galpao/comodo unico sem divisorias
  - laje_coberta_m2 = laje_piso_m2 se nao ha beiral tracejado

PROIBIDO devolver todos os campos com 0.0. Toda planta residencial TEM paredes externas e laje de piso > 0.

Responda EXCLUSIVAMENTE com este JSON (sem markdown, sem texto antes ou depois). Schema:
{
  "pavimento": "Terreo",
  "paredes_externas": {
    "area_bruta_m2": 0.0,
    "area_aberturas_m2": 0.0,
    "area_liquida_m2": 0.0
  },
  "paredes_internas": {
    "area_bruta_m2": 0.0,
    "area_aberturas_m2": 0.0,
    "area_liquida_m2": 0.0
  },
  "muros": {
    "area_bruta_m2": 0.0,
    "altura_assumida_m": 2.0
  },
  "laje_piso_m2": 0.0,
  "laje_coberta_m2": 0.0,
  "aberturas": [
    { "tipo": "janela", "parede": "externa", "largura_m": 0.0, "altura_m": 0.0, "area_m2": 0.0 }
  ],
  "confidence": "high",
  "observacoes": "Cite quais sinais visuais voce usou (rotulos vistos, simbolos, projecao de beiral, presenca/ausencia de muro) e quaisquer estimativas feitas."
}

Valores aceitos:
  - pavimento: "Terreo", "Superior", "Subsolo", "Cobertura", "Pavimento1", etc.
  - aberturas[].tipo: "janela", "porta", "cobogo", "outro"
  - aberturas[].parede: "externa", "interna"
  - confidence: "high", "medium", "low"`;
}
