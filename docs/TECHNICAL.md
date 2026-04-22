# Documentação Técnica - Sistema Lightwall Budget

  ## 1. Arquitetura do Sistema

  ### 1.1 Visão Geral
  Sistema fullstack JavaScript com React + Express, banco PostgreSQL e integração com Google Gemini AI para interpretação de plantas arquitetônicas.

  ### 1.2 Componentes Principais

  #### Backend (Node.js + Express)
  - **Servidor HTTP**: Express na porta 5000
  - **ORM**: Drizzle ORM (type-safe)
  - **Banco**: PostgreSQL
  - **Upload**: Multer (50MB limit)
  - **IA**: Google Gemini 2.0 Flash Exp

  #### Frontend (React SPA)
  - **Framework**: React 18 com TypeScript
  - **Roteamento**: Wouter
  - **Estado**: React Query (TanStack)
  - **UI**: Shadcn UI + Tailwind CSS
  - **Upload**: React Dropzone

  ## 2. Fluxo de Processamento

  ### 2.1 Upload de Arquivos
  1. Cliente envia arquivos via FormData
  2. Multer salva em `server/uploads/projects`
  3. PDFs são convertidos em imagens por página
  4. Registros salvos na tabela `project_files`

  ### 2.2 Classificação de Páginas
  Gemini analisa cada imagem e classifica em:
  - `planta_baixa`: Vista superior
  - `corte`: Seção vertical
  - `fachada`: Vista frontal/lateral
  - `quadro`: Tabela de dados
  - `outros`: Não identificado

  ### 2.3 Extração de Dados
  Para cada tipo de página, Gemini extrai:

  #### Planta Baixa
  - Paredes horizontais com comprimentos
  - Esquadrias com larguras
  - Lajes com áreas

  #### Cortes
  - Alturas de paredes (pé-direito)
  - Alturas de esquadrias
  - Níveis e pavimentos

  #### Fachadas
  - Alturas verticais
  - Dimensões de esquadrias externas

  #### Quadros
  - Dados tabulados completos
  - Maior confiança (98%)

  ### 2.4 Aplicação de Premissas
  Sistema preenche dados ausentes:

  ```typescript
  if (!wall.height) {
    wall.height = 3.0; // Pé-direito padrão
    hasAssumption = true;
  }
  ```

  ### 2.5 Cálculo de Quantitativos

  #### Fórmulas de Paredes
  ```
  área_bruta = Σ(comprimento × altura)
  área_esquadrias = Σ(largura × altura)
  área_líquida = área_bruta - área_esquadrias
  proporção_esquadrias = área_esquadrias / área_bruta

  coef_perda = proporção_esquadrias ≤ 0.20 ? 0.05 : 0.08
  área_com_perda = área_líquida × (1 + coef_perda)
  paineis_SP = ceil(área_com_perda / 1.83)
  ```

  #### Fórmulas de Lajes
  ```
  área_total = Σ(área)
  coef_perda = 0.10
  área_com_perda = área_total × 1.10
  paineis_2P = ceil(área_com_perda / 1.83)
  ```

  ### 2.6 Validação e Alertas
  Sistema verifica:
  - Dimensões válidas (> 0)
  - Proporção de esquadrias (< 100%)
  - Áreas líquidas positivas
  - Consistência entre fontes

  ## 3. Schema do Banco de Dados

  ### 3.1 Tabela `products`
  Catálogo de 22 SKUs Lightwall

  ### 3.2 Tabela `projects`
  Dados básicos do projeto

  ### 3.3 Tabela `project_files`
  Arquivos com classificação

  ### 3.4 Tabela `extracted_data`
  Dados extraídos por elemento (JSONB)

  ### 3.5 Tabela `budgets`
  Orçamentos calculados (JSONB)

  ## 4. API REST

  ### Endpoints Principais

  #### POST /api/projects
  Cria novo projeto

  #### POST /api/projects/:id/upload
  Upload de arquivos

  #### POST /api/projects/:id/process
  Processa com IA Gemini

  #### GET /api/projects/:id
  Retorna projeto completo

  #### GET /api/projects/:id/export/:format
  Exporta orçamento (pdf/excel/json)

  ## 5. Integração Gemini

  ### 5.1 Modelo
  `gemini-2.0-flash-exp` (visão + texto)

  ### 5.2 Configuração
  ```typescript
  temperature: 0.1  // Baixa para precisão
  topP: 0.95
  topK: 40
  maxOutputTokens: 8192
  ```

  ### 5.3 Prompt Engineering
  Sistema usa prompts estruturados com:
  - Contexto do tipo de página
  - Ordem de precedência de fontes
  - Formato JSON de saída esperado
  - Exemplos de dados corretos

  ## 6. Exportação de Orçamentos

  ### 6.1 PDF (PDFKit)
  - Documento formatado A4
  - Cabeçalho com dados do projeto
  - Tabelas de quantitativos
  - Alertas destacados

  ### 6.2 Excel (ExcelJS)
  - Múltiplas abas:
    - Resumo
    - Paredes
    - Lajes
    - Materiais
    - Alertas
    - Premissas

  ### 6.3 JSON
  Estrutura completa para integração:
  ```json
  {
    "project": {...},
    "quantitatives": {...},
    "materials": {...},
    "alerts": [...],
    "assumptions": [...]
  }
  ```

  ## 7. Segurança

  ### 7.1 Upload
  - Whitelist de tipos: PDF, PNG, JPG
  - Limite de 50MB por arquivo
  - Sanitização de nomes

  ### 7.2 SQL
  - Drizzle ORM previne SQL injection
  - Prepared statements

  ### 7.3 API
  - Validação de inputs
  - Error handling

  ## 8. Performance

  ### 8.1 Otimizações
  - Processamento assíncrono
  - Compressão de imagens (sharp)
  - Cache de queries (React Query)
  - Lazy loading de componentes

  ### 8.2 Escalabilidade
  - Stateless backend
  - Banco relacional normalizado
  - Files em storage separado

  ## 9. Manutenção

  ### 9.1 Logs
  Sistema registra:
  - Requests da API
  - Erros de processamento
  - Tempo de execução

  ### 9.2 Monitoramento
  Pontos críticos:
  - Taxa de sucesso do Gemini
  - Tempo de processamento
  - Taxa de alertas críticos

  ## 10. Roadmap Técnico

  ### Curto Prazo
  - Cache de classificações
  - Retry automático em falhas
  - Batch processing

  ### Médio Prazo
  - WebSockets para progresso real-time
  - Object storage (S3)
  - Background jobs (Bull/Redis)

  ### Longo Prazo
  - Microserviços
  - ML próprio para classificação
  - API pública documentada
  