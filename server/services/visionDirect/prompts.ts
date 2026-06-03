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

REGRAS:
1) "pe_direito_m" e o valor PREDOMINANTE (mais comum entre os pavimentos visiveis). Use null se nao for possivel determinar.
2) "por_pavimento" lista CADA pavimento visivel no corte com seu pe-direito proprio. Se so houver um pavimento, retorne um unico item. Pavimentos tipicos: "Subsolo", "Terreo", "Superior", "Sotao", "Cobertura". Use o rotulo presente no desenho se houver. Se nao for possivel ler altura especifica de um pavimento, omita-o (NAO chute).

Responda EXCLUSIVAMENTE com JSON valido, sem markdown:
{
  "pe_direito_m": 2.80,
  "por_pavimento": [
    { "pavimento": "Terreo", "pe_direito_m": 2.80 },
    { "pavimento": "Superior", "pe_direito_m": 2.50 }
  ],
  "confidence": "high",
  "observacoes": "frase curta opcional"
}`;
}

/**
 * Prompt do INVENTARIO classificado de paredes (usado pelo renderer SVG
 * deterministico). Pede ao Gemini 2.5 Pro: enumere cada parede da planta
 * como segmento de reta com endpoints (0-1000) + classe (externa/interna/
 * muro) + espessura. Output e usado pra renderizar overlay colorido no
 * backend via Sharp+SVG (annotation/renderer.ts).
 *
 * Substitui o gemini-2.5-flash-image (que sofria de sanduiche, legenda
 * invertida, cobertura incompleta). Aqui a IA so identifica geometria —
 * o desenho final e deterministico.
 */
export function buildWallInventoryPrompt(): string {
  return `TAREFA: enumere TODAS as paredes desta planta arquitetonica como segmentos de reta classificados.

REGRAS DE CLASSIFICACAO (cada parede recebe UMA UNICA classe):
- "externa": a parede da edificacao COBERTA com pelo menos uma face em contato com ambiente externo (rua, jardim, varanda/garagem aberta, divisa com vizinho). Forma o contorno do volume coberto.
- "interna": a parede esta DENTRO da edificacao coberta, separando dois comodos internos fechados (ex: SALA/QUARTO, COZINHA/BANHEIRO). Inclui divisorias finas (banheiro, closet, corredor).
- "muro": vedacao do TERRENO/LOTE, FORA da edificacao coberta (contorno do lote sem edificacao na mesma posicao).

HIERARQUIA quando ambigua: externa > interna > muro. Onde a parede externa da casa coincide com o limite do lote, classifique como EXTERNA (nao duplicar como muro).

PARA CADA parede que voce ve:
- p1: extremidade inicial (x, y) em coordenadas normalizadas 0-1000.
- p2: extremidade final (x, y) em coordenadas normalizadas 0-1000.
- thickness_pct: espessura aparente em % do lado maior da imagem (tipico 0.8 a 2.5).
- classe: "externa" | "interna" | "muro".

INSTRUCOES:
- Trace o segmento ao longo do EIXO CENTRAL da parede (no meio da espessura).
- Em cantos (L), divida em 2 segmentos.
- INCLUA TODAS as paredes — especialmente divisorias finas de banheiro/closet/corredor (sao as mais esquecidas).
- INCLUA muros se houver contorno de lote visivel.
- IGNORE mobiliario (sofa, cama, mesa, vaso, geladeira, carro).
- Coordenadas: (0,0) = canto superior esquerdo; x cresce para direita; y cresce para baixo.

Output JSON valido, sem texto antes ou depois, sem markdown:
{
  "segments": [
    { "p1": [120, 200], "p2": [480, 200], "thickness_pct": 1.2, "classe": "externa" },
    { "p1": [300, 200], "p2": [300, 400], "thickness_pct": 0.9, "classe": "interna" },
    ...
  ]
}

Casa residencial tipica: 15-40 segmentos. Plantas grandes: 50-100. Se passar de 150, voce esta confundindo mobiliario/cotas com paredes.`;
}

/**
 * Prompt para gerar a IMAGEM anotada via gemini-2.5-flash-image (Nano Banana),
 * estilo do Gemini Web chat. Estrategia centrada em AMBIENTES: pinta cada
 * comodo + suas paredes delimitadoras com a mesma cor coerente. Versao
 * enxuta que deixa o modelo "respirar" — versoes anteriores microgerenciavam
 * com regras geometricas e produziam sanduiches e paredes paralelas erradas.
 */
export function buildImageAnnotationPrompt(): string {
  return `Voce ve uma planta arquitetonica. Pinte a planta dividindo-a em 4 REGIOES CONTIGUAS coloridas (overlay semitransparente ~50% opacidade). Cada regiao COBRE inclusive as paredes que delimitam ela — as paredes ficam dentro da regiao, NAO sao pintadas separadamente.

============================================================
AS 4 REGIOES (uma camada unica)
============================================================

REGIAO VERMELHA (paredes externas + ambientes cobertos-abertos):
- Forma uma MOLDURA continua: a faixa de paredes externas da edificacao coberta inteira + o interior dos ambientes cobertos-abertos (garagem aberta, varanda coberta, alpendre, santuario sem porta). Tudo isso e UMA UNICA regiao vermelha conectada.

CRITICO — ESPESSURA DA FAIXA VERMELHA NAS PAREDES EXTERNAS:
- A faixa vermelha que cobre as paredes externas tem que ter EXATAMENTE A MESMA LARGURA das paredes no desenho. As paredes da planta tem uma espessura visivel (geralmente 15-25cm representados como faixa entre duas linhas paralelas) — a regiao vermelha COBRE TODA essa espessura, da linha externa ate a linha interna.
- NAO pinte uma linha fina vermelha. NAO pinte so o contorno externo. PINTE uma faixa GROSSA que vai EXATAMENTE de uma face da parede ate a outra face, cobrindo o miolo inteiro.
- Olhe a parede no desenho original: ela tem largura X. A faixa vermelha tem que ter LARGURA X tambem. Nem mais, nem menos.
- Posicione a faixa EXATAMENTE EM CIMA das paredes (nao do lado de fora delas, nao do lado de dentro — em cima delas, da exata largura delas).

- VALE PARA QUALQUER PAVIMENTO (subsolo, terreo, superior). Mesmo que o lado externo da parede de para terra/laje/nada desenhado, a parede do perimetro da edificacao coberta esta na regiao vermelha.

REGIAO VERDE CLARA (comodos internos fechados + paredes internas):
- Pinte todos os comodos internos fechados (sala, quarto, suite, banheiro, cozinha, copa, lavabo, closet, escritorio, corredor, hall, escada interna, deposito, despensa) cobrindo INCLUSIVE as paredes finas que separam dois desses comodos.
- As divisorias internas finas ficam COMPLETAMENTE COBERTAS pela regiao verde clara — desde uma face ate a outra face, cobrindo a espessura inteira da divisoria. Use a MESMA LARGURA das paredes no desenho.
- A regiao verde clara cobre tudo do interior coberto fechado ate o eixo central das paredes externas (onde encontra a regiao vermelha).

REGIAO VERDE ESCURA (areas externas descobertas):
- Jardim, grama, quintal, patio descoberto.

FAIXA AZUL (muros do lote — opcional):
- Apenas se houver linhas de muro CLARAS no perimetro do lote.

============================================================
COMO AS REGIOES SE ENCONTRAM (regra unica anti-sanduiche)
============================================================
Cada parede do desenho e FRONTEIRA entre duas regioes. Como cada regiao cobre tudo ate o eixo central das paredes vizinhas, cada parede e pintada UMA UNICA VEZ pela regiao de MAIOR PRIORIDADE que a toca:

PRIORIDADE: VERMELHO > VERDE CLARO > VERDE ESCURO > AZUL.

Exemplos:
- Parede entre SALA (verde claro) e QUARTO (verde claro) -> ambas verdes, parede toda verde clara (mancha continua).
- Parede entre SALA (verde claro) e JARDIM (verde escuro) -> uma face e externa da edificacao -> parede toda VERMELHA (faz parte da moldura externa).
- Parede entre SALA (verde claro) e GARAGEM aberta (vermelha) -> parede toda VERMELHA.
- Parede entre GARAGEM aberta e JARDIM -> parede toda VERMELHA (e externa da garagem).

POR CONSTRUCAO nao existe sanduiche: cada parede esta sob UMA UNICA regiao, sem faixas paralelas, sem duas cores na mesma parede.

============================================================
LEGENDA no canto inferior direito (4 linhas, nessa ordem)
============================================================
  [quadrado vermelho]      Paredes externas / Areas cobertas abertas
  [quadrado verde claro]   Paredes internas / Areas internas fechadas
  [quadrado verde escuro]  Areas externas descobertas (jardim)
  [quadrado azul]          Muros do lote

PRESERVE intactos: textos, cotas, simbolos, mobiliario, hachuras, carimbo, tabela do desenho, titulo, escala. NAO REDESENHE — apenas adicione as 4 regioes coloridas semitransparentes.

Mantenha o mesmo tamanho e proporcao da planta original.`;
}

/**
 * @deprecated Versao anterior, mantida para fallback/reversao manual.
 */
export function buildImageAnnotationPromptOld(): string {
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
COMO UMA PAREDE E DESENHADA NA PLANTA (LEIA COM ATENCAO)
============================================================
Em planta arquitetonica, CADA PAREDE e representada por DUAS LINHAS PARALELAS bem proximas (a face de um lado + a face do outro lado) com um MIOLO/ESPESSURA entre elas (geralmente preenchido com hachura, cinza, ou apenas vazio).

Essas duas linhas + o miolo = UMA UNICA PAREDE FISICA. NAO sao duas paredes diferentes. NAO sao "uma parede externa + uma parede interna". Sao UMA peca so.

Quando voce pinta uma parede com uma cor, pinte a PECA INTEIRA: cubra simultaneamente a linha de um lado, o miolo, e a linha do outro lado com UMA UNICA cor solida (50% opacidade). NUNCA pinte a face de um lado de uma cor e a face do outro lado de cor diferente. NUNCA pinte o miolo de cor diferente das faces.

ERRO TIPICO A EVITAR (chamado "sanduiche"): pintar a linha externa da parede de VERMELHO, o miolo de VERDE, e a linha interna de VERMELHO de novo. Isso esta ERRADO. A parede e UMA peca, recebe UMA cor.

============================================================
DEFINICOES — qual cor a parede inteira recebe
============================================================
PAREDE EXTERNA (VERMELHO): a PAREDE COMO UM TODO (suas 2 linhas + miolo) faz parte do contorno da edificacao coberta. Ou seja, a parede inteira separa o INTERIOR da casa de algum AMBIENTE EXTERNO (rua, jardim, quintal, varanda aberta, garagem aberta, divisa). Pista visual: do lado de FORA da parede ha jardim, calcada, rua, ar livre.

PAREDE INTERNA (VERDE): a PAREDE COMO UM TODO esta DENTRO da edificacao coberta, separando dois comodos internos fechados (ex: separa SALA de QUARTO; separa COZINHA de BANHEIRO; separa HALL de CORREDOR). Pista visual: dos DOIS LADOS da parede ha comodos rotulados (SALA, QUARTO, etc.) com piso desenhado.

MURO (AZUL): a peca como um todo e vedacao do TERRENO/LOTE, FORA da edificacao coberta. Pista visual: a linha esta no PERIMETRO do lote (separa jardim/grama do lote vizinho ou da rua), em local SEM edificacao coberta. Em plantas SUBSOLO/PAVIMENTO sem jardim ao redor, normalmente nao ha muro.

Em resumo: olhe para cada parede inteira como um objeto unico. Se a parede inteira esta na BORDA da casa -> VERMELHO. Se a parede inteira esta DENTRO da casa -> VERDE. Se e vedacao do lote sem edificacao na mesma posicao -> AZUL.

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

REGRA GEOMETRICA FUNDAMENTAL — PARALELO PROIBIDO, PERPENDICULAR PERMITIDO:
- Cores DIFERENTES podem se ENCOSTAR somente em angulo (perpendicular, em L, em T, em cruz). Quando uma parede VERDE chega na parede VERMELHA fazendo um T, a ponta delas se encontram em 90° — isso e CORRETO.
- Cores DIFERENTES NUNCA podem ser PARALELAS na MESMA direcao no MESMO trecho do desenho. Se voce ja pintou um trecho horizontal de VERMELHO, NUNCA pinte uma faixa VERDE horizontal colada/sobreposta a ele. Se voce ja pintou um trecho vertical de VERMELHO, NUNCA pinte uma faixa VERDE vertical encostada nele.
- Essa regra resolve a maior fonte de erros: marcar uma mesma parede com dois tipos diferentes. Isso traz IMPRECISAO. UMA parede recebe UMA classe; classes diferentes so se encontram em angulo, NUNCA paralelas no mesmo eixo.

EXEMPLOS GEOMETRICOS:
- CORRETO: parede vermelha horizontal no topo da casa. Parede verde vertical descendo dessa parede para dentro da casa. Elas se encontram em T — ponta a ponta. OK.
- ERRADO: parede vermelha horizontal no topo. E EM CIMA OU LOGO ABAIXO dela, uma faixa verde tambem horizontal. Duas cores paralelas no mesmo trecho = MESMA parede marcada como dois tipos. ERRADO. Apague a verde.

PROIBIDO:
- Pintar duas cores paralelas na mesma parede (ex: linha vermelha de um lado + linha verde do outro). LEMBRE que uma parede tem 2 LINHAS de face + miolo — TUDO isso e uma parede so e recebe UMA cor.
- "SANDUICHE": pintar a face de um lado da parede de vermelho, o miolo de verde, e a face do outro lado de vermelho de novo. Isso e o ERRO MAIS COMUM — pinte a peca INTEIRA de UMA cor.
- Desenhar uma faixa de cor PARALELA a uma parede ja pintada (uma parede e UMA peca unica, mesmo tendo duas linhas paralelas que sao suas faces).
- Trocar a cor no meio da parede.
- Encostar uma linha vermelha e uma linha azul paralelas (parede externa que coincide com limite do lote = uma peca so, cor vermelha).
- Encostar uma linha vermelha e uma linha verde paralelas no contorno externo da edificacao. Se a parede esta no contorno -> SO VERMELHO. Se ha uma parede interna que CHEGA nessa parede externa, ela termina ali em T, NAO vira uma faixa verde paralela ao lado da vermelha.

AUTOCHECAGEM ANTES DE FINALIZAR:
Olhe a imagem que voce pintou. Percorra cada trecho de parede:
1. Existe um trecho onde aparecem duas cores diferentes UMA AO LADO DA OUTRA, na mesma direcao (ambas horizontais ou ambas verticais)? Isso e ERRO. Apague uma das duas. A regra de prevalencia: VERMELHO > VERDE > AZUL. Mantenha a de maior prevalencia.
2. Existe parede onde a cor de cada FACE e diferente da cor do MIOLO (sanduiche)? Isso e ERRO. Reescolha UMA cor para a peca toda.
3. Onde duas cores diferentes se encontram, elas se encontram em ANGULO (T, L, cruz, 90°), nao paralelas? Se sim, OK.

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

/**
 * Caracterizacao do projeto: tipologia + programa + padrao construtivo.
 * Roda 1 vez por projeto, em cima da primeira planta_baixa + totais ja
 * extraidos como contexto. Usado para enriquecer o card de resumo e
 * para validacoes de sanity-check (A3).
 */
export function buildCharacterizationPrompt(args: {
  paredesExternasM2: number;
  paredesInternasM2: number;
  murosM2: number;
  lajePisoM2: number;
  lajeCobertaM2: number;
  paginas: number;
}): string {
  return `Voce ve a primeira planta_baixa de um projeto arquitetonico. Use a imagem e os totais ja extraidos abaixo para caracterizar o projeto.

TOTAIS JA EXTRAIDOS (referencia, nao recalcule):
- Paredes externas liquida: ${args.paredesExternasM2.toFixed(1)} m²
- Paredes internas liquida: ${args.paredesInternasM2.toFixed(1)} m²
- Muros: ${args.murosM2.toFixed(1)} m²
- Laje piso (total): ${args.lajePisoM2.toFixed(1)} m²
- Laje coberta (total): ${args.lajeCobertaM2.toFixed(1)} m²
- Numero de pavimentos detectados: ${args.paginas}

TAREFA: classifique tipologia, conte programa de ambientes e estime padrao construtivo.

DEFINICOES:
- tipologia: "casa_terrea" (1 pavimento, programa residencial), "sobrado" (2+ pavimentos residenciais), "edificio" (3+ pavimentos com escada/elevador central, multi-unidade), "comercial" (lojas, escritorios, galpao), "misto" (residencial + comercial), "outro".
- programa: conte ambientes ROTULADOS na planta. Use 0 se nao identificar.
- padrao: "popular" (cobogo, sem acabamentos, area construida <80m²), "medio" (acabamentos basicos, 80-200m²), "alto" (suite com hidro, varandas grandes, lavabo separado, area construida >200m²).

Responda EXCLUSIVAMENTE com JSON valido, sem markdown:
{
  "tipologia": "casa_terrea" | "sobrado" | "edificio" | "comercial" | "misto" | "outro",
  "programa": {
    "quartos": 0,
    "suites": 0,
    "salas": 0,
    "banheiros": 0,
    "cozinhas": 0,
    "garagens": 0,
    "outros": ["lavabo", "varanda", "area de servico"]
  },
  "padrao": "popular" | "medio" | "alto",
  "areaConstruidaEstimada_m2": 0,
  "confidence": "high" | "medium" | "low",
  "observacoes": "1 frase curta justificando classificacao"
}`;
}

/**
 * Sanity-check pos-extracao: olha os totais consolidados + characterization
 * e levanta findings de plausibilidade. NAO faz nova extracao — so valida.
 * Gemini Flash, 1 chamada, sem imagem (puro JSON input).
 */
export function buildSanityCheckPrompt(args: {
  tipologia: string;
  padrao: string;
  programa: string;
  areaConstruidaEstimada_m2: number;
  paredesExternasM2: number;
  paredesInternasM2: number;
  murosM2: number;
  lajePisoM2: number;
  lajeCobertaM2: number;
  totalAberturasM2: number;
  paginas: number;
  peDireitoM: number;
}): string {
  return `Voce e um auditor de quantitativos de obra. Analise os valores abaixo extraidos de uma planta arquitetonica e identifique inconsistencias DE PLAUSIBILIDADE (nao recalcule — so verifique se faz sentido).

VALORES EXTRAIDOS:
- Tipologia: ${args.tipologia} (${args.padrao})
- Programa: ${args.programa}
- Area construida estimada: ${args.areaConstruidaEstimada_m2.toFixed(0)} m²
- Numero de pavimentos (paginas planta_baixa): ${args.paginas}
- Pe-direito: ${args.peDireitoM.toFixed(2)} m
- Paredes externas (liquida): ${args.paredesExternasM2.toFixed(1)} m²
- Paredes internas (liquida): ${args.paredesInternasM2.toFixed(1)} m²
- Muros: ${args.murosM2.toFixed(1)} m²
- Laje de piso: ${args.lajePisoM2.toFixed(1)} m²
- Laje de cobertura: ${args.lajeCobertaM2.toFixed(1)} m²
- Total de aberturas (portas+janelas): ${args.totalAberturasM2.toFixed(1)} m²

REGRAS DE SANIDADE (exemplos — voce decide o que e relevante):
- Casa terrea tipica: parede ext ~30-80m² por pavimento (depende de area construida). Sobrado dobra. Galpao tem muito mais.
- Parede interna geralmente entre 0.5x a 2x da externa em residencial.
- Muros > 0 so se ha lote em torno (casa terrea/sobrado tipico).
- Laje piso ~ area construida. Laje coberta similar (ou maior se ha beiral).
- Aberturas tipicamente sao 8-25% da area de paredes externas liquida.
- ext_liquida = ext_bruta - aberturas; se aberturas_total > ext_bruta, ALGO ESTA ERRADO.
- Numero de pavimentos consistente com tipologia (sobrado = 2+, edificio = 3+).

Liste APENAS os findings relevantes (severidade != "info"). NAO repita o obvio. Se tudo parece OK, retorne array vazio.

Severidade:
- "warning": valor atipico mas pode ser real (ex: muros = 0 num projeto que parece ter lote).
- "error": valor claramente impossivel ou contraditorio (ex: laje_piso = 0 com paredes > 0).

Responda EXCLUSIVAMENTE com JSON valido, sem markdown:
{
  "findings": [
    { "severity": "warning" | "error", "categoria": "paredes_externas" | "paredes_internas" | "muros" | "laje_piso" | "laje_coberta" | "aberturas" | "geral", "mensagem": "explicacao curta" }
  ]
}`;
}

export function buildAreaPrompt(
  peDireitoM: number,
  peDireitoPorPavimento?: Record<string, number>,
): string {
  const mapEntries = peDireitoPorPavimento
    ? Object.entries(peDireitoPorPavimento).filter(([, v]) => Number.isFinite(v) && v > 0)
    : [];
  const heightHint =
    mapEntries.length > 1
      ? `Pe-direito por pavimento: ${mapEntries
          .map(([k, v]) => `${k}=${v.toFixed(2)}m`)
          .join(", ")}. PRIMEIRO identifique o pavimento desta planta; em seguida use o pe-direito CORRESPONDENTE. Se nao corresponder a nenhum, use ${peDireitoM.toFixed(2)}m (predominante).`
      : `Pe-direito = ${peDireitoM.toFixed(2)}m.`;
  return `Engenheiro orcamentista. Meca areas em m² desta planta. ${heightHint}

DEFINICOES (hierarquia: externa > interna > muro — cada parede UMA UNICA classe):
- EXTERNA: parede da EDIFICACAO COBERTA com ao menos 1 face fora da residencia (rua, jardim, quintal, varanda/garagem ABERTA, divisa com vizinho).
- INTERNA: ambas as faces em comodos internos cobertos+fechados. So conta paredes do piso ao teto. Inclui divisorias finas (banheiro, closet, corredor, despensa, drywall).
- MURO: vedacao do TERRENO/LOTE, FORA da edificacao coberta. SINAL VISUAL: a planta mostra areas verdes (jardim/grama) ou cinzas (calcada/passeio/piso descoberto) AO REDOR da edificacao, e ha linhas no perimetro dessas areas externas. O contorno do lote ESTA presente quando a planta mostra "terreno" (jardim/quintal/garagem) alem do volume coberto. Se a planta mostra SO o interior da edificacao (sem terreno ao redor, ex: apartamento, pavimento superior, subsolo enterrado) -> muros = 0.
- LAJE PISO: area horizontal coberta+fechada (exclui varanda aberta, jardim, garagem aberta).
- LAJE COBERTA: = laje_piso, salvo se houver linhas tracejadas de beiral no perimetro (entao maior).

IMPORTANTE — REGRA ANTI-PARALELA / NAO SOBREPOR CLASSES: cada trecho geometrico de parede no desenho recebe UMA UNICA classificacao. Classes diferentes (externa, interna, muro) NUNCA podem coexistir no MESMO trecho de parede no MESMO sentido/direcao. So podem se ENCONTRAR em angulo (em T, em L, perpendiculares) — quando uma parede interna chega na parede externa do contorno da casa fazendo um T, a interna TERMINA ali, ela NAO continua paralela ao longo da externa. Onde tem parede EXTERNA num trecho, esse trecho INTEIRO e externa (nao some uma interna paralela colada nela). Hierarquia de prevalencia: externa > interna > muro.

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
