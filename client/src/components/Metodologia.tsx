import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function Metodologia() {
  return (
    <div className="space-y-6" data-testid="section-metodologia">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Metodologia de Orcamentacao Parametrica Lightwall</CardTitle>
          <p className="text-sm text-muted-foreground">
            Este documento descreve em detalhes o processo completo de analise, extracao, calculo e orcamentacao
            utilizado pelo sistema para gerar propostas comerciais no padrao Lightwall.
          </p>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" defaultValue={["visao-geral", "pipeline", "ia-avancada", "produto", "calculo", "premissas", "proposta", "validacao", "acuracia"]} className="space-y-2">

            <AccordionItem value="visao-geral">
              <AccordionTrigger className="text-base font-semibold">
                1. Visao Geral do Processo
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm leading-relaxed">
                  <p>
                    O sistema utiliza inteligencia artificial (Google Gemini 2.5 Pro) para interpretar plantas arquitetonicas
                    em formato PDF ou imagem, extraindo automaticamente as informacoes necessarias para gerar um orcamento
                    parametrico de paineis Lightwall.
                  </p>
                  <p>
                    O processo e dividido em <strong>8 etapas sequenciais</strong> (pipeline), com uma etapa adicional de
                    <strong> verificacao por IA</strong> (etapa 3.5). As etapas 1 a 3 utilizam IA para extracao de dados com
                    processamento pagina-a-pagina e raciocinio encadeado (chain-of-thought), a etapa 3.5 verifica e corrige
                    os dados extraidos, a etapa 4 funde informacoes de multiplas vistas com validacao cruzada,
                    as etapas 5 e 6 realizam calculos deterministicos, a etapa 7 valida os resultados e a etapa 8 gera
                    uma descricao tecnica do projeto.
                  </p>
                  <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 mt-3">
                    <p className="font-medium mb-2">Fluxo resumido:</p>
                    <p className="text-xs font-mono">
                      Upload PDF/Imagens → Divisao Pagina-a-Pagina → Classificacao (IA + CoT) → Extracao de Tabelas (IA + CoT)
                      → Extracao Geometrica (IA + CoT + Few-Shot) → Verificacao IA → Fusao Multivista + Validacao Cruzada
                      → Calculo Deterministico → Integracao Catalogo → Validacao → Descricao do Projeto (IA)
                    </p>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="pipeline">
              <AccordionTrigger className="text-base font-semibold">
                2. Pipeline de 8 Etapas em Detalhe
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-5 text-sm leading-relaxed">
                  <div>
                    <h4 className="font-semibold text-primary mb-1">Etapa 1 — Classificacao de Paginas</h4>
                    <p>
                      O sistema divide PDFs multi-pagina em paginas individuais e envia cada pagina separadamente para a IA.
                      Cada pagina e classificada em uma das seguintes categorias:
                    </p>
                    <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                      <li><strong>planta_baixa</strong> — Planta baixa (layout dos ambientes)</li>
                      <li><strong>planta_cobertura</strong> — Planta de cobertura</li>
                      <li><strong>corte</strong> — Corte transversal ou longitudinal</li>
                      <li><strong>fachada</strong> — Elevacao/fachada</li>
                      <li><strong>tabela_quantitativo</strong> — Tabela de quantitativos</li>
                      <li><strong>quadro_esquadrias</strong> — Quadro de esquadrias (portas e janelas)</li>
                      <li><strong>detalhe_construtivo</strong> — Detalhe construtivo</li>
                      <li><strong>irrelevante</strong> — Pagina sem informacao util</li>
                    </ul>
                    <p className="mt-2">
                      A IA usa <strong>raciocinio encadeado</strong> (chain-of-thought) para justificar a classificacao
                      antes de emitir o resultado, aumentando a precisao.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-primary mb-1">Etapa 2 — Extracao de Tabelas</h4>
                    <p>
                      Paginas classificadas como <em>tabela_quantitativo</em> ou <em>quadro_esquadrias</em> (ou que contenham tabelas)
                      sao processadas individualmente para extrair dados tabulares estruturados:
                    </p>
                    <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                      <li><strong>paredes_de_tabela</strong> — Paredes com comprimento, altura, tipo (interna/externa)</li>
                      <li><strong>esquadrias_de_tabela</strong> — Portas e janelas com dimensoes (LxH), codigo, quantidade</li>
                      <li><strong>areas_de_tabela</strong> — Areas de ambientes (nome, area em m2, pavimento)</li>
                    </ul>
                    <p className="mt-2">
                      Dados de tabela tem <strong>precedencia absoluta</strong> sobre dados extraidos visualmente.
                      A IA inclui exemplos concretos de conversao (cm → m) e formatos esperados.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-primary mb-1">Etapa 3 — Extracao Geometrica (Pagina-a-Pagina)</h4>
                    <p>
                      A IA analisa <strong>cada pagina individualmente</strong> (em vez do documento inteiro) para extrair:
                    </p>
                    <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                      <li><strong>Paredes</strong> — Comprimento, altura, tipo (interna/externa), esquadrias embutidas</li>
                      <li><strong>Lajes</strong> — Tipo (piso/cobertura), area, pavimento</li>
                      <li><strong>Cantos 90 graus</strong> — Juncoes de paredes perpendiculares</li>
                    </ul>
                    <p className="mt-2">
                      O prompt utiliza <strong>raciocinio obrigatorio em 5 passos</strong>: (1) leitura de todas as cotas,
                      (2) identificacao de ambientes, (3) mapeamento de cada trecho de parede, (4) identificacao de esquadrias,
                      (5) calculo de lajes e cantos. Alem disso, inclui <strong>exemplos concretos</strong> (few-shot) de como
                      converter cotas e gerar o JSON correto.
                    </p>
                    <p className="mt-2">
                      Se a extracao pagina-a-pagina nao detectar nenhuma parede, o sistema faz uma tentativa adicional
                      com o documento completo como fallback.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-primary mb-1">Etapa 3.5 — Verificacao por IA</h4>
                    <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 mt-2">
                      <p>
                        Etapa adicional de controle de qualidade. A IA recebe os dados extraidos na etapa anterior
                        junto com a imagem original e verifica 7 criterios:
                      </p>
                      <ol className="list-decimal list-inside mt-2 space-y-1 text-xs text-muted-foreground">
                        <li>Contagem total de paredes vs. paredes visiveis na planta</li>
                        <li>Comprimentos vs. cotas dimensionais lidas na imagem</li>
                        <li>Classificacao correta de paredes externas vs. internas</li>
                        <li>Esquadrias nas paredes corretas</li>
                        <li>Area de laje vs. soma de areas dos comodos</li>
                        <li>Paredes visiveis nao extraidas (faltantes)</li>
                        <li>Erros de conversao de unidade (cm vs. m)</li>
                      </ol>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Se encontrar erros, a IA retorna o JSON corrigido. Se os dados estiverem corretos, aprova sem alteracoes.
                      </p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-primary mb-1">Etapa 4 — Fusao Multivista com Validacao Cruzada</h4>
                    <p>
                      Combina dados de multiplas paginas e vistas em uma unica representacao consolidada:
                    </p>
                    <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                      <li>Deduplicacao de paredes por assinatura (comprimento + tipo + pavimento)</li>
                      <li>Aplicacao de precedencia de tabelas sobre dados visuais</li>
                      <li><strong>Correcao de areas de laje</strong> usando dados de tabela quando a discrepancia e &gt; 15%</li>
                      <li><strong>Deteccao automatica de unidades</strong>: se um comprimento &gt; 50 ou altura &gt; 10, e convertido de cm para m</li>
                      <li>Auto-geracao de lajes ausentes a partir do perimetro de paredes externas</li>
                      <li>Reclassificacao de piso terreo como radier (excluido do calculo)</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold text-primary mb-1">Etapa 5 — Calculo Deterministico</h4>
                    <p>
                      Calculo matematico exato (sem IA) da quantidade de paineis necessarios.
                      Detalhes completos na secao "Metodo de Calculo" abaixo.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-primary mb-1">Etapa 6 — Integracao com Catalogo</h4>
                    <p>
                      Associa as quantidades calculadas ao catalogo de produtos Lightwall, aplicando os precos unitarios
                      (R$ 275,00/m2) e gerando a proposta comercial no formato padrao com 4 categorias de aplicacao
                      mais Projeto de Paginacao.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-primary mb-1">Etapa 7 — Validacao</h4>
                    <p>
                      Verifica consistencia dos resultados e gera alertas em 3 niveis:
                    </p>
                    <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                      <li><strong>Critica</strong> — Problemas graves (ex: area total zero, pavimento sem paredes)</li>
                      <li><strong>Media</strong> — Inconsistencias que merecem atencao (ex: proporcao paredes ext/int incomum)</li>
                      <li><strong>Baixa</strong> — Observacoes informativas (ex: premissas aplicadas automaticamente)</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold text-primary mb-1">Etapa 8 — Descricao do Projeto</h4>
                    <p>
                      A IA analisa todas as imagens do projeto e gera uma descricao tecnica em formato de topicos,
                      com foco em orcamento e quantitativos: identificacao, distribuicao por pavimento, alertas e ressalvas.
                    </p>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="ia-avancada">
              <AccordionTrigger className="text-base font-semibold">
                3. Tecnicas Avancadas de IA
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-5 text-sm leading-relaxed">
                  <div>
                    <h4 className="font-semibold mb-2">3.1 Processamento Pagina-a-Pagina</h4>
                    <p>
                      PDFs com multiplas paginas sao divididos em paginas individuais usando pdf-lib.
                      Cada pagina e enviada separadamente para a IA, o que permite:
                    </p>
                    <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                      <li>Foco total da IA em uma unica pagina, sem confusao entre pavimentos</li>
                      <li>Classificacao e extracao mais precisa por pagina</li>
                      <li>Contexto especifico do pavimento para cada extracao</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">3.2 Raciocinio Encadeado (Chain-of-Thought)</h4>
                    <p>
                      Todos os prompts de IA exigem que o modelo <strong>raciocine passo a passo</strong> antes de gerar
                      o resultado JSON. O raciocinio e delimitado por tags &lt;RACIOCINIO&gt; e e registrado nos logs
                      para auditoria. Esse mecanismo:
                    </p>
                    <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                      <li>Forca a IA a ler e listar todas as cotas antes de extrair paredes</li>
                      <li>Obriga a identificacao de ambientes e suas areas</li>
                      <li>Reduz erros de conversao cm/m (a IA precisa justificar a conversao)</li>
                      <li>Melhora a contagem de paredes ao exigir mapeamento sistematico</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">3.3 Exemplos Concretos (Few-Shot Prompting)</h4>
                    <p>
                      Os prompts de extracao geometrica incluem <strong>3 exemplos reais</strong> que mostram ao modelo
                      exatamente como deve ser o JSON de saida para diferentes situacoes:
                    </p>
                    <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                      <li><strong>Exemplo 1</strong> — Parede externa com porta: cota "850" → 8.50m, com esquadria P1</li>
                      <li><strong>Exemplo 2</strong> — Parede interna sem esquadria: cota "3.50" → 3.50m</li>
                      <li><strong>Exemplo 3</strong> — Laje de piso: soma de areas dos comodos = area total</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">3.4 Dupla Verificacao (Verificacao por IA)</h4>
                    <p>
                      Apos a extracao inicial, uma segunda chamada de IA atua como <strong>revisor tecnico</strong>,
                      comparando os dados extraidos com a imagem original. Se encontrar erros
                      (paredes faltantes, comprimentos errados, classificacao incorreta), corrige e retorna o JSON atualizado.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">3.5 Temperature Baixa e Configuracao</h4>
                    <p>
                      Todas as chamadas de extracao usam <strong>temperature 0.1</strong> para maximizar a determinismo
                      e reprodutibilidade. A temperatura para descricao de projeto (etapa 8) e ligeiramente mais alta (0.3)
                      para permitir texto mais natural.
                    </p>
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 mt-2">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><span className="text-muted-foreground">Modelo:</span> <span className="font-mono">gemini-2.5-pro</span></div>
                        <div><span className="text-muted-foreground">Temperature (extracao):</span> <span className="font-mono">0.1</span></div>
                        <div><span className="text-muted-foreground">Temperature (descricao):</span> <span className="font-mono">0.3</span></div>
                        <div><span className="text-muted-foreground">Max tokens:</span> <span className="font-mono">16384 (geometria)</span></div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">3.6 Validacao Cruzada de Dados</h4>
                    <p>
                      Na etapa de fusao, o sistema cruza dados de diferentes fontes para corrigir inconsistencias:
                    </p>
                    <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                      <li>Areas de tabela prevalecem sobre areas estimadas visualmente (tolerancia de 15%)</li>
                      <li>Dimensoes de esquadrias de tabela atualizam as extraidas visualmente</li>
                      <li>Comprimentos &gt; 50m sao automaticamente convertidos de cm para m</li>
                      <li>Alturas &gt; 10m sao automaticamente convertidas de cm para m</li>
                    </ul>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="produto">
              <AccordionTrigger className="text-base font-semibold">
                4. Produto Lightwall — Especificacoes
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm leading-relaxed">
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-2">PAINEL DE CONCRETO LEVE 3000x610x90MM 2P</h4>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">Dimensoes</p>
                        <p className="font-medium">3.000 mm x 610 mm x 90 mm</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Area por painel</p>
                        <p className="font-medium">1,83 m2 (3,00 x 0,61)</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Tipo</p>
                        <p className="font-medium">2P (duas placas)</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Preco unitario</p>
                        <p className="font-medium">R$ 275,00 / m2</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">SKU</p>
                        <p className="font-medium">LW-2P-090</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Aplicacao</p>
                        <p className="font-medium">Paredes e lajes (universal)</p>
                      </div>
                    </div>
                  </div>

                  <p>
                    <strong>Importante:</strong> O mesmo tipo de painel (2P) e utilizado para todas as aplicacoes:
                    paredes externas, paredes internas, laje de piso e laje de cobertura. Nao ha distincao de produto
                    entre paredes e lajes — a diferenciacao e apenas por local de aplicacao na proposta comercial.
                  </p>

                  <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <h4 className="font-semibold text-green-800 dark:text-green-300 mb-2">Projeto de Paginacao (BIM)</h4>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">Descricao</p>
                        <p className="font-medium">Projeto de paginacao em BIM</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Preco unitario</p>
                        <p className="font-medium">R$ 11,00 / m2</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">SKU</p>
                        <p className="font-medium">PROJ-PAG</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Base de calculo</p>
                        <p className="font-medium">Area total de paineis (m2)</p>
                      </div>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="calculo">
              <AccordionTrigger className="text-base font-semibold">
                5. Metodo de Calculo
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-5 text-sm leading-relaxed">
                  <div>
                    <h4 className="font-semibold mb-2">5.1 Calculo de Paineis para Paredes</h4>
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 font-mono text-xs space-y-2">
                      <p>1. Area bruta da parede = comprimento x altura</p>
                      <p>2. Area de aberturas = soma (largura x altura) de cada esquadria</p>
                      <p>3. Percentual de aberturas = area_aberturas / area_bruta x 100</p>
                      <p>4. Area liquida = area_bruta - area_aberturas</p>
                      <p>5. Coeficiente de perda:</p>
                      <p className="pl-4">• Se aberturas ≤ 20% da area bruta: perda = 5%</p>
                      <p className="pl-4">• Se aberturas &gt; 20% da area bruta: perda = 8%</p>
                      <p>6. Area com perda = area_liquida x (1 + coeficiente_perda)</p>
                      <p>7. Quantidade de paineis = arredondar para cima (area_com_perda / 1,83)</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">5.2 Calculo de Paineis para Lajes</h4>
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 font-mono text-xs space-y-2">
                      <p>1. Area da laje = area informada na planta (ou soma das areas dos comodos)</p>
                      <p>2. Coeficiente de perda = 10% (fixo para lajes)</p>
                      <p>3. Area com perda = area_laje x 1,10</p>
                      <p>4. Quantidade de paineis = arredondar para cima (area_com_perda / 1,83)</p>
                    </div>
                    <p className="mt-2 text-muted-foreground">
                      <strong>Excecao:</strong> Lajes de piso do pavimento terreo (radier) sao excluidas do calculo,
                      pois o radier utiliza fundacao convencional, nao paineis Lightwall.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">5.3 Calculo de Custos</h4>
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 font-mono text-xs space-y-2">
                      <p><strong>Para cada categoria (Paredes Ext, Int, Laje Piso, Coberta):</strong></p>
                      <p>1. Quantidade (un) = total de paineis da categoria</p>
                      <p>2. Area total (m2) = quantidade x 1,83</p>
                      <p>3. Custo = area_total x R$ 275,00/m2</p>
                      <p></p>
                      <p><strong>Projeto de Paginacao:</strong></p>
                      <p>1. Area total = soma de todas as areas das 4 categorias</p>
                      <p>2. Custo paginacao = area_total x R$ 11,00/m2</p>
                      <p></p>
                      <p><strong>Total Geral:</strong></p>
                      <p>Total = custo_total_paineis + custo_paginacao</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">5.4 Agrupamento por Pavimento</h4>
                    <p>
                      Os paineis sao agrupados por pavimento e, dentro de cada pavimento, divididos em 4 categorias:
                    </p>
                    <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                      <li><strong>Paredes Externas</strong> — Paredes de fachada e divisa</li>
                      <li><strong>Paredes Internas</strong> — Divisorias internas entre ambientes</li>
                      <li><strong>Laje de Piso</strong> — Laje do piso do pavimento (exceto terreo/radier)</li>
                      <li><strong>Laje de Cobertura</strong> — Laje da cobertura do pavimento</li>
                    </ul>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="premissas">
              <AccordionTrigger className="text-base font-semibold">
                6. Premissas e Valores Padrao
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm leading-relaxed">
                  <p>
                    Quando uma dimensao nao e legivel ou nao esta presente na planta, o sistema aplica valores padrao
                    (premissas). O raciocinio encadeado (chain-of-thought) da IA ajuda a identificar quais dimensoes
                    foram lidas e quais usaram premissas, registrando a informacao no campo measurement_source.
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b-2">
                          <th className="text-left p-2 font-semibold">Elemento</th>
                          <th className="text-left p-2 font-semibold">Propriedade</th>
                          <th className="text-right p-2 font-semibold">Valor Padrao</th>
                          <th className="text-left p-2 font-semibold">Unidade</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b"><td className="p-2">Parede</td><td className="p-2">Altura (pe-direito)</td><td className="p-2 text-right font-mono">3,00</td><td className="p-2">m</td></tr>
                        <tr className="border-b"><td className="p-2">Porta</td><td className="p-2">Largura</td><td className="p-2 text-right font-mono">0,80</td><td className="p-2">m</td></tr>
                        <tr className="border-b"><td className="p-2">Porta</td><td className="p-2">Altura</td><td className="p-2 text-right font-mono">2,10</td><td className="p-2">m</td></tr>
                        <tr className="border-b"><td className="p-2">Janela comum</td><td className="p-2">Largura</td><td className="p-2 text-right font-mono">1,20</td><td className="p-2">m</td></tr>
                        <tr className="border-b"><td className="p-2">Janela comum</td><td className="p-2">Altura</td><td className="p-2 text-right font-mono">1,00</td><td className="p-2">m</td></tr>
                        <tr className="border-b"><td className="p-2">Janela comum</td><td className="p-2">Peitoril</td><td className="p-2 text-right font-mono">1,10</td><td className="p-2">m</td></tr>
                        <tr className="border-b"><td className="p-2">Janela alta</td><td className="p-2">Altura</td><td className="p-2 text-right font-mono">0,60</td><td className="p-2">m</td></tr>
                        <tr className="border-b"><td className="p-2">Janela alta</td><td className="p-2">Peitoril</td><td className="p-2 text-right font-mono">1,50</td><td className="p-2">m</td></tr>
                        <tr className="border-b"><td className="p-2">Piso terreo</td><td className="p-2">Tipo de fundacao</td><td className="p-2 text-right font-mono">radier</td><td className="p-2">—</td></tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                    <h4 className="font-semibold text-amber-800 dark:text-amber-300 mb-2">Coeficientes de Perda</h4>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                      <li><strong>Paredes com aberturas ≤ 20%:</strong> 5% de perda por recortes e ajustes</li>
                      <li><strong>Paredes com aberturas &gt; 20%:</strong> 8% de perda por recortes mais complexos</li>
                      <li><strong>Lajes (todas):</strong> 10% de perda fixa</li>
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Os coeficientes de perda compensam desperdicios de material devido a recortes, ajustes dimensionais
                      e eventuais danos durante a instalacao.
                    </p>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="proposta">
              <AccordionTrigger className="text-base font-semibold">
                7. Formato da Proposta Comercial
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm leading-relaxed">
                  <p>
                    A proposta comercial gerada segue o formato padrao utilizado pela Lightwall em suas propostas reais.
                    O formato consiste em:
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b-2 bg-slate-50 dark:bg-slate-800">
                          <th className="text-left p-2">Item</th>
                          <th className="text-left p-2">Local de Aplicacao</th>
                          <th className="text-left p-2">Discriminacao</th>
                          <th className="text-right p-2">Qtd (Un)</th>
                          <th className="text-right p-2">Qtd (m2)</th>
                          <th className="text-right p-2">Preco (m2)</th>
                          <th className="text-right p-2">Preco Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b"><td className="p-2">1</td><td className="p-2">Paredes Externas</td><td className="p-2 text-xs">Painel de Concreto Leve 3000x610x90mm 2P</td><td className="p-2 text-right">—</td><td className="p-2 text-right">—</td><td className="p-2 text-right">R$ 275,00</td><td className="p-2 text-right">—</td></tr>
                        <tr className="border-b"><td className="p-2">2</td><td className="p-2">Paredes Internas</td><td className="p-2 text-xs">Painel de Concreto Leve 3000x610x90mm 2P</td><td className="p-2 text-right">—</td><td className="p-2 text-right">—</td><td className="p-2 text-right">R$ 275,00</td><td className="p-2 text-right">—</td></tr>
                        <tr className="border-b"><td className="p-2">3</td><td className="p-2">Laje de Piso</td><td className="p-2 text-xs">Painel de Concreto Leve 3000x610x90mm 2P</td><td className="p-2 text-right">—</td><td className="p-2 text-right">—</td><td className="p-2 text-right">R$ 275,00</td><td className="p-2 text-right">—</td></tr>
                        <tr className="border-b"><td className="p-2">4</td><td className="p-2">Laje Coberta</td><td className="p-2 text-xs">Painel de Concreto Leve 3000x610x90mm 2P</td><td className="p-2 text-right">—</td><td className="p-2 text-right">—</td><td className="p-2 text-right">R$ 275,00</td><td className="p-2 text-right">—</td></tr>
                        <tr className="border-b-2 font-semibold"><td className="p-2" colSpan={3}>TOTAL PAINEIS</td><td className="p-2 text-right">—</td><td className="p-2 text-right">—</td><td className="p-2"></td><td className="p-2 text-right">—</td></tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4">
                    <p className="font-medium mb-2">Projeto de Paginacao</p>
                    <p className="text-xs text-muted-foreground">
                      Projeto de paginacao das paredes e lajes em BIM, cobrado sobre a area total de paineis
                      a R$ 11,00/m2. Este servico garante a otimizacao da modulacao e compatibilizacao com
                      as instalacoes eletrica e hidraulica.
                    </p>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4">
                    <p className="font-medium mb-2">Custos Complementares (Estimativas)</p>
                    <p className="text-xs text-muted-foreground">
                      Alem dos paineis e do projeto de paginacao, o sistema estima custos complementares para referencia,
                      que <strong>nao fazem parte do valor da proposta principal</strong>:
                    </p>
                    <ul className="list-disc list-inside mt-2 space-y-1 text-xs text-muted-foreground">
                      <li>Conectores metalicos (estimativa: 4 unidades por painel)</li>
                      <li>Parafusos de fixacao (estimativa: 8 unidades por painel)</li>
                      <li>Mao de obra de instalacao (estimativa baseada em horas por painel)</li>
                    </ul>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="validacao">
              <AccordionTrigger className="text-base font-semibold">
                8. Validacao e Controle de Qualidade
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm leading-relaxed">
                  <p>
                    O sistema aplica verificacoes em <strong>dois niveis</strong>: verificacao por IA (etapa 3.5,
                    que compara extracao com imagem original) e validacao deterministica (etapa 7, que verifica
                    consistencia dos dados calculados).
                  </p>

                  <div className="space-y-3">
                    <div className="flex items-start gap-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
                      <span className="text-red-600 dark:text-red-400 font-bold text-xs mt-0.5">CRITICA</span>
                      <div className="text-xs">
                        <p className="font-medium">Problemas graves que podem invalidar o orcamento</p>
                        <p className="text-muted-foreground mt-1">Exemplos: area total zero, pavimento sem nenhuma parede detectada, dimensoes fisicamente impossiveis</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                      <span className="text-amber-600 dark:text-amber-400 font-bold text-xs mt-0.5">MEDIA</span>
                      <div className="text-xs">
                        <p className="font-medium">Inconsistencias que merecem revisao manual</p>
                        <p className="text-muted-foreground mt-1">Exemplos: proporcao ext/int incomum, variacao grande de comprimentos, area de aberturas elevada</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                      <span className="text-blue-600 dark:text-blue-400 font-bold text-xs mt-0.5">BAIXA</span>
                      <div className="text-xs">
                        <p className="font-medium">Observacoes informativas</p>
                        <p className="text-muted-foreground mt-1">Exemplos: premissas de dimensao aplicadas, laje auto-gerada a partir de areas de ambiente</p>
                      </div>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="acuracia">
              <AccordionTrigger className="text-base font-semibold">
                9. Acuracia e Medicao de Qualidade
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm leading-relaxed">
                  <p>
                    O sistema possui um mecanismo de medicao de acuracia para projetos marcados como "Teste".
                    Esses projetos permitem inserir o custo real e o <strong>m² real por categoria</strong>
                    (paredes externas, paredes internas, laje de piso, laje coberta) para comparar com os
                    valores gerados automaticamente.
                  </p>

                  <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 font-mono text-xs space-y-2">
                    <p><strong>Formula de Acuracia por m² (primaria):</strong></p>
                    <p>acuracia_categoria = max(0, (1 - |m²_calculado - m²_real| / m²_real)) x 100%</p>
                    <p>acuracia_global = media ponderada das acuracias por categoria (peso = m² real)</p>
                    <p></p>
                    <p><strong>Formula de Acuracia por R$ (secundaria):</strong></p>
                    <p>acuracia = max(0, (1 - |custo_calculado - custo_real| / custo_real)) x 100%</p>
                    <p></p>
                    <p><strong>Classificacao:</strong></p>
                    <p className="pl-4 text-emerald-600">• ≥ 90% — Excelente (verde)</p>
                    <p className="pl-4 text-amber-600">• ≥ 70% — Aceitavel (amarelo)</p>
                    <p className="pl-4 text-red-600">• &lt; 70% — Necessita revisao (vermelho)</p>
                  </div>

                  <p>
                    Quando o m² real por categoria esta disponivel, a <strong>acuracia por m²</strong> e usada
                    como metrica principal, pois compara quantitativos diretamente e evita que erros entre
                    categorias se anulem. A acuracia monetaria (R$) continua visivel como metrica complementar.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="limitacoes">
              <AccordionTrigger className="text-base font-semibold">
                10. Limitacoes e Consideracoes
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm leading-relaxed">
                  <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                    <li>
                      A precisao da extracao depende da <strong>qualidade das plantas</strong> fornecidas.
                      PDFs vetorizados produzem melhores resultados do que imagens escaneadas.
                    </li>
                    <li>
                      Plantas com muitas sobreposicoes, rasuras ou anotacoes manuscritas podem dificultar a leitura automatica.
                    </li>
                    <li>
                      O sistema gera um <strong>orcamento parametrico</strong> (estimativa), nao um orcamento executivo.
                      Para propostas finais, recomenda-se a validacao por um orcamentista.
                    </li>
                    <li>
                      O processamento pagina-a-pagina com verificacao adicional consome mais chamadas de IA,
                      podendo levar mais tempo para projetos com muitas paginas.
                    </li>
                    <li>
                      O <strong>radier</strong> (fundacao do piso terreo) e automaticamente excluido do calculo de paineis,
                      pois utiliza concreto convencional em vez de paineis Lightwall.
                    </li>
                    <li>
                      Custos de frete, guindastes, acabamentos e instalacoes complementares (eletrica, hidraulica)
                      <strong> nao estao incluidos</strong> na proposta gerada.
                    </li>
                    <li>
                      O modelo de IA (Gemini 2.5 Pro) pode apresentar variacoes entre execucoes, embora a
                      temperature baixa (0.1) e o raciocinio encadeado minimizem essa variabilidade.
                    </li>
                  </ul>
                </div>
              </AccordionContent>
            </AccordionItem>

          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
