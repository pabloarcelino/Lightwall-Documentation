# 🏗️ Sistema Lightwall Budget

  **Sistema web completo de orçamento paramétrico de painéis Lightwall com interpretação inteligente de plantas arquitetônicas via IA Gemini**

  ---

  ## 🎯 Visão Geral

  Sistema profissional para orçamentação automatizada de painéis estruturais Lightwall. Utiliza IA (Gemini 2.0 Flash) para interpretar plantas arquitetônicas, extrair dados estruturais e gerar orçamentos detalhados conforme o Manual Biomassa.

  ### ✨ Principais Funcionalidades

  - 📄 **Upload Inteligente**: Aceita PDFs e imagens (PNG/JPG)
  - 🤖 **Processamento com IA**: Análise automática via Gemini AI
  - 🏗️ **Classificação de Páginas**: Identifica plantas baixas, cortes, fachadas e quadros
  - 📊 **Extração de Dados**: Paredes, esquadrias, lajes, medidas e especificações
  - 🧮 **Cálculo Paramétrico**: Quantitativos conforme Manual Biomassa
  - ⚠️ **Validação Inteligente**: 3 níveis de alertas (crítico, atenção, informativo)
  - 💰 **Orçamento Completo**: Painéis + materiais + mão de obra
  - 📤 **Exportação Múltipla**: PDF, Excel (6 abas), JSON

  ---

  ## 🚀 Início Rápido

  ### 1️⃣ Verificar Sistema
  ```bash
  npm run validate
  ```

  ### 2️⃣ Iniciar Servidor
  ```bash
  npm run dev
  ```

  Acesse: **http://localhost:5000**

  ---

  ## 📋 Pré-requisitos

  ✅ **Node.js** 18+ instalado  
  ✅ **PostgreSQL** database provisionado  
  ✅ **Variáveis de Ambiente** configuradas:
  - `DATABASE_URL` - Conexão PostgreSQL
  - `AI_INTEGRATIONS_GEMINI_API_KEY` - Chave API Gemini
  - `AI_INTEGRATIONS_GEMINI_BASE_URL` - URL base Gemini
  - `SESSION_SECRET` - Segredo das sessões

  ---

  ## 🏗️ Arquitetura

  ### Stack Tecnológico

  **Frontend:**
  - ⚛️ React 18 + TypeScript
  - 🎨 Tailwind CSS + Shadcn UI
  - 🔄 TanStack Query (state management)
  - 📋 React Hook Form + Zod
  - 📂 React Dropzone

  **Backend:**
  - 🟢 Node.js + Express
  - 🗄️ PostgreSQL + Drizzle ORM
  - 🤖 Google Gemini AI (2.0 Flash)
  - 📄 PDF-Lib, PDFKit (processamento)
  - 📊 ExcelJS (exportação)
  - 🖼️ Sharp (imagens)

  ### Estrutura de Diretórios

  ```
  ├── client/               # Frontend React
  │   ├── src/
  │   │   ├── pages/        # Dashboard, NewProject, ProjectDetails
  │   │   ├── components/   # Componentes UI (Shadcn)
  │   │   └── hooks/        # Custom hooks
  ├── server/               # Backend Express
  │   ├── services/
  │   │   ├── gemini/       # Cliente e analisador IA
  │   │   ├── pdf/          # Processamento PDFs
  │   │   ├── calculation/  # Motor de cálculos
  │   │   └── export/       # Exportação relatórios
  │   ├── routes.ts         # Rotas da API
  │   ├── db.ts             # Conexão banco
  │   ├── seed.ts           # Popular produtos
  │   └── validate.ts       # Validação sistema
  ├── shared/
  │   └── schema.ts         # Schema Drizzle (produtos, projetos, etc)
  └── docs/                 # Documentação completa
  ```

  ---

  ## 📊 Banco de Dados

  ### Tabelas Principais

  1. **products** - 22 SKUs de painéis Lightwall
  2. **projects** - Projetos de orçamento
  3. **project_files** - Arquivos uploaded
  4. **extracted_data** - Dados extraídos pela IA
  5. **budgets** - Orçamentos gerados

  ### Comandos Úteis

  ```bash
  npm run db:seed      # Popular catálogo (22 produtos)
  npm run db:push      # Aplicar schema
  npm run db:studio    # Abrir Drizzle Studio (GUI)
  ```

  ---

  ## 🎨 Catálogo de Produtos

  ### Painéis Estruturais (20 SKUs)

  | Categoria | Espessuras | Preço Base |
  |-----------|------------|------------|
  | **Simples (SP)** | 60-160mm (6 SKUs) | R$ 145-245/m² |
  | **Duplos (2P)** | 120-200mm (5 SKUs) | R$ 285-365/m² |
  | **Tipo L** | 100-140mm (3 SKUs) | R$ 195-235/m² |
  | **Elétricos 1T** | 80-120mm (3 SKUs) | R$ 175-215/m² |
  | **Elétricos 3T** | 80-120mm (3 SKUs) | R$ 195-235/m² |

  ### Materiais Complementares (2 SKUs)

  - **CONN-001**: Conector Metálico (R$ 12,50/un)
  - **PARA-001**: Parafuso Estrutural (R$ 2,80/un)

  ---

  ## 🔄 Fluxo de Trabalho

  ### 1. Upload de Plantas
  - Usuário faz upload de PDF ou imagens
  - Sistema valida formato e tamanho
  - Arquivos salvos em `server/uploads/projects/`

  ### 2. Processamento com IA
  - Gemini AI analisa cada página
  - Classifica tipo (planta baixa, corte, fachada, quadros)
  - Extrai dados estruturais:
    - Paredes (comprimento, altura, espessura)
    - Esquadrias (portas, janelas, dimensões)
    - Lajes (área, tipo)
    - Medidas e especificações

  ### 3. Cálculo Paramétrico
  - Área bruta de paredes
  - Dedução de esquadrias
  - Aplicação de coeficientes de perda (6-12%)
  - Arredondamento conforme Manual Biomassa
  - Seleção automática de painéis

  ### 4. Validação
  - **Crítico** ❌: Área ≤ 0, esquadrias ≥ 100%
  - **Atenção** ⚠️: Dados ausentes, premissas críticas
  - **Informativo** ℹ️: Coeficientes, arredondamentos

  ### 5. Geração de Orçamento
  - Painéis estruturais
  - Materiais complementares (conectores, parafusos, fita, massa)
  - Mão de obra (montagem, acabamento, instalações)
  - Totais e subtotais

  ### 6. Exportação
  - **PDF**: Relatório formatado para impressão
  - **Excel**: 6 abas (resumo, painéis, materiais, MO, validação, dados)
  - **JSON**: Para integrações

  ---

  ## ⚠️ Sistema de Validação

  ### Alertas Críticos (❌)
  Impedem prosseguimento sem revisão:
  - Área de parede ≤ 0
  - Área de esquadrias ≥ 100% da parede
  - Dados estruturais críticos ausentes

  ### Alertas de Atenção (⚠️)
  Requerem revisão antes de usar:
  - Dados importantes ausentes (usando premissas)
  - Premissas críticas aplicadas
  - Dimensões fora dos padrões

  ### Informativos (ℹ️)
  Para conhecimento:
  - Coeficientes de perda aplicados
  - Arredondamentos realizados
  - Seleções automáticas de produtos

  ---

  ## 🔐 Segurança e Responsabilidade

  ### ⚠️ IMPORTANTE

  **Este sistema NÃO substitui validação profissional!**

  Sempre revise:
  - ✅ Dados extraídos pela IA
  - ✅ Quantitativos calculados
  - ✅ Premissas aplicadas
  - ✅ Todos os alertas de validação

  **Um engenheiro ou arquiteto deve validar todos os orçamentos antes do uso comercial.**

  ### Limitações Conhecidas

  1. **IA não é 100% precisa**: Pode errar em plantas complexas
  2. **Premissas padrão**: Nem sempre aplicáveis ao seu caso
  3. **Dados ausentes**: Sistema infere quando possível
  4. **Validação manual necessária**: Sempre confira os números

  ---

  ## 📚 Documentação Completa

  - **[QUICKSTART.md](./QUICKSTART.md)** - Guia de início rápido
  - **[docs/SUMMARY.md](./docs/SUMMARY.md)** - Resumo executivo
  - **[docs/TECHNICAL.md](./docs/TECHNICAL.md)** - Documentação técnica detalhada
  - **[docs/USER_GUIDE.md](./docs/USER_GUIDE.md)** - Manual do usuário

  ---

  ## 🛠️ Comandos Disponíveis

  ```bash
  # Desenvolvimento
  npm run dev          # Servidor com hot reload (porta 5000)
  npm run validate     # Validar configuração do sistema

  # Banco de Dados
  npm run db:seed      # Popular catálogo de produtos
  npm run db:push      # Aplicar mudanças no schema
  npm run db:studio    # Abrir Drizzle Studio (GUI)

  # Build e Deploy
  npm run build        # Compilar para produção
  npm start            # Iniciar servidor de produção
  ```

  ---

  ## 🐛 Solução de Problemas

  ### Erro de Conexão com Banco
  ```bash
  # Verificar variável de ambiente
  echo $DATABASE_URL
  ```

  ### Erro do Gemini AI
  ```bash
  # Verificar variáveis
  echo $AI_INTEGRATIONS_GEMINI_API_KEY
  echo $AI_INTEGRATIONS_GEMINI_BASE_URL
  ```

  ### Catálogo Vazio
  ```bash
  npm run db:seed
  ```

  ### Uploads Não Funcionam
  ```bash
  # Verificar permissões do diretório
  ls -la server/uploads/
  ```

  ---

  ## 📞 Suporte

  Para questões técnicas ou bugs, consulte a documentação técnica em `docs/TECHNICAL.md`.

  ---

  ## 📄 Licença

  Sistema desenvolvido para uso exclusivo da **Lightwall**.

  ---

  **Desenvolvido com ❤️ para Lightwall** | Sistema de Orçamento Paramétrico Inteligente
  
  ---

  ## Deploy VPS

  Para subida em VPS com Docker Compose, use a documentacao em `DEPLOY.md`.
