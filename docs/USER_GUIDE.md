# Guia do Usuário - Sistema Lightwall Budget

  ## Introdução

  Este guia explica como usar o sistema para gerar orçamentos automatizados de painéis Lightwall a partir de plantas arquitetônicas.

  ## Passo a Passo

  ### 1. Criar um Novo Projeto

  1. Na tela inicial (Dashboard), clique em **"Novo Projeto"**
  2. Preencha os campos:
     - **Nome do Projeto** (obrigatório): Ex: "Residência Silva"
     - **Nome do Cliente** (opcional): Ex: "João Silva"
     - **Descrição** (opcional): Detalhes adicionais
  3. Clique em **"Criar Projeto"** ou continue para fazer upload de arquivos

  ### 2. Upload de Plantas Arquitetônicas

  #### Formatos Aceitos
  - **PDF**: Ideal para projetos completos com múltiplas páginas
  - **PNG/JPG**: Para plantas individuais escaneadas

  #### Como Fazer Upload
  1. Arraste os arquivos para a área de upload, ou
  2. Clique na área e selecione os arquivos
  3. Aguarde o upload completar (barra de progresso)

  #### Dicas para Melhores Resultados
  ✅ **BOM:**
  - PDFs nativos (não escaneados)
  - Imagens de alta resolução (mínimo 1920x1080)
  - Plantas com cotas explícitas
  - Quadros de esquadrias incluídos
  - Cortes e fachadas complementares

  ❌ **EVITAR:**
  - PDFs escaneados em baixa qualidade
  - Imagens borradas ou com ruído
  - Plantas sem escala ou cotas
  - Arquivos muito grandes (>50MB)

  ### 3. Processar com IA

  1. Após criar o projeto e fazer upload, você verá um card com o botão **"Processar Projeto"**
  2. Clique para iniciar a análise
  3. Aguarde o processamento (pode levar 2-5 minutos)
  4. Acompanhe o progresso pelas 5 etapas:
     - ✓ Classificação de páginas
     - ✓ Extração de dados
     - ⏳ Análise com IA
     - ⏳ Validação
     - ⏳ Cálculo de quantitativos

  ### 4. Revisar Dados Extraídos

  #### Aba "Dados Extraídos"
  Aqui você verá todos os elementos identificados pela IA:

  ##### Paredes
  - **ID**: Identificação da parede (P1, P2, etc.)
  - **Tipo**: Interna ou Externa
  - **Comprimento**: Em metros
  - **Altura**: Em metros
  - **Fonte**: De onde o dado foi extraído
  - **Status**: Se teve premissa aplicada (ícone de info)

  ##### Esquadrias (Portas e Janelas)
  - **ID**: Identificação (J1, P1, etc.)
  - **Tipo**: Porta ou Janela
  - **Largura**: Em metros
  - **Altura**: Em metros
  - **Peitoril**: Altura do peitoril (apenas janelas)
  - **Fonte**: Origem do dado

  ##### Lajes
  - **ID**: Identificação (L1, L2, etc.)
  - **Tipo**: Piso ou Cobertura
  - **Área**: Em metros quadrados
  - **Nível**: Pavimento (Térreo, 1º andar, etc.)

  #### O que Verificar
  1. **Dados faltantes**: Marcados com badge "Premissa"
  2. **Valores suspeitos**: Ex: parede com 0.5m de altura
  3. **Classificação errada**: Ex: janela marcada como porta

  ### 5. Analisar Orçamento

  #### Aba "Orçamento"

  ##### Alertas Técnicos
  - **🔴 CRÍTICO**: Impedem uso do orçamento - corrija antes de prosseguir
  - **🟠 ATENÇÃO**: Requerem revisão cuidadosa
  - **🔵 INFO**: Informações sobre premissas aplicadas

  ##### Totais
  Resumo principal com:
  - **Total de Painéis**: Quantidade total necessária
  - **Área de Paredes**: Metros quadrados de paredes
  - **Área de Lajes**: Metros quadrados de lajes

  ##### Quantitativos Detalhados

  **Paredes Externas:**
  - Área líquida (descontadas esquadrias)
  - Quantidade de painéis SP
  - Quantidade de painéis Tipo L (cantos)
  - Painéis elétricos

  **Paredes Internas:**
  - Mesmas informações das externas

  **Lajes:**
  - Piso: área e quantidade de painéis 2P
  - Cobertura: área e quantidade de painéis 2P

  ##### Materiais Complementares
  Lista automática conforme Manual Biomassa:
  - Conectores metálicos
  - Parafusos autoperfurantes
  - Fita de vedação
  - Massa de vedação

  ### 6. Exportar Orçamento

  #### Aba "Exportar"

  ##### Formato PDF
  - Documento formatado para impressão
  - Ideal para apresentação ao cliente
  - Inclui: resumo, quantitativos, alertas

  **Quando usar:** Relatório final, apresentações

  ##### Formato Excel
  - Planilha editável com múltiplas abas
  - Permite ajustes e cálculos adicionais
  - Inclui: todos os dados em tabelas

  **Quando usar:** Análises detalhadas, ajustes de custos

  ##### Formato JSON
  - Dados estruturados para programação
  - Ideal para integração com outros sistemas
  - Formato técnico

  **Quando usar:** Integrações, sistemas ERP

  ## Entendendo os Resultados

  ### Coeficientes de Perda

  #### Paredes
  - **5%**: Aplicado quando esquadrias ocupam ≤20% da área
  - **8%**: Aplicado quando esquadrias ocupam >20% da área

  *Razão:* Mais esquadrias = mais cortes = mais desperdício

  #### Lajes
  - **10% fixo**: Independente do tamanho

  *Razão:* Cortes para ajustes, acabamentos e perdas gerais

  ### Premissas Padrão

  Quando um dado não é encontrado, o sistema aplica:

  | Elemento | Valor Padrão | Razão |
  |----------|--------------|-------|
  | Altura de parede | 3.0m | Pé-direito padrão brasileiro |
  | Largura de porta | 0.8m | Porta padrão NBR |
  | Altura de porta | 2.1m | Porta padrão NBR |
  | Largura de janela | 1.2m | Janela comum |
  | Altura de janela | 1.0m | Janela comum |
  | Peitoril de janela | 1.1m | Padrão residencial |

  **⚠️ IMPORTANTE:** Sempre revise as premissas aplicadas!

  ## Boas Práticas

  ### ✅ FAZER

  1. **Upload de múltiplas vistas:**
     - Planta baixa
     - Cortes
     - Fachadas
     - Quadro de esquadrias

  2. **Verificar dados extraídos:**
     - Compare com plantas originais
     - Confira medidas críticas
     - Valide premissas aplicadas

  3. **Revisar alertas:**
     - Leia todos os alertas
     - Corrija alertas críticos
     - Documente decisões sobre avisos

  4. **Validação profissional:**
     - Sempre faça revisar por engenheiro/arquiteto
     - Não use diretamente para contratação
     - Considere como estimativa inicial

  ### ❌ NÃO FAZER

  1. **Confiar cegamente na IA:**
     - Sistema pode errar
     - Sempre valide manualmente

  2. **Ignorar alertas críticos:**
     - Podem indicar erros graves
     - Orçamento pode estar incorreto

  3. **Usar sem validação:**
     - Sistema é auxiliar, não substituto
     - Profissional deve revisar

  4. **Upload de plantas ruins:**
     - Baixa qualidade = resultados ruins
     - Invista tempo em bons arquivos

  ## Troubleshooting

  ### Problema: "Processamento falhou"
  **Causas:**
  - Arquivos corrompidos
  - Plantas ilegíveis
  - Erro de rede com Gemini

  **Solução:**
  - Tente novamente
  - Use arquivos de melhor qualidade
  - Verifique conexão

  ### Problema: "Nenhum dado extraído"
  **Causas:**
  - Plantas sem elementos identificáveis
  - Qualidade muito baixa
  - Tipo de arquivo incorreto

  **Solução:**
  - Verifique se plantas têm cotas/medidas
  - Use PDFs nativos ao invés de scans
  - Tente páginas individuais

  ### Problema: "Muitos alertas críticos"
  **Causas:**
  - Dados inconsistentes
  - Plantas incompletas
  - Erro na extração

  **Solução:**
  - Revise dados extraídos
  - Compare com plantas originais
  - Adicione vistas complementares

  ### Problema: "Premissas em excesso"
  **Causas:**
  - Falta de cotas nas plantas
  - Quadro de esquadrias ausente
  - Plantas simplificadas

  **Solução:**
  - Adicione plantas com mais informações
  - Use plantas executivas
  - Documente premissas assumidas

  ## Glossário

  - **Painel SP**: Painel estrutural autoportante (Single Panel)
  - **Painel 2P**: Painel dupla placa (2 Panels)
  - **Painel Tipo L**: Painel em L para cantos de 90°
  - **Painel Elétrico**: Painel com instalações elétricas
  - **Área Bruta**: Área total sem descontos
  - **Área Líquida**: Área descontando esquadrias
  - **Esquadria**: Portas e janelas
  - **Peitoril**: Altura da base da janela até o piso
  - **Coeficiente de Perda**: Percentual de desperdício
  - **Premissa**: Valor assumido quando dado não encontrado

  ## Suporte

  Para dúvidas ou problemas, consulte:
  - Documentação técnica: `docs/TECHNICAL.md`
  - README do projeto: `README.md`
  - Equipe de desenvolvimento

  ---

  **Bom trabalho com seus orçamentos!** 🏗️
  