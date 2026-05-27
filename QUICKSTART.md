# 🚀 Guia de Início Rápido - Sistema Lightwall Budget

  ## Pré-requisitos Verificados

  ✅ Node.js e npm instalados
  ✅ PostgreSQL database provisionado
  ✅ Variáveis de ambiente configuradas
  ✅ Todos os pacotes instalados

  ## 📋 Checklist de Inicialização

  ### 0. Provisionar variáveis de ambiente

  ```bash
  cp .env.example .env
  ```

  Preencha em `.env`:
  - `DATABASE_URL` — connection string do Postgres provisionado.
  - `SESSION_SECRET` — string aleatória ≥ 16 chars (use `openssl rand -hex 32`).
  - `AI_INTEGRATIONS_GEMINI_API_KEY` *(recomendado em produção)* — chave obtida em [Google AI Studio](https://aistudio.google.com/apikey). Quando definida, sobrescreve qualquer chave configurada via UI (Settings) e a UI fica read-only por segurança.
  - `AI_INTEGRATIONS_OPENAI_API_KEY` *(opcional)* — habilita verificação cross-model e modo OpenAI-only.

  Em desenvolvimento as chaves de IA podem ser deixadas em branco — você consegue configurar via `/settings` na UI.

  O processo morre cedo com mensagem clara se uma variável obrigatória estiver ausente ou inválida (validação via Zod em `server/config/env.ts`).

  ### 1. Validar Sistema
  ```bash
  npm run validate
  ```

  Este comando verifica:
  - ✅ Variáveis de ambiente
  - ✅ Conexão com PostgreSQL
  - ✅ Tabelas do banco de dados
  - ✅ Catálogo de produtos
  - ✅ Diretórios de upload
  - ✅ Integração com Gemini AI

  ### 2. Popular Catálogo de Produtos (se necessário)
  ```bash
  npm run db:seed
  ```

  Popula o banco com os 22 SKUs de painéis Lightwall.

  ### 3. Iniciar Servidor de Desenvolvimento
  ```bash
  npm run dev
  ```

  O sistema estará disponível em: **http://localhost:5000**

  ## 🎯 Funcionalidades Principais

  ### Upload de Plantas
  1. Acesse o dashboard
  2. Clique em "Novo Projeto"
  3. Faça upload de arquivos PDF ou imagens (PNG/JPG)
  4. Aguarde o processamento automático

  ### Processamento Inteligente
  O sistema automaticamente:
  - 📄 Classifica páginas (planta baixa, corte, fachada, quadros)
  - 🔍 Extrai dados estruturais (paredes, esquadrias, lajes)
  - 🧮 Calcula quantitativos conforme Manual Biomassa
  - ⚠️ Valida dados e emite alertas
  - 📊 Gera orçamento completo

  ### Exportação
  Exporte relatórios em 3 formatos:
  - 📄 **PDF** - Formatado para impressão
  - 📊 **Excel** - 6 abas com dados detalhados
  - 🔌 **JSON** - Para integrações

  ## 🔧 Comandos Úteis

  ```bash
  # Desenvolvimento
  npm run dev          # Inicia servidor com hot reload
  npm run validate     # Valida configuração do sistema

  # Banco de Dados
  npm run db:push      # Aplica mudanças no schema
  npm run db:seed      # Popula catálogo de produtos
  npm run db:studio    # Abre Drizzle Studio (GUI)

  # Build e Deploy
  npm run build        # Compila para produção
  npm start            # Inicia servidor de produção
  ```

  ## 📊 Estrutura de Dados

  ### Produtos (22 SKUs pré-cadastrados)
  - **Painéis Simples (SP):** 60-160mm
  - **Painéis Duplos (2P):** 120-200mm
  - **Painéis Tipo L:** 100-140mm
  - **Painéis Elétricos:** 1T e 3T (80-120mm)

  ### Materiais Complementares
  - Conectores: 4 por painel
  - Parafusos: 8 por painel
  - Fita: 2m por painel
  - Massa: 0.5kg por painel

  ## ⚠️ Sistema de Validação

  ### Alertas Críticos
  - ❌ Área ≤ 0
  - ❌ Área de esquadrias ≥ 100% da parede

  ### Alertas de Atenção
  - ⚠️ Dados ausentes (usando premissas)
  - ⚠️ Premissas críticas aplicadas

  ### Informativos
  - ℹ️ Coeficientes de perda aplicados
  - ℹ️ Arredondamentos realizados

  ## 🔐 Segurança

  **IMPORTANTE:** Este sistema NÃO substitui validação profissional!

  Sempre revise:
  - ✅ Dados extraídos pela IA
  - ✅ Quantitativos calculados
  - ✅ Premissas aplicadas
  - ✅ Alertas de validação

  Um engenheiro ou arquiteto deve validar todos os orçamentos antes do uso.

  ## 📚 Documentação Completa

  - **Técnica:** `docs/TECHNICAL.md`
  - **Usuário:** `docs/USER_GUIDE.md`
  - **Resumo:** `docs/SUMMARY.md`

  ## 🆘 Solução de Problemas

  ### Erro de Conexão com Banco
  ```bash
  # Verificar DATABASE_URL
  echo $DATABASE_URL
  ```

  ### Erro do Gemini AI
  ```bash
  # Verificar variáveis de ambiente
  echo $AI_INTEGRATIONS_GEMINI_API_KEY
  echo $AI_INTEGRATIONS_GEMINI_BASE_URL
  ```

  ### Catálogo Vazio
  ```bash
  npm run db:seed
  ```

  ---

  **Desenvolvido para Lightwall** | Sistema de Orçamento Paramétrico Inteligente
  