# Lightwall Orçamento — Documento Técnico & Operacional Completo

> **Versão**: 1.1 — 31 de maio de 2026
> **Público**: Time de avaliação (Frontend, Backend, IA/ML, DevOps, Produto, Segurança)
> **Objetivo**: Referência única para entender, avaliar e organizar o projeto end-to-end.
> **Fonte da verdade**: `main` no momento desta versão. Quando em dúvida, o código (`server/routes.ts`, `shared/schema.ts`) prevalece sobre este texto.

> ⚠️ **Pipeline enxuto (2026-05-31)**: 5 etapas removidas (2.5, 3.4, 3.6, 4.6, 4.65) por não trazerem retorno mensurável. Pipeline ativo passa de 22 → 14 etapas. Ganhos: -30 a -120s por projeto, -US$ 0,05, logs 80% mais limpos. Ver Parte III item 12 e nota no topo de `docs/PIPELINE.md`. Reversível: comentários `[REMOVED 2026-05-31]` em `server/routes.ts`.

---

## Sumário

- [Parte I — Visão geral (não-técnica)](#parte-i--visão-geral-não-técnica)
- [Parte II — Arquitetura](#parte-ii--arquitetura)
- [Parte III — Pipeline de processamento (22 etapas)](#parte-iii--pipeline-de-processamento-22-etapas)
- [Parte IV — Frontend](#parte-iv--frontend)
- [Parte V — Backend](#parte-v--backend)
- [Parte VI — Integrações de IA](#parte-vi--integrações-de-ia)
- [Parte VII — Modelo de dados](#parte-vii--modelo-de-dados)
- [Parte VIII — DevOps & operação](#parte-viii--devops--operação)
- [Parte IX — Qualidade, segurança e riscos](#parte-ix--qualidade-segurança-e-riscos)
- [Parte X — Roadmap e recomendações](#parte-x--roadmap-e-recomendações)
- [Parte XI — Guia de avaliação pro time](#parte-xi--guia-de-avaliação-pro-time)
- [Anexos](#anexos)

---

# PARTE I — VISÃO GERAL (NÃO-TÉCNICA)

## 1. Sumário executivo

**Lightwall Orçamento** é uma plataforma web que **transforma plantas arquitetônicas em orçamentos paramétricos de painéis estruturais Lightwall** em poucos minutos. O usuário faz upload de PDFs (ou imagens, ou modelos IFC) de plantas, e o sistema:

1. **Identifica** o tipo de cada página (planta baixa, corte, fachada).
2. **Extrai** paredes, lajes, esquadrias e cantos usando IA multimodal (Gemini 2.5 Pro/Flash + visão computacional opcional).
3. **Classifica** topologicamente cada parede (externa, interna, muro) por geometria pura.
4. **Calcula** os quantitativos de painéis conforme o Manual Biomassa.
5. **Aplica** preços do catálogo + ajustes (frete, biomassa, desconto).
6. **Gera** um documento entregável com:
   - Planta anotada (faixas vermelhas/verdes nas paredes, estilo Gemini Web).
   - Descrição do projeto em prosa.
   - Orçamento detalhado por categoria.
   - Exportação em PDF, XLSX e JSON.

**Estado atual**: sistema 100% operacional em produção (Replit), processando projetos reais. Zero TODOs/FIXMEs no código. Conhecidas algumas limitações de qualidade na extração geométrica (Etapa 3.5 — match de endpoints) e disponibilidade do micro-serviço opcional de visão computacional. Custo médio de ~US$ 0,20–0,30 em chamadas IA por projeto. Latência média de 3-7 minutos por projeto residencial típico (3 páginas).

---

## 2. O que é o Lightwall Orçamento

### Problema que resolve

Hoje, orçar um projeto Lightwall a partir de uma planta arquitetônica é um trabalho **manual e demorado**: o orçamentista mede paredes uma a uma, classifica como externa ou interna, soma comprimentos, aplica espessura, multiplica por painéis, soma frete, aplica desconto. Erros são comuns. Cada projeto leva horas.

O Lightwall Orçamento automatiza esse fluxo: o usuário sobe a planta e em 3-7 minutos recebe um orçamento profissional com:

- Tabela de quantitativos por pavimento (paredes externas, internas, muros, lajes de piso, lajes de cobertura).
- Preços aplicados de acordo com perfil regional/cliente.
- Planta visualmente anotada (entregável ao cliente final).
- Possibilidade de exportar em XLSX (para revisão), PDF (para entrega) e JSON (para integração).

### Diferenciais técnicos

1. **IA multimodal**: usa Gemini 2.5 Pro para leitura semântica das plantas (identifica cômodos, conta paredes, lê cotas).
2. **Visão computacional opcional**: micro-serviço Python (OpenCV + scikit-image) para extração geométrica determinística — quando online, refina endpoints das paredes para classificação topológica precisa.
3. **Validação cruzada**: cada parede é classificada por geometria (point-in-polygon contra o envelope da edificação), não por "achismo" da IA.
4. **Graceful degradation**: 16 das 22 etapas continuam mesmo se uma falhar; só 4 são fatais. O sistema sempre entrega *algo*, com alertas claros do que precisa de revisão humana.
5. **Renderização SVG determinística**: a planta anotada é gerada por código (Sharp + SVG composite), não por IA de edição de imagens — resultados consistentes e reproduzíveis.

---

## 3. Personas e casos de uso

### Personas principais

| Persona | O que faz no sistema | Frequência |
|---|---|---|
| **Orçamentista Lightwall** | Sobe planta, valida resultado, exporta XLSX/PDF para o cliente | Diário (~5–20 projetos/dia) |
| **Cliente final** | Recebe orçamento + planta anotada (não interage com o sistema) | Recebe documento |
| **Administrador** | Gerencia perfis de preço, catálogo de SKUs, calibração | Semanal/mensal |
| **Desenvolvedor (interno)** | Itera no pipeline, ajusta prompts, troca modelos | Contínuo |

### Casos de uso típicos

1. **Projeto residencial pequeno (50–150 m²)**:
   - 1 arquivo PDF com 1–3 páginas (planta baixa + corte + fachada).
   - 8–15 paredes externas + 10–20 internas, 1–2 lajes.
   - Latência: 3–5 minutos. Custo IA: ~US$ 0,15–0,20.

2. **Projeto residencial médio (150–300 m²)**:
   - 1–2 arquivos PDF, multi-pavimento (térreo + superior).
   - 15–30 paredes externas + 20–40 internas, 2–4 lajes.
   - Latência: 5–10 minutos. Custo IA: ~US$ 0,25–0,35.

3. **Projeto comercial/industrial**:
   - Multi-pavimento, muitas páginas técnicas (cortes, fachadas, detalhes).
   - Latência: 10–20 minutos. Custo IA: ~US$ 0,40–0,80.

4. **Modelo BIM (IFC)**:
   - Arquivo `.ifc` (parser direto, sem IA).
   - Latência: 30–60s. Custo IA: zero (skip Gemini).

---

## 4. Métricas operacionais (estado atual)

| Métrica | Valor típico | Observação |
|---|---|---|
| **Latência média** | 3–7 min (residencial) | Etapa 3 Gemini é o gargalo (~2-3min) |
| **Custo IA por projeto** | US$ 0,20–0,30 | Gemini Flash domina. Pro só em etapas críticas (1, 1.5, 8) |
| **Taxa de sucesso end-to-end** | ~85% | Os 15% restantes têm dados parciais + alertas de auditoria |
| **Etapas com graceful degrade** | 16 de 22 | Pulam silenciosamente em caso de falha |
| **Etapas fatais** | 4 (Fusão, Quantitativos, Catálogo, persistência) | Pipeline para com `status=error` |
| **Concorrência por projeto** | Sequencial (1 pipeline / projeto) | Múltiplos projetos rodam em paralelo |
| **SSE clients simultâneos** | Sem limite explícito | Map em memória, scaling vertical |

---

## 5. Status em uma frase

**Pronto para produção, com lista clara de melhorias incrementais para subir qualidade da extração e reduzir latência.**

---

# PARTE II — ARQUITETURA

## 6. Visão macro

O sistema é composto por **três processos cooperantes**, mais uma base de dados e dois provedores externos de IA:

```mermaid
flowchart LR
    subgraph Client["Client (React 18 + Vite)"]
        UI["ProjectDetails.tsx<br/>(upload, kickoff,<br/>SSE consumer)"]
        SIDE["ProjectSidebar<br/>(navegação persistente)"]
    end

    subgraph Server["Server (Node 22 + Express 5)"]
        ROUTES["routes.ts<br/>orquestrador (4400 linhas)"]
        SVC["services/*<br/>22 serviços especializados"]
        DB[("PostgreSQL<br/>10 tabelas via Drizzle")]
    end

    subgraph CV["cv-service (Python + FastAPI)"]
        FAST["/extraction/full_extraction<br/>+ /stream (SSE)"]
        OPENCV["OpenCV, Shapely,<br/>scikit-image, EasyOCR"]
    end

    subgraph AI["Provedores IA"]
        GEMINI["Google Gemini<br/>2.5-Pro + 2.5-Flash"]
        OPENAI["OpenAI<br/>gpt-4o (opcional)"]
    end

    UI -- "POST /process" --> ROUTES
    UI <-. "SSE /progress + /ai-events" .- ROUTES
    ROUTES --> SVC
    SVC <--> DB
    SVC <-- "extração" --> FAST
    FAST --> OPENCV
    SVC <-- "LLM" --> GEMINI
    SVC <-- "LLM (opt)" --> OPENAI
    SVC -. "fallback Gemini-only se CV offline" .-> SVC
```

### Papéis dos componentes

- **Cliente (Browser)**: SPA React. Faz upload, dispara processamento, consome dois canais SSE para refletir progresso ao vivo. Renderiza a planta anotada e o orçamento.
- **Servidor Node**: orquestra todo o pipeline (`routes.ts:/process`). Chama LLMs, persiste resultados em `extracted_data`, calcula orçamento. Emite eventos SSE para o client.
- **cv-service (Python)**: micro-serviço opcional. Faz extração geométrica determinística usando OpenCV e Shapely. Quando online, refina dados da IA. Quando offline, o pipeline degrada para "Gemini-only" sem falhar.
- **Provedores IA**: Gemini é primário (gratuito até quota, multimodal robusto). OpenAI é fallback opcional para modos alternativos de extração.
- **PostgreSQL**: persistência. Drizzle ORM gera schemas tipados.

---

## 7. Stack tecnológica (versões exatas)

### Frontend (`client/src/`)

| Categoria | Tecnologia | Versão | Notas |
|---|---|---|---|
| Framework | React | 18.3.1 | Hooks, Suspense |
| Build | Vite | 7.3.0 | HMR + production bundle |
| Router | Wouter | 3.3.5 | SPA leve, ~1.5kb |
| Estado de servidor | TanStack Query | 5.60.5 | Cache + invalidation |
| Estilo | Tailwind CSS | 3.4.17 | Utility-first |
| UI components | Radix UI + shadcn | (vários) | Acessível, sem opinião visual |
| Markdown | (inline parser) | — | Para descrição IA |
| Charts | Recharts | 2.15.2 | KPIs e gráficos |
| Forms | react-hook-form | 7.55.0 | Validação com Zod |
| PDF render | pdfjs-dist | 5.5.207 | Visualização de PDF no client |
| SSE | EventSource (browser) | nativo | Custom hook `useSseWithRetry` |

### Backend (`server/`)

| Categoria | Tecnologia | Versão | Notas |
|---|---|---|---|
| Runtime | Node | 22.x | tsx em dev, esbuild em prod |
| Web framework | Express | 5.0.1 | Middleware standard |
| ORM | Drizzle ORM | 0.39.3 | Type-safe, sem migrações forçadas |
| DB driver | pg (node-postgres) | 8.16.3 | Pool de conexões |
| Validação env | Zod | 3.25.76 | Fail-fast no boot |
| Auth | Passport + passport-local | 0.7.0 | Sessão Postgres |
| Hashing | bcryptjs | 3.0.3 | Senhas hashed |
| LLM (Gemini) | @google/genai | 1.44.0 | SDK oficial |
| LLM (OpenAI) | openai | 6.33.0 | SDK oficial |
| Image processing | sharp | 0.34.5 | Composite SVG + PNG |
| PDF parsing | pdf-lib + pdfjs-dist | 1.17.1 / 5.5.207 | Vetorial + raster |
| PDF→PNG | pdf-to-png-converter | 3.18.0 | Para casos raster |
| IFC parser | web-ifc | 0.0.77 | Modelos BIM |
| Concorrência | p-limit + p-retry | 7.3.0 / 7.1.1 | Parallel + backoff |
| Export | exceljs + pdfkit | 4.4.0 / 0.17.2 | XLSX e PDF |
| Multipart upload | multer | 2.1.1 | Upload de arquivos |
| Session store | connect-pg-simple | 10.0.0 | Sessões em Postgres |

### CV Service (`cv-service/`)

| Categoria | Tecnologia | Notas |
|---|---|---|
| Framework | FastAPI | API HTTP + SSE |
| Web server | uvicorn | ASGI server |
| OCR | EasyOCR | Pode upgrade pra PaddleOCR |
| Geometria | OpenCV + Shapely + scikit-image | Detecção de paredes, envelope |
| Polígonos | alphashape + rtree | Concave hull |
| IA (cliente) | google-genai | Para Etapa 3.4 sub-prompts |

---

## 8. Decisões arquiteturais notáveis

### 8.1 Storage abstrato (`server/storage.ts`)

A camada de persistência expõe uma **interface `IStorage`** em vez de chamar Drizzle direto pelos services. Isso permite:
- Trocar PostgreSQL por S3/Redis em um endpoint específico sem reescrever os services.
- Testar com mock storage facilmente.
- Centralizar transações e error handling.

### 8.2 SSE dual (dois canais)

- **`/api/projects/:id/progress`** (legado): stepper simples, 12 etapas numeradas. Eventos `{ step, label, status, detail }`. Usado pelo `pipelineSteps` antigo. **Vai sumir** no futuro.
- **`/api/projects/:id/ai-events`** (atual): timeline detalhada com 6 kinds (`ai_call`, `stage`, `pdf_split`, `image_render`, `cv_substep`, `audit_finding`). Persiste em `pipeline_events` para hidratação ao reabrir o projeto.

### 8.3 Renderização SVG determinística

A planta anotada é gerada por **código** (`server/services/annotation/renderer.ts`), não por IA de edição. O algoritmo:
1. Rasteriza o PDF/imagem original via `pdf-to-png-converter` (ou usa imagem direto).
2. Calcula polígonos retangulares para cada parede (a partir de endpoints + thickness).
3. Compõe SVG sobre a imagem usando `sharp` (vermelho 55% opacity para externa, verde para interna, azul para muro).
4. Retorna PNG final.

Vantagens vs. IA editora:
- Custo zero (não chama LLM).
- 100% determinístico (mesma entrada → mesma saída).
- Latência de 100-500ms por pavimento (vs. 30s+ de IA).

### 8.4 Graceful degradation

A maioria das etapas (16 de 22) tem padrão:
```typescript
try {
  sendProgress(projectId, X, "Nome", "running", "...");
  const result = await algoritmoCritico();
  sendProgress(projectId, X, "Nome", "done", "...");
  return result;
} catch (err) {
  console.warn(`[ETAPA X] Pulada por erro: ${err.message}`);
  sendProgress(projectId, X, "Nome", "done", `pulada (erro)`);
  // pipeline continua, downstream etapas usam fallback
}
```

Apenas 4 etapas são fatais (Fusão, Quantitativos, persistência do orçamento, persistência do projeto). Tudo o resto pode falhar isoladamente sem derrubar o pipeline.

### 8.5 Aborto cooperativo

Endpoint `POST /api/projects/:id/abort` sinaliza um Set em memória. Em 5 checkpoints estratégicos do pipeline, a função `throwIfAborted(projectId)` é chamada — se a flag estiver setada, lança `PipelineAbortedError` que é capturado pelo try/catch externo, marca o projeto como `error` e libera o SSE.

Aborto não interrompe chamadas Gemini em vôo (best-effort). Tempo típico para parar: 5-30s; pode chegar a 2 minutos se cair no meio da Etapa 3 (extração geométrica).

### 8.6 Bootstrap automático de schema

Para evitar exigir que o usuário rode `drizzle-kit push` manualmente (operação arriscada em DBs com dados), o servidor executa `bootstrapSchema()` no boot:
- Roda `CREATE TABLE IF NOT EXISTS pipeline_events ...` no startup.
- Idempotente, seguro (nunca `DROP`, `ALTER`, `TRUNCATE`).
- Logs claros: `[BOOTSTRAP] OK: pipeline_events table`.

---

## 9. Diagrama BPMN

O diagrama BPMN completo das 22 etapas do pipeline está em **`docs/PIPELINE_BPMN.png`** (1900×4500 pixels, gerado por `script/bpmn_pipeline.py` usando Pillow puro — sem dependência de chromium/graphviz).

Ele mostra:
- 3 raias (pools): Cliente, Server, CV-Service.
- Start events (○ verde), end events (◉ grosso).
- Tasks arredondadas para cada etapa.
- Sub-process com [+] para Etapa 3.4 (CV).
- Gateway X exclusivo para "É IFC?" (bifurca BIM direto vs pipeline normal).
- Gateway + paralelo para Etapas 7.5 e 8 (fork-join).
- Sequence flows sólidos dentro do mesmo pool.
- Message flows tracejados entre pools (SSE Cliente↔Server, stream Server↔CV).

---

## 10. Fluxos de dados principais

### 10.1 Fluxo "Criar projeto e processar"

```
Client                        Server                    DB           Gemini       CV
  |                              |                       |             |           |
  |--POST /api/projects--------->|                       |             |           |
  |                              |--INSERT projects----->|             |           |
  |<--201 { id }-----------------|                       |             |           |
  |                              |                       |             |           |
  |--POST /upload (multipart)--->|                       |             |           |
  |                              |--save to disk         |             |           |
  |                              |--INSERT project_files>|             |           |
  |<--200--------+---------------|                       |             |           |
  |                              |                       |             |           |
  |--POST /process-------------->|                       |             |           |
  |--connect /ai-events (SSE)--->|                       |             |           |
  |                              |  [Etapa 0.5 Pre-flight]              |           |
  |<--event stage started--------|                       |             |           |
  |<--event stage completed------|                       |             |           |
  |                              |  [Etapa 1 Classificação]             |           |
  |                              |---chamada----------------------------|           |
  |<--event ai_call started------|                       |             |           |
  |                              |<---response----------------------------|         |
  |<--event ai_call completed----|                       |             |           |
  |                              |--INSERT extracted_data|             |           |
  |                              |  ... (16 outras etapas)              |           |
  |                              |  [Etapa 3.4 CV]                      |           |
  |                              |--/full_extraction--------------->|              |
  |                              |<--SSE substeps------------------|              |
  |                              |<--final result------------------|              |
  |                              |  ... mais etapas ...                 |           |
  |                              |--INSERT budgets------>|             |           |
  |                              |--UPDATE status=done-->|             |           |
  |<--event stage 0 Concluido----|                       |             |           |
  |--disconnect SSE              |                       |             |           |
```

### 10.2 Fluxo "Hidratação ao abrir projeto"

Quando o usuário abre um projeto já processado:
1. Browser carrega ProjectDetails.
2. `useQuery(["/api/projects/:id"])` traz `{ project, files, extractedData, budget }`.
3. `useProcessingEvents` faz `GET /pipeline-events` → hidrata timeline com histórico persistido.
4. Inspector renderiza `walls/slabs` do `etapa4_fusao`.
5. Planta anotada vem do `etapa3_annotated_plan.data.images[0].image`.

Não há nova chamada de IA. Tudo é leitura do que foi persistido.

---

# PARTE III — PIPELINE DE PROCESSAMENTO (22 ETAPAS)

## 11. Visão geral

O pipeline está implementado em **`server/routes.ts`** no handler `POST /api/projects/:id/process` (~3000 linhas). É um único async function gigante que executa as etapas sequencialmente, com try/catch isolados por etapa para graceful degradation.

A separação em etapas numeradas (0.5, 1, 1.5, 2.5, 3, 3.4, 3.5, 3.6, 3.7, 3.8, 4, 4.5, 4.55, 4.6, 4.65, 4.7, 4.9, 5, 6, 6.5, 7, 7.5, 8) é **convenção interna** — números decimais permitem inserir novas etapas sem renumerar. Cada etapa emite eventos `stage` via SSE com seu número.

### Tabela compacta (referência rápida)

| # | Nome | Onde roda | Custo IA | Latência típica | Falha? |
|---|---|---|---|---|---|
| 0.5 | Pre-flight | per arquivo | zero | <1s | continua silente |
| 1 | Classificação + Tabelas | per arquivo (Gemini Pro) | ~US$ 0,02 | 20-40s | etapa 3 ainda tenta |
| 1 | Leitura IFC | per arquivo (.ifc) | zero | <1s | etapa 3 não roda |
| 1.5 | Caracterização | global (Gemini Pro) | ~US$ 0,02 | 15-25s | usa hardcoded |
| 2.5 | Vetor PDF nativo | per arquivo PDF | zero | 2-5s | OpenAI/Gemini ainda roda |
| 3 | Extração geométrica | per arquivo (Gemini Flash) | ~US$ 0,07 | 120-180s | erro → failedPages[] |
| 3.4 | CV Pipeline | global (CV service) | zero | 30-90s | fallback Gemini-only |
| 3.5 | Inventário endpoints | global (Gemini Pro) | ~US$ 0,04 | 60-90s | walls sem endpoints |
| 3.6 | Cotas focadas | global (Gemini Pro) | ~US$ 0,03 | 40-60s | comprimento herdado |
| 3.7 | Topologia + envelope | global (Gemini Pro) | ~US$ 0,02 | 30-45s | mantém classif IA |
| 3.8 | Lajes polygon | global (determinístico) | zero | <1s | área original |
| 4 | Fusão multivista | global (determinístico) | zero | <1s | erro fatal |
| 4.5 | Validação geométrica | global (determinístico) | zero | <1s | sempre roda |
| 4.55 | Esquadrias linker | global (determinístico) | zero | <1s | sem cruzamento |
| 4.6 | Validação global IA | global (Gemini Pro) | ~US$ 0,02 | 20-30s | continua sem |
| 4.65 | Reconciliação CV↔LLM | global (determinístico) | zero | <1s | só com LLM |
| 4.7 | Validação por cortes | global (Gemini Pro, opt) | ~US$ 0,01 | 15-20s | pé-direito default |
| 4.9 | SelfCheck | global (determinístico) | zero | <1s | sem notas |
| 5 | Quantitativos | global (determinístico) | zero | <1s | erro fatal |
| 6 | Catálogo + preços | global (determinístico) | zero | <1s | preços padrão |
| 6.5 | Auto-Auditoria | global (determinístico) | zero | <1s | sem auditoria |
| 7 | Validação final | global (determinístico) | zero | <1s | sempre roda |
| 7.5 | Imagem anotada | global (Sharp + SVG, paralelo com 8) | zero | 500ms-3s | annotationErrors[] |
| 8 | Descrição (prosa) | global (Gemini Pro, paralelo com 7.5) | ~US$ 0,02 | 20-40s | mensagem padrão |

**Total típico**: ~US$ 0,25 + 3-7 minutos para projeto residencial padrão.

---

## 12. Detalhe etapa por etapa

### Etapa 0.5 — Pre-flight

**Arquivo**: `server/services/preflight/inspector.ts`
**Onde roda**: por arquivo, no início do loop.

**O que faz**:
- Inspeção rápida sem chamar IA.
- Detecta tipo real (PDF vetorial vs raster vs imagem vs IFC).
- Conta páginas do PDF, verifica se tem texto extraível, estima DPI.
- Recomenda modo de extração (`pdf-vector-first` para PDFs com cotas confiáveis, `image-ai` para raster, etc).

**Input**: arquivo no disco (`filePath`, `fileType`).

**Output**: objeto `PreflightResult` com:
```typescript
{
  fileType: "pdf" | "image" | "ifc";
  isPdfVector: boolean;
  pageCount: number;
  hasText: boolean;
  dim: { w, h }; // estimativa de DPI
  pathsCount?: number; // só PDF vetorial
  modeRecommended: "pdf-vector-first" | "image-ai" | "ifc-direct";
  notes: string[];
}
```

**Falha?**: gracefully skipped. Sempre tenta a etapa seguinte.

---

### Etapa 1 — Classificação + Tabelas

**Arquivo**: `server/services/gemini/planAnalyzer.ts:classifyAndExtractTables`
**Onde roda**: por arquivo (depois de pre-flight, exceto para IFC que vai direto pro parser IFC).
**Modelo**: `gemini-2.5-pro` (multimodal).

**O que faz**:
1. Splita o arquivo em páginas (`splitPdfPages` ou single image).
2. Para cada página, faz **uma única chamada** Gemini que:
   - Classifica a página (`planta_baixa`, `corte`, `fachada`, `tabela_quantitativo`, `quadro_esquadrias`, `detalhe_construtivo`, `vista_3d`, `irrelevante`).
   - Identifica o pavimento (nome literal: "Terreo", "Superior", "Subsolo", "Cobertura", "Pavimento1", etc).
   - Extrai tabelas presentes (paredes de quadro, esquadrias de quadro, áreas).
3. Pós-processa o pavimento com `normalizePavimento()` — aliases conhecidos, regex para "1 Pavimento", fallback "Terreo" quando incerto. **Nunca retorna "Outro"**.

**Input**: arquivo + páginas.

**Output**:
```typescript
{
  classifications: [
    { page_index: 0, classificacao: "planta_baixa", pavimento: "Terreo", has_table: true, has_scale: true },
    ...
  ],
  tableData: {
    paredes_de_tabela: [...],
    esquadrias_de_tabela: [...],
    areas_de_tabela: [...]
  },
  detectedBuildingType: "residencial",
  failedPages: [] // páginas que não foram parseadas
}
```

**Falha?**: páginas falhadas viram `failedPages`; etapa 3 ainda tenta processar as outras.

---

### Etapa 1.5 — Caracterização do projeto

**Arquivo**: `server/services/extraction/projectCharacterization.ts:characterizeProject`
**Onde roda**: global, depois que todas as classificações estão prontas.
**Modelo**: `gemini-2.5-pro` (multimodal).

**O que faz**:
- Recebe as imagens das plantas baixas + hint do tipo de edificação do usuário.
- Faz **uma chamada** Gemini pedindo um JSON estruturado:
  - `typology` (casa_terrea, sobrado, edificio, comercial_loja, etc).
  - `pavimentos[]` (lista de nomes literais).
  - `programa[]` (ambientes detectados: quarto, sala, cozinha, etc).
  - `padrao` (popular, medio, alto).
  - `estimativas` (ranges esperados de paredes, esquadrias, espessura, pé-direito, área).
  - `caracteristicas` (temCobertura, temGaragem, temMuros, etc).
  - `confidence` (high/medium/low).
- Esse JSON alimenta as etapas seguintes — **especialmente a Etapa 3**, que recebe os ranges esperados como hint para calibrar a extração.

**Input**: imagens + hint de buildingType.

**Output**: `ProjectCharacterization` (tipado) ou `null` se falhar.

**Falha?**: continua. Etapas downstream usam fallbacks hardcoded baseados em `buildingTypePrompts.ts`.

**Custo**: ~US$ 0,02 (uma chamada, ~500KB imagens + 2KB prompt + 2KB JSON output).

---

### Etapa 2.5 — Vetor PDF nativo

**Arquivo**: `server/services/preflight/pdfVectorExtractor.ts`
**Onde roda**: por arquivo (só PDFs vetoriais, condicional ao pre-flight).
**Sem IA**: parser determinístico.

**O que faz**:
1. Lê todas as paths vetoriais do PDF (`pdf-lib`).
2. Filtra paredes candidatas por:
   - Comprimento entre 0,5m e 30m.
   - Espessura entre 0,08m e 0,30m.
   - Tipo de linha (sólida, não tracejada).
3. Calcula escala via **clusterização de cotas** (`clusterRatios`):
   - Agrupa textos numéricos do PDF por tolerância ±15%.
   - Se cluster com ≥3 cotas e ≥40% do total → usa cluster.
   - Senão fallback mediana ±25%.
   - Senão fallback **1:50 hardcoded** (escala presumida).
4. Quando a escala é "fallback 1:50" (não confiável), **descarta as paredes vetoriais** — etapa 3 (Gemini) cobre.

**Input**: PDF + páginas classificadas como planta_baixa.

**Output**: `{ walls, slabs, corners, scale, candidateWallCount, pagesProcessed, notes }`.

**Falha?**: pulado silenciosamente.

**Limitação conhecida**: em PDFs com muitas dimensões pequenas (detalhes), cluster fica em 5-10% das cotas. Sistema descarta extração vetorial e Gemini cobre.

---

### Etapa 3 — Extração geométrica

**Arquivo**: `server/services/gemini/planAnalyzer.ts:extractGeometryParallel`
**Onde roda**: por arquivo (depois do inventário/caracterização para receber hints).
**Modelo**: `gemini-2.5-flash` (rápido, custo baixo).

**O que faz**:
1. Agrupa páginas por pavimento (`floorGroups`).
2. Para cada pavimento, faz **uma chamada** Gemini com:
   - Imagens das plantas baixas desse pavimento.
   - Imagens de cortes/fachadas (até 2) para contexto de pé-direito.
   - Prompt detalhado com:
     - Definições explícitas de muro, parede externa, parede interna, laje piso, laje coberta.
     - **Etapas obrigatórias**: identificar cômodos → identificar muros → traçar envoltória → classificar paredes externas → classificar paredes internas → listar lajes → ler cotas.
     - **Caracterização da Etapa 1.5 injetada como hint** ("paredes esperadas: 25-35", "espessura típica 0.10-0.15m", etc).
   - Output esperado em JSON com `walls[]`, `slabs[]`, `corners[]`.
3. Após o parse, faz uma **verificação per-floor** com outra chamada Gemini (mais barata) que checa coerência.

**Input**: imagens das plantas + caracterização + buildingType + peDireito.

**Output**:
```typescript
{
  walls: [
    {
      id: "P1",
      nivel: "Terreo",
      classe: "externa" | "interna" | "muro",
      comprimento_m: 5.5,
      altura_m: 3.0,
      espessura_m: 0.10,
      measurement_source: "dimension_text" | "inferred_from_symbol",
      confidence: 0.9,
      has_door: true,
      has_window: false,
      opening_area_m2: 1.68,
      esquadrias: [...],
      box_2d: [ymin, xmin, ymax, xmax] // opcional
    },
    ...
  ],
  slabs: [...],
  corners: [...],
  failedPages: []
}
```

**Falha?**: páginas falhadas viram `failedPages`. Walls que vieram são persistidas mesmo assim.

**Custo**: ~US$ 0,05-0,10 por arquivo (1 chamada Pro para extrair + 1 Flash para verificar).
**Latência**: 120-180s (gargalo do pipeline).

---

### Etapa 3.4 — CV Pipeline (Fase E)

**Arquivo**: `server/services/cv-service/client.ts`
**Onde roda**: global (depois de todas as Etapas 3 por arquivo).
**Tipo**: chamada HTTP a micro-serviço Python.

**O que faz** (quando online):
1. Verifica `cv-service` está vivo (`/health`).
2. Para cada planta baixa, posta para `/extraction/full_extraction/stream` (SSE).
3. Recebe sub-eventos:
   - `preprocess` → binariza imagem.
   - `skeletonize` → reduz paredes a eixos.
   - `ocr` → lê dimensões.
   - `wall_detect` → detecta endpoints.
   - `envelope` → calcula envoltória da edificação.
   - `classify` → classifica paredes determinístico.
4. Persiste resultado em `extracted_data` como `cv_extraction`.

Quando offline (status: `cv-service offline — pulando`), o pipeline continua sem refinamento CV. **Esse é o caso mais comum em produção** porque o cv-service não está deployado por padrão.

**Input**: imagens das plantas + envelopes pré-calculados (opcional).

**Output**: estrutura paralela à da Etapa 3, mas com endpoints precisos via OpenCV.

**Falha?**: silent skip. **Pipeline continua em modo "Gemini-only"**.

---

### Etapa 3.5 — Inventário (endpoints)

**Arquivo**: `server/services/extraction/wallInventory.ts:inventoryWalls + mergeEndpointsIntoWalls`
**Onde roda**: global.
**Modelo**: `gemini-2.5-pro` (focado).

**O que faz**:
1. Faz **uma chamada** Gemini com prompt curtíssimo:
   > "Liste TODAS as paredes desta planta como segmentos de reta. Para cada uma: p1, p2 em coords 0-1000; thickness_pct; has_door; has_window; confidence."
2. Recebe lista de `WallSegment[]` com endpoints e espessura.
3. Mergeia esses segments nas walls da Etapa 3:
   - Para cada wall com bbox, busca o segment com melhor IoU + proximidade de centro.
   - Threshold: `IoU ≥ 0.10` OU `distância < 60` em coords 0-1000.
   - **Fallback cross-pavimento**: quando o pavimento da wall é genérico ("Outro", vazio), usa TODOS os segments.

**Input**: walls da Etapa 3 + imagens das plantas.

**Output**: walls enriquecidas com `{ endpoints: { p1, p2 }, thickness_pct }`. Quantidade casada vai no log: `[INVENTARIO] Match: N/M paredes; K segmentos detectados`.

**Falha?**: walls ficam sem endpoints — Etapa 7.5 cai pra renderização menos precisa.

**Limitação conhecida**: prompt focado é melhor que prompt monolítico, mas match estrito ainda falha quando bbox da Etapa 3 está deslocado. Match típico: 60-80% em projetos limpos.

---

### Etapa 3.6 — Cotas focadas (Fase B / S7)

**Arquivo**: `server/services/extraction/cotaReader.ts`
**Onde roda**: global.
**Modelo**: `gemini-2.5-pro`.

**O que faz**:
1. Faz **uma chamada** pedindo APENAS lista de cotas dimensionais (texto numérico + posição em coords 0-1000 + direção).
2. Associa cada cota à parede mais próxima e perpendicular.
3. Sobrescreve `comprimento_m` da parede com `measurement_source="cota_text_focused"` quando casa.

**Input**: imagens + walls com endpoints (Etapa 3.5).

**Output**: walls com comprimentos refinados.

**Falha?**: comprimento herdado da Etapa 3.

---

### Etapa 3.7 — Topologia (envelope + classificação)

**Arquivo**: `server/services/extraction/topology.ts:classifyWallsByTopology`
**Modelo**: `gemini-2.5-pro` para detectar envelope; resto é determinístico.

**O que faz**:
1. Pede para Gemini desenhar o **envelope** (polígono fechado da edificação coberta) — só esse output, nada mais.
2. Para cada parede com endpoints (ou bbox):
   - Calcula 2 pontos vizinhos perpendiculares ao eixo (um de cada lado).
   - Testa `pointInPolygon(ponto, envelope)`:
     - Ambos dentro → **interna**.
     - 1 dentro / 1 fora → **externa** (parede da fachada).
     - Ambos fora + lote disponível + ambos dentro do lote → **muro**.
     - Senão → externa (segmento de borda).
3. Sobrescreve `classe` da Etapa 3 quando difere.

**Input**: walls + envelope.

**Output**: walls reclassificadas + lista de envelopes por pavimento.

**Falha?**: mantém classificação da IA (Etapa 3).

**Vantagem**: classificação determinística, baseada em geometria pura, não em "achismo" do LLM. Robusto a vista_3d, mobiliário, etc.

---

### Etapa 3.8 — Lajes (polygon refinement)

**Arquivo**: `server/services/extraction/slabRefiner.ts`
**Sem IA**.

**O que faz**:
- Refina áreas de lajes usando o polígono do envelope (shoelace formula).
- Garante consistência piso × cobertura.

**Falha?**: usa `area_m2` original da Etapa 3.

---

### Etapa 4 — Fusão multivista

**Arquivo**: `server/services/calculation/engine.ts:fusionMultiView`
**Sem IA**. **Fatal se falhar**.

**O que faz**:
1. Recebe walls/slabs de TODAS as extrações (Etapa 2.5 vetorial + Etapa 3 IA + Etapa 3.4 CV).
2. **Deduplica** por assinatura (`nivel + classe + espessura_bucket + comprimento_bucket`).
3. **Detecta over-extraction multi-página**: se mesma parede aparece em 2+ páginas com nivel/classe/dimensões similares, mantém só a da página dominante.
4. **Dedup geométrica**: paredes internas que são paralelas e próximas a uma externa são removidas (externa prevalece).
5. **Reclassifica por score**: se todas as walls vieram como "externa" da Etapa 3 (erro comum), reclassifica algumas como interna por score (perímetro vs interior).
6. Auto-gera lajes faltantes:
   - Laje radier para Terreo (sempre).
   - Laje coberta espelhando o piso do último pavimento (quando IA não detectou).
7. **Marca para revisão humana** paredes com classificação divergente entre score e Etapa 3.

**Input**: `allGeometries[]` + `mergedTableData` + `buildingType` + `wallFeedbacks` (humanos) + `sideHints`.

**Output**:
```typescript
{
  walls: [...],   // deduplicadas, reclassificadas
  slabs: [...],
  corners: [...]
}
```

**Falha?**: erro fatal. Pipeline para com `status=error`.

---

### Etapa 4.5 — Validação geométrica

**Arquivo**: `server/services/calculation/geometryValidator.ts`
**Sem IA**.

**O que faz**:
- Remove walls com:
  - `comprimento` ≤ 0,3m ou > 50m.
  - `espessura` < 0,05m ou > 0,5m.
  - `area_liquida_m2` ≤ 0.
- Remove slabs com `area_m2` ≤ 0.

**Output**: `validatedGeometry` + log `[VALIDATOR] paredes: 22→22 (-0) | lajes: 3→3 (-0)`.

---

### Etapa 4.55 — Esquadrias linker

**Arquivo**: `server/services/extraction/esquadriasLinker.ts`
**Sem IA**.

**O que faz**:
- Cruza esquadrias detectadas pelas paredes (Etapa 3) com o quadro de esquadrias extraído pelas tabelas (Etapa 1).
- Match por código (P1, J1, etc) ou por dimensões similares.
- Atualiza paredes com dimensões corretas das esquadrias.

---

### Etapa 4.6 — Validação global IA

**Arquivo**: `server/services/extraction/globalValidator.ts`
**Modelo**: `gemini-2.5-pro`.

**O que faz**:
- Recebe walls + slabs + plantas + cortes + fachadas.
- Pede a Gemini para identificar inconsistências cruzadas (ex: parede aparece na planta mas não no corte, altura diferente, etc).
- Aplica correções pontuais.

**Falha?**: continua sem correção.

---

### Etapa 4.65 — Reconciliação CV ↔ LLM

**Arquivo**: `server/services/extraction/cvReconciliation.ts`
**Sem IA**.

**O que faz** (quando CV está online):
- Compara walls do LLM (Etapa 3) com walls do CV (Etapa 3.4) lado a lado.
- Quando divergem significativamente, registra `audit_notes` com `kind="cv_disagreement"` ou `cv_match`.
- Não modifica walls (preserva LLM como source of truth na fusão).

---

### Etapa 4.7 — Validação por cortes (opcional)

**Modelo**: `gemini-2.5-pro` (só se há cortes).

**O que faz**: extrai pé-direito real dos cortes/fachadas, sobrescreve `altura_m` default das walls quando disponível.

---

### Etapa 4.9 — SelfCheck

**Arquivo**: `server/services/extraction/selfCheck.ts`
**Sem IA**.

**O que faz**: roda **9 checks determinísticos**:
1. `PROVENANCE_SUMMARY` — quantas walls vieram de qual fonte?
2. `POUCAS_EXTERNAS_PARA_PERIMETRO` — se envelope tem 15 vértices mas só 3 paredes externas, suspeito.
3. `ESQUADRIA_COUNT_BAIXO` — se classifications dizem `has_door=true` mas zero esquadrias extraídas, alerta.
4. `PISO_COBERTA_DIVERGENTES` — se laje piso ≠ laje coberta em mais de 50%, alerta (tipico de beiral).
5. `SCORE_PEDIRETO_DESVIANTE` — pé-direito muito fora do range para tipologia.
6. `PERIMETRO_VAZIO` — fusão saiu com 0 paredes externas.
7. `RANGES_ESQUADRIAS` — dimensões fora do esperado.
8. `LAJE_AREA_DIVERGENTE` — área de laje muito diferente da soma dos cômodos.
9. `PAREDES_TOTAL_FORA_RANGE` — caracterização disse "esperado 25-35", veio 5 ou 80.

**Output**: `audit_notes[]` com severity (info / warning / error).

**Falha?**: continua sem notas.

---

### Etapa 5 — Cálculo de quantitativos

**Arquivo**: `server/services/calculation/engine.ts:calcularBudget`
**Sem IA**. **Fatal se falhar**.

**O que faz**:
- Aplica regras do Manual Biomassa:
  - Painéis externos: 2P 90mm a cada N metros de parede.
  - Painéis internos: SP 90mm com fator de aproveitamento.
  - Muros: igual externas, mas sem desconto de esquadrias.
  - Laje piso e coberta: m² × 1 painel/m².
- Descontos por esquadrias.
- Quebras técnicas (5% padrão).

**Output**: `budget.pavimentos[]` com quantidades por categoria.

---

### Etapa 6 — Catálogo + preços

**O que faz**:
- Aplica perfil de preço (default ou do usuário).
- Multiplica quantitativos × preço unitário.
- Aplica desconto global (`discountPanelPct`).
- Soma frete e biomassa (overhead fixo).

**Output**: `budget.totalCost`, `budget.consolidado`.

---

### Etapa 6.5 — Auto-Auditoria (PR2 ainda em construção)

Wrapper que emite `audit_finding` events para o SSE com base no `audit_notes`. Ainda pequeno.

---

### Etapa 7 — Validação final

**Sem IA**. **Sempre roda**.

**O que faz**: cruza áreas (envelope vs soma cômodos vs piso vs coberta). Identifica inconsistências críticas / médias / baixas.

**Output**: `validacao.inconsistencias[]`.

---

### Etapa 7.5 — Imagem anotada

**Arquivo**: `server/services/annotation/renderer.ts:renderAnnotatedImage`
**Sem IA**. Roda em paralelo com Etapa 8.

**O que faz**:
1. Rasteriza PDF/imagem original.
2. Para cada wall (preferência: usa `wallSegments` da Etapa 3.5 quando disponível):
   - Calcula polígono retangular a partir de `endpoints + thickness_pct`.
   - Pinta no SVG com cor por classe (vermelho/verde/azul) + fillOpacity 0.55.
3. Adiciona legenda no rodapé.
4. Compõe SVG sobre a imagem com `sharp`.

**Output**: `annotatedImages[]` com data URLs.

**Falha?**: registra em `annotationErrors[]` no record `etapa3_annotated_plan`. UI mostra card vermelho explicando o motivo.

---

### Etapa 8 — Descrição (prosa)

**Modelo**: `gemini-2.5-pro`.

**O que faz**: gera markdown com:
- Identificação do projeto (tipo, pavimentos, padrão).
- Características gerais (área, ambientes).
- Solução técnica adotada.
- Observações de auditoria.

**Output**: `budget.projectDescription` (string markdown).

---

## 13. Aborto cooperativo

**Arquivos**:
- `server/services/pipelineAbort.ts` — Set em memória + helpers `requestAbort`, `clearAbort`, `throwIfAborted`, `isAborted`.
- `server/routes.ts` — endpoint `POST /api/projects/:id/abort` + checkpoints em 5 lugares (antes das Etapas 1.5, 3.4, 3.5, 3.7, 4.55).

**Fluxo**:
1. Usuário clica "Abortar" na UI (ProcessingLiveView).
2. Frontend faz `POST /api/projects/:id/abort`.
3. Backend chama `requestAbort(projectId)` → adiciona ao Set.
4. Próximo checkpoint do pipeline detecta a flag e lança `PipelineAbortedError`.
5. Try/catch externo captura, marca projeto como `error`, emite `sendProgress(0, "Erro", ..., "Abortado pelo usuário")`.
6. SSE fecha. UI mostra `ErrorState`.

**Limitação**: chamadas LLM em vôo terminam naturalmente. Aborto típico responde em 5-30s; pode chegar a 2min se cair no meio da Etapa 3.

---

# PARTE IV — FRONTEND

## 14. Stack tecnológica (recap detalhado)

Já listada na seção 7, vamos aprofundar nas escolhas:

- **React 18.3** com hooks. Suspense ainda não usado.
- **Vite** para HMR + build de produção. Bundle do client está em ~710 KB (gzip: ~207 KB) — abaixo do threshold de warning do Vite.
- **Wouter** ao invés de React Router: ~1.5 KB vs ~30 KB. Router em SPA simples.
- **TanStack Query** para estado de servidor. Cache automático, invalidação por mutação, polling opcional.
- **Tailwind + Radix + shadcn**: utility CSS + componentes acessíveis sem opinião visual.
- **Lucide icons** (Lucide React).

## 15. Estrutura de páginas (`client/src/pages/`)

| Página | Rota | Função |
|---|---|---|
| `Dashboard.tsx` | `/` | Lista de projetos do usuário; cards com status e ações rápidas (excluir, processar) |
| `NewProject.tsx` | `/new` | Wizard de criação: nome + cliente + tipo + edificação |
| `ProjectDetails.tsx` | `/project/:id` | Tela principal: header + workspace adaptativo + sidebar + footer. ~1100 linhas (depois do redesign) |
| `Login.tsx` | `/login` | Auth básica |
| `Settings.tsx` | `/settings` | Chaves de API (Gemini, OpenAI), preferências |
| `Catalogo.tsx` | `/catalogo` | Gerenciamento de SKUs (admin) |
| `Calibracao.tsx` | `/calibracao` | Painel de calibração: projetos reais vs estimados para fine-tuning |
| `Diagnostics.tsx` | `/diagnostics` | Health checks (DB, Gemini, CV service) |
| `Usuarios.tsx` | `/usuarios` | Gerenciamento de usuários (admin) |
| `Profiles.tsx` | `/profiles` | Perfis de preço (region + cliente) |

## 16. Componentes-chave

### 16.1 Componentes do projeto (`client/src/components/project/`)

| Componente | Responsabilidade |
|---|---|
| `ProjectHeader.tsx` | Header fixo: voltar, nome editável, status badge, tipo Teste/Real, edificação, chips de Tempo/Custo/Tokens |
| `ProjectSidebar.tsx` | **Sidebar persistente direita 320px** — substitui o menu kebab. Seções colapsáveis: Resumo, Telemetria, Análise IA, Arquivos, Etapas técnicas, Metodologia, Exportar, Zona de perigo |
| `DraftWorkspace.tsx` | Layout do estado `draft`: dropzone + preview à esquerda (60%); config (provider, pé-direito, escopo, painéis, CTA "Processar") à direita (40%) |
| `ErrorState.tsx` | Card vermelho centralizado com causa do erro + botão "Reprocessar" |
| `CompletedFooter.tsx` | Footer expansível: Total R$ + botão Exportar XLSX. Click "Detalhar" expande mostrando categorias, ajustes e KPIs |
| `ProjectMenu.tsx` | **OBSOLETO** — vai ser removido em cleanup. Era o menu kebab antes da sidebar |

### 16.2 Componentes do workspace de quantitativos (`client/src/components/processing/`)

| Componente | Responsabilidade |
|---|---|
| `WorkspaceLayout.tsx` | Layout grande para `status="completed"`: header + PlantaWorkspace (esq) + InspectorPanel (dir) + ProjectActionBar |
| `PlantaWorkspace.tsx` | Mostra a planta anotada (server-rendered ou fallback client-side) com overlay SVG de paredes |
| `InspectorPanel.tsx` | Painel direito do WorkspaceLayout — abas Paredes, Lajes, Auditoria. (Vai ser MIGRADO para dentro da ProjectSidebar futuramente) |
| `ProcessingHeader.tsx` | Header do WorkspaceLayout com KPI pills (custo, tempo, walls, slabs) |
| `TechnicalDrawer.tsx` | Drawer pra timeline/logs/audit detalhados |
| `useProcessingSync.ts` | Hook que sincroniza hover/select entre planta e inspector |

### 16.3 Componentes do pipeline ao vivo (`client/src/components/live-pipeline/`)

| Componente | Responsabilidade |
|---|---|
| `ProcessingLiveView.tsx` | Tela durante `status="processing"`: stepper sticky + timeline + grid imagens + erros |
| `LiveStepper.tsx` | Stepper horizontal com 17 etapas em flex-wrap (sem scroll). Pílula ativa mostra descrição inline. Tooltip sob hover. |
| `EventTimeline.tsx` | Log agrupado por etapa, expansível, com filtros por kind e "Apenas erros" |
| `RenderedImagesGrid.tsx` | Thumbnails das plantas anotadas geradas ao vivo |
| `ErrorsPanel.tsx` | Lista de falhas + audit findings ordenados |
| `AiCallCard.tsx` | Card individual de chamada IA (modelo, tokens, custo, duração, status) |
| `useProcessingEvents.ts` | Hook que consome SSE `/ai-events` + hidrata via `GET /pipeline-events`. Reducer agrega state |

### 16.4 Hooks compartilhados (`client/src/hooks/`)

| Hook | Função |
|---|---|
| `useSseWithRetry.ts` | EventSource com backoff exponencial bounded (5 retries 1.5s → 24s) + callback `onMaxRetriesExceeded` para toast com "Reconectar" |
| `useToast.ts` | Toast notifications via shadcn |

### 16.5 Libs (`client/src/lib/`)

| Lib | Função |
|---|---|
| `wallGeometry.ts` | `endpointsToWallPolygon(p1, p2, thicknessPct)` — espelha o helper do server. Usado no overlay SVG client-side |
| `queryClient.ts` | Config do TanStack Query (defaultStaleTime, etc) |
| `utils.ts` | `cn()` para merge de classes Tailwind |

## 17. UX adaptativa por status

A página `ProjectDetails` muda o conteúdo do `<main>` baseado em `project.status`:

### 17.1 Status `draft`

```
┌──────────────────────────────────────────────────────────┐
│ ProjectHeader (sticky)                                   │
├─────────────────────────────────────────┬────────────────┤
│ DraftWorkspace:                          │ ProjectSidebar │
│ ┌─────────────────────────┐  ┌────────┐ │ ▼ Resumo       │
│ │ Drop zone               │  │ Config │ │ ▼ Telemetria   │
│ │ + lista de arquivos     │  │        │ │   (vazia)      │
│ │ + preview planta crua   │  │ Pé-d.  │ │ ▼ Análise IA   │
│ │   (1ª img/página)       │  │ Escopo │ │   (vazia)      │
│ │                         │  │        │ │ ▼ Arquivos     │
│ │                         │  │ [CTA]  │ │   PDF1.pdf     │
│ └─────────────────────────┘  └────────┘ │ ▼ Metodologia  │
│                                          │ ▼ Exportar     │
│                                          │   (vazio)      │
│                                          │ ▼ Perigo       │
└──────────────────────────────────────────┴────────────────┘
```

### 17.2 Status `processing`

```
┌──────────────────────────────────────────────────────────┐
│ ProjectHeader (sticky)                                   │
├─────────────────────────────────────────┬────────────────┤
│ ProcessingLiveView:                      │ ProjectSidebar │
│ ┌───────────────────────────────────────┐│ ▼ Resumo       │
│ │ Stepper sticky (17 etapas, wrap)      ││ ▼ Telemetria   │
│ │ [0.5][1*][1.5][2.5][3]...[8]          ││   2m 45s       │
│ │     ▲ ativa, descrição inline         ││   US$ 0.18    │
│ └───────────────────────────────────────┘│ ▼ Pipeline ao  │
│ Imagens renderizadas (grid)              │   vivo         │
│ Timeline detalhada                       │ ▼ Análise IA   │
│ Erros (se houver)                        │   (em const.)  │
│ [Abortar]                                │ ▼ Arquivos     │
└──────────────────────────────────────────┴────────────────┘
```

### 17.3 Status `completed`

```
┌──────────────────────────────────────────────────────────┐
│ ProjectHeader (sticky)                                   │
├─────────────────────────────────────────┬────────────────┤
│ WorkspaceLayout:                         │ ProjectSidebar │
│ ┌─────────────────────┬───────────────┐  │ ▼ Resumo       │
│ │ PlantaWorkspace     │ InspectorPanel│  │ ▼ Telemetria   │
│ │ (planta anotada)    │ Paredes/Lajes │  │ ▼ Análise IA   │
│ │                     │ /Auditoria    │  │   "Casa 204m²" │
│ │                     │               │  │ ▼ Arquivos     │
│ │                     │               │  │ ▼ Etapas       │
│ └─────────────────────┴───────────────┘  │ ▼ Metodologia  │
│ Footer R$ 143.929 [Detalhar▾][XLSX]     │ ▼ Exportar     │
│                                          │   XLSX/PDF/JSON│
└──────────────────────────────────────────┴────────────────┘
```

### 17.4 Status `error`

```
┌──────────────────────────────────────────────────────────┐
│ ProjectHeader                                            │
├─────────────────────────────────────────┬────────────────┤
│                                          │ ProjectSidebar │
│      ⚠ Processamento falhou             │                │
│      <mensagem da causa>                 │                │
│      [Reprocessar]                       │                │
│                                          │                │
└──────────────────────────────────────────┴────────────────┘
```

## 18. Sidebar persistente direita (commit `6839bb1`)

A sidebar substituiu o menu kebab (⋮). É um `<aside>` de 320px à direita, sempre visível, com seções colapsáveis (`<details>`-style com state local).

### Seções disponíveis

| Ordem | Seção | Conteúdo | Quando aparece |
|---|---|---|---|
| 1 | Resumo | Cliente + email (mailto:) + edificação + fingerprint | Sempre, aberta por padrão |
| 2 | Telemetria | Cards de Tempo / Custo IA / Tokens | Quando há valores |
| 3 | Inspeção | Walls + lajes (próxima iteração move do WorkspaceLayout) | TBD |
| 4 | Pipeline ao vivo | Drill-down de eventos | Durante processing |
| 5 | Análise IA | Descrição em prose | Após processado |
| 6 | Arquivos | Lista compacta com botão "ver" | Sempre |
| 7 | Etapas técnicas | Viewer raw do extracted_data | Após processado |
| 8 | Metodologia | Componente Metodologia (lazy) | Sempre |
| 9 | Exportar | XLSX / PDF / JSON | Após processado |
| 10 | Zona de perigo | Botão Excluir projeto | Sempre |

## 19. Stepper sticky + Live Pipeline + Eventos SSE

### 19.1 Stepper sticky

O `LiveStepper` fica em um `<div className="sticky top-[3.5rem]">` dentro do `ProcessingLiveView`. Permanece visível durante o scroll da timeline.

Cada pílula tem 4 estados visuais (pending / started / completed / failed) e mostra:
- Pendente: ícone Circle + número + label compacto.
- Em execução: ícone Loader2 girando + descrição inline + glow azul.
- Concluída: ícone CheckCircle2 verde + label.
- Falhou: ícone AlertCircle vermelho + errorMessage inline.

Tooltips em todas as pílulas mostram a descrição completa + detail/error do stage state.

### 19.2 Live Pipeline (eventos SSE)

O hook `useProcessingEvents` mantém um state agregado:

```typescript
interface ProcessingState {
  events: PipelineEvent[];          // todos os eventos brutos
  stages: Map<string, StageState>;  // status por etapa
  aiCalls: AiCallState[];           // chamadas Gemini/OpenAI
  renderedImages: RenderedImage[];  // image_render events
  auditFindings: AuditFindingEvent[];
  errors: PipelineErrorItem[];
  totalCostUsd: number;             // soma de ai_call.completed.costUsd
  totalTokens: number;
  startedAt: number | null;
  finishedAt: number | null;
}
```

O reducer **invariantes**:
- `startedAt = Math.min(state.startedAt, e.timestamp)` (garante não negativo).
- `finishedAt = Math.max(state.finishedAt, e.timestamp)` (garante consistência).

Hidratação inicial via `GET /pipeline-events` (eventos persistidos). SSE só abre quando `enabled=true` (durante processing).

### 19.3 Eventos suportados

| Kind | Quando emitido | Renderização |
|---|---|---|
| `stage` | Mudança de fase de cada etapa | Pílula no stepper |
| `ai_call` | Chamada Gemini/OpenAI (started/completed/failed) | AiCallCard com modelo, tokens, custo |
| `pdf_split` | Cada página fatiada do PDF | Linha compacta no log |
| `cv_substep` | Sub-passos do cv-service | Barra de progresso |
| `image_render` | Cada planta anotada (started com skeleton, completed com thumbnail) | RenderedImagesGrid |
| `audit_finding` | Notas estruturadas do SelfCheck | Badge severity no ErrorsPanel |

## 20. Render da planta anotada

### 20.1 Server-side (preferencial)

`server/services/annotation/renderer.ts:renderAnnotatedImage`:

1. Recebe walls + slabs + opções (estilo, labels, espessura default).
2. Rasteriza PDF/imagem em PNG (via `pdf-to-png-converter` ou copia direto).
3. Calcula SVG overlay:
   - Para cada wall, helper `endpointsToWallPolygon(p1, p2, thicknessPct)` retorna 4 vertices.
   - Pinta `<polygon fill="#dc2626" fillOpacity="0.55">` para externa, verde para interna, azul para muro.
4. Compõe SVG sobre o PNG com `sharp`.
5. Retorna PNG final.

### 20.2 Fallback client-side

Quando o server falha em gerar (etapa 7.5 com erro), a UI cai num fallback:
- Mostra a planta original (referenceImages).
- Desenha overlay SVG no React (`PlantaWorkspace.tsx`) usando o mesmo helper `endpointsToWallPolygon` (portado para `client/src/lib/wallGeometry.ts`).
- Banner azul: "Renderização do servidor falhou — overlay client-side".
- Card vermelho com `annotationErrors` quando disponíveis.

Visualmente quase idêntico ao server-side. Vantagem: usuário sempre vê algo, nunca tela em branco.

# PARTE V — BACKEND

## 21. Tecnologias

Stack detalhada na seção 7. Recap:
- **Node 22** (LTS).
- **Express 5** (não 4 — tem `next()` async, melhores typings).
- **Drizzle ORM** — schema TS direto, query builder type-safe.
- **pg (node-postgres)** — pool de conexões.
- **sharp** — composite SVG + PNG.
- **p-retry + p-limit** — retry exponencial + concorrência bounded.
- **Multer** — multipart upload.
- **connect-pg-simple** — store de sessões em Postgres.

## 22. Estrutura de `server/`

```
server/
├── index.ts                    # Entry point. Setup Express + auth + routes
├── routes.ts                   # Orquestrador principal (4400+ linhas)
├── auth.ts                     # Passport setup
├── db.ts                       # Drizzle + pg pool
├── storage.ts                  # IStorage interface + implementação Drizzle
├── bootstrap-schema.ts         # Self-heal de schema no boot
├── validate.ts                 # Validador standalone (script)
├── seed.ts                     # Seed do catálogo
├── seed-startup.ts             # Garante catálogo no boot
├── vite.ts                     # Dev: setup Vite middleware
├── static.ts                   # Prod: serve dist/public
├── config/
│   └── env.ts                  # Validação de env vars com Zod
├── services/
│   ├── ai/                     # Abstração de providers (Gemini, OpenAI)
│   ├── annotation/             # Renderer SVG da planta anotada
│   ├── audit/                  # auditAiCall, aiAuditor, aiEvents
│   ├── calculation/            # Fusão multivista, cálculo de quantitativos
│   ├── cv-service/             # Cliente HTTP do micro-serviço Python
│   ├── extraction/             # 11 etapas geométricas (inventário, cotas, topologia, ...)
│   ├── export/                 # PDF, Excel, JSON
│   ├── gemini/                 # planAnalyzer.ts (LLM principal)
│   ├── ifc/                    # Parser BIM
│   ├── openai/                 # Cliente OpenAI
│   ├── preflight/              # inspector.ts, pdfVectorExtractor.ts
│   ├── pipelineAbort.ts        # Sistema de aborto cooperativo
│   └── takeoff/                # OpenAI Vision Takeoff mode
└── replit_integrations/        # Integração com Replit (auth, image, etc)
```

## 23. `routes.ts` — orquestrador principal

~4400 linhas, organizado por endpoint:

### Endpoints principais (por categoria)

#### Auth
- `POST /api/auth/login` — Passport.authenticate
- `POST /api/auth/logout`
- `GET /api/auth/me`

#### Projects
- `GET /api/projects` — lista do usuário
- `POST /api/projects` — cria
- `GET /api/projects/:id` — detalhes + files + extractedData + budget
- `PUT /api/projects/:id` — update (nome, cliente, tipo, edificação)
- `DELETE /api/projects/:id` — cascata: budgets, extractedData, aiRuns, pipeline_events (fail-safe), projectFiles
- `POST /api/projects/:id/process` — **kickoff do pipeline** (3000 linhas inline)
- `POST /api/projects/:id/abort` — sinaliza aborto cooperativo
- `POST /api/projects/:id/reprocess/:stage` — reprocesso granular (parcial)

#### Files
- `POST /api/projects/:id/upload` — multipart upload
- `GET /api/files/:fileId/content` — serve arquivo
- `DELETE /api/files/:fileId`

#### SSE
- `GET /api/projects/:id/progress` — SSE legado (stepper simples)
- `GET /api/projects/:id/ai-events` — SSE detalhado (timeline)
- `GET /api/projects/:id/pipeline-events` — histórico persistido

#### Annotation (regeneração granular)
- `POST /api/projects/:id/annotated-image` — re-renderiza plantas anotadas
- `POST /api/projects/:id/annotated-image-consolidated` — versão consolidada multi-pavimento

#### Quantitativos editor
- `PATCH /api/projects/:id/walls/:wallId` — edita wall após processamento
- `POST /api/projects/:id/recalculate` — recalcula budget

#### Hints humanos
- `GET /api/projects/:id/side-hints` — marcadores humanos exterior/interior
- `POST /api/projects/:id/side-hints`

#### Catalog / pricing
- `GET /api/products`
- `POST /api/products` (admin)
- `GET /api/pricing-profiles`
- `POST /api/pricing-profiles`

#### Export
- `GET /api/projects/:id/export/excel`
- `GET /api/projects/:id/export/pdf`
- `GET /api/projects/:id/export/json`

#### Admin / diagnostics
- `GET /api/diagnostics/gemini` — testa chave Gemini
- `GET /api/diagnostics/cv-service` — testa cv-service

## 24. Storage abstrato

`server/storage.ts` define `IStorage` com métodos como:

```typescript
interface IStorage {
  // users
  getUserByUsername(username: string): Promise<User | null>;
  createUser(data: InsertUser): Promise<User>;

  // projects
  getProjects(userId?: number): Promise<Project[]>;
  getProject(id: number): Promise<Project | null>;
  createProject(data: InsertProject): Promise<Project>;
  updateProject(id: number, data: Partial<InsertProject>): Promise<Project>;
  updateProjectStatus(id: number, status: string): Promise<void>;
  deleteProject(id: number): Promise<void>;

  // files
  getProjectFiles(projectId: number): Promise<ProjectFile[]>;
  addProjectFile(data: InsertProjectFile): Promise<ProjectFile>;
  deleteProjectFile(id: number): Promise<void>;

  // extracted_data
  addExtractedData(data: InsertExtractedData): Promise<ExtractedData>;
  addExtractedDataBatch(items: InsertExtractedData[]): Promise<void>;
  getExtractedData(projectId: number): Promise<ExtractedData[]>;
  clearExtractedData(projectId: number): Promise<void>;

  // budget
  createBudget(data: InsertBudget): Promise<Budget>;
  getBudget(projectId: number): Promise<Budget | null>;
  deleteBudget(projectId: number): Promise<void>;

  // pipeline_events (novo, PR2)
  createPipelineEvent(event: InsertPipelineEvent): Promise<PipelineEvent>;
  getPipelineEvents(projectId: number): Promise<PipelineEvent[]>;
  deletePipelineEvents(projectId: number): Promise<void>;

  // ... muitos outros
}
```

A implementação default usa Drizzle. Testes podem usar mock.

## 25. SSE / Event Bus (canais)

### 25.1 `/api/projects/:id/progress` (legado)

Stream JSON simples:
```
event: progress
data: { "step": 0.5, "label": "Pre-flight", "status": "running", "detail": "..." }
```

`sendProgress(projectId, step, label, status, detail)` é função global em `routes.ts` que escreve no `Set<Response>` dos clients conectados.

### 25.2 `/api/projects/:id/ai-events` (atual)

Stream tipado por discriminação:
```
event: started
data: { "kind": "ai_call", "callId": "abc", "promptVersion": "extractGeometry", "model": "gemini-2.5-flash", ... }

event: completed
data: { "kind": "ai_call", "callId": "abc", "durationMs": 142000, "usage": { ... }, "costUsd": 0.07 }

event: started
data: { "kind": "stage", "stage": "3", "label": "Geometria", ... }
```

Emissores em `server/services/audit/aiEvents.ts`:
- `emitStarted/Completed/Failed` para ai_call
- `emitStage`
- `emitPdfSplit`
- `emitImageRender`
- `emitCvSubstep`
- `emitAuditFinding`

Cada emissor:
1. Faz `broadcast` para clients SSE conectados.
2. Chama `eventPersister` (hook injetado por `storage.ts`) que persiste em `pipeline_events` (alguns kinds filtrados — pdf_split e cv_substep ficam só em memória).

### 25.3 Heartbeat

Ambos canais emitem `: ping {timestamp}` a cada 15 segundos para evitar timeout de proxies (Replit, nginx, etc).

### 25.4 Cleanup automático

Quando uma response SSE é fechada (cliente desconectou), o `addAiEventClient` retorna uma função de remoção que limpa o Set.

## 26. Auth & sessões

- `server/auth.ts` configura Passport com strategy `passport-local`.
- Senhas são hashed com `bcryptjs` (cost 10).
- Sessões em PostgreSQL via `connect-pg-simple`:
  - Tabela `user_sessions` (criada por `connect-pg-simple` automaticamente).
  - TTL configurável.
  - Cookie `httpOnly`, `secure` em produção, `sameSite="lax"`.
- `ensureDefaultUser()` cria admin padrão se não existir (com `DEFAULT_ADMIN_PASSWORD` env).
- Middleware `requireAuth` protege endpoints sensíveis.

## 27. Bootstrap automático

`server/bootstrap-schema.ts` roda no boot do servidor (chamado em `index.ts` antes de `registerRoutes`):

```typescript
export async function bootstrapSchema(): Promise<void> {
  const statements = [
    {
      name: "pipeline_events table",
      sql: `
        CREATE TABLE IF NOT EXISTS pipeline_events (
          id SERIAL PRIMARY KEY,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          kind VARCHAR(30) NOT NULL,
          ...
        )
      `,
    },
    {
      name: "pipeline_events project_id index",
      sql: `CREATE INDEX IF NOT EXISTS pipeline_events_project_idx ON pipeline_events(project_id)`,
    },
  ];
  for (const stmt of statements) {
    try {
      await pool.query(stmt.sql);
      console.log(`[BOOTSTRAP] OK: ${stmt.name}`);
    } catch (err) {
      console.warn(`[BOOTSTRAP] Falha em "${stmt.name}": ${err.message}`);
    }
  }
}
```

**Regras** (documentadas no arquivo):
- Nunca usa `DROP`, `ALTER ... DROP`, `TRUNCATE`.
- Nunca toca em tabelas que já existem.
- Cada bloco é idempotente.
- Falhas individuais não quebram o boot — só logam.

Quando o `drizzle-kit push` finalmente for rodado e o schema convergir, esse arquivo vira no-op.

## 28. Sistema de aborto

`server/services/pipelineAbort.ts`:

```typescript
const abortedProjects = new Set<number>();

export class PipelineAbortedError extends Error {
  constructor(projectId: number) {
    super(`Pipeline do projeto ${projectId} foi abortado pelo usuario`);
  }
}

export function requestAbort(projectId: number): void {
  abortedProjects.add(projectId);
}

export function clearAbort(projectId: number): void {
  abortedProjects.delete(projectId);
}

export function throwIfAborted(projectId: number): void {
  if (abortedProjects.has(projectId)) {
    throw new PipelineAbortedError(projectId);
  }
}
```

Checkpoints chamados em `routes.ts` antes das etapas 1.5, 3.4, 3.5, 3.7, 4.55. Chamadas LLM em vôo continuam — aborto é "responsivo o suficiente" sem complexidade de AbortController em N requests.

# PARTE VI — INTEGRAÇÕES DE IA

## 29. Gemini (provider primário)

### 29.1 Modelos usados

| Modelo | Quando | Custo (USD / 1M tokens) |
|---|---|---|
| `gemini-2.5-pro` | Etapas críticas (1, 1.5, 3.5, 3.6, 3.7, 4.6, 8) | Input: 1.25 / Output: 5.00 / Thinking: 5.00 |
| `gemini-2.5-flash` | Etapa 3 (extração geométrica) — alta carga, latência crítica | Input: 0.075 / Output: 0.30 / Thinking: 3.50 |
| `gemini-2.5-flash-lite` | Verificações leves | Input: 0.075 / Output: 0.30 |

### 29.2 Cliente

`server/services/gemini/client.ts`:
- Wraps `@google/genai` SDK.
- Roteamento por chave (sistema vs usuário): se `AI_INTEGRATIONS_GEMINI_API_KEY` está set, usa essa. Senão, lê de `Settings` do usuário.
- `withRetry()` com p-retry: 3 tentativas, backoff exponencial 2s → 8s.
- `recordJsonParseRetry()` tracking para métricas.

### 29.3 Prompts

Estão espalhados em vários arquivos:
- `planAnalyzer.ts`: prompts gigantes para classify, extractGeometry, describeProject.
- `projectCharacterization.ts`: prompt focado para caracterização.
- `wallInventory.ts`: prompt curto para listar segmentos.
- `cotaReader.ts`: prompt focado para cotas.
- `envelopeExtractor.ts`: prompt focado para envelope.
- `topology.ts`: indireto (recebe envelope, faz determinístico).

Padrão geral:
1. Cabeçalho com persona ("Você é um engenheiro orcamentista experiente...").
2. Definições explícitas (o que é externa, interna, muro).
3. Hints da caracterização (Etapa 1.5).
4. Few-shot examples (por tipo de edificação).
5. Output esperado em JSON com schema explícito.
6. "Responda com `<RACIOCINIO>...</RACIOCINIO>` e depois APENAS o JSON".

### 29.4 Pricing tracking

`server/services/audit/aiEvents.ts:PRICING` tem tabela completa de modelos. Cada `ai_call.completed` emite `costUsd` calculado:

```typescript
const pricing = PRICING[model];
const costUsd = (
  (usage.input ?? 0) * pricing.input +
  (usage.output ?? 0) * pricing.output +
  (usage.thinking ?? 0) * (pricing.thinking ?? pricing.output)
) / 1_000_000;
```

UI mostra custo total acumulado em tempo real.

## 30. OpenAI (provider opcional)

### 30.1 Modos suportados

3 modos de extração configurável por projeto (UI: Settings ou DraftWorkspace):

1. **gemini-only** (default): só Gemini, padrão.
2. **openai-only**: OpenAI gpt-4o para classify + extraction.
3. **openai-vision-takeoff**: usa serviço dedicado de takeoff via Vision API.

### 30.2 Modelos OpenAI suportados

| Modelo | Custo (USD / 1M) |
|---|---|
| gpt-4o | Input: 2.50 / Output: 10.00 |
| gpt-4o-mini | Input: 0.15 / Output: 0.60 |
| gpt-4.1 | Input: 2.00 / Output: 8.00 |
| gpt-4.1-mini | Input: 0.40 / Output: 1.60 |
| gpt-4.1-nano | Input: 0.10 / Output: 0.40 |

### 30.3 Vision Takeoff

`server/services/takeoff/AiTakeoffService.ts` usa OpenAI Vision com structured outputs (JSON Schema) para extração geométrica especializada. Resultados podem ser melhores em alguns tipos de planta.

## 31. CV Service (Python FastAPI)

### 31.1 Status

**Default: offline**. Em produção, raramente está rodando porque exige um processo Python separado. Sistema degrada com:

```
[CV] cv-service offline (...) — pipeline em modo Gemini-only
```

### 31.2 Como subir

Em `cv-service/`:
```bash
python -m venv .venv
source .venv/bin/activate  # ou .\.venv\Scripts\Activate.ps1 no Windows
pip install -r requirements.txt
cp .env.example .env  # edita pra colocar GEMINI_API_KEY
uvicorn app.main:app --host 0.0.0.0 --port 8100
```

Documentado em `cv-service/DEPLOY.md` com 3 caminhos:
- **Caminho A**: Docker local (recomendado para dev).
- **Caminho B**: Repl Python separado.
- **Caminho C**: VPS/Render/Fly.

### 31.3 Endpoints

- `GET /health` — status simples.
- `POST /extraction/full_extraction` — síncrono, retorna JSON.
- `POST /extraction/full_extraction/stream` — SSE com sub-eventos.

### 31.4 Como o server chama

`server/services/cv-service/client.ts`:
- Faz health check antes de cada uso.
- Streaming via `fetch + getReader + TextDecoder` (Node 22 nativo).
- Callback `onSubstep` para emitir `cv_substep` events.
- Timeout: 90s (era 180s, baixado pra prevenir long stalls).
- Fallback automático para `/full_extraction` síncrono se stream retorna 404.

## 32. Reconciliação CV ↔ LLM (Etapa 4.65)

Quando ambos rodaram (cv-service online + Etapa 3 Gemini concluída), `cvReconciliation.ts`:
1. Compara walls do LLM vs walls do CV por proximidade + comprimento.
2. Para cada par:
   - **Match**: `audit_note { code: "CV_MATCH", severity: "info", reason: "walls coincidem" }`.
   - **Disagree**: `audit_note { code: "CV_DISAGREE", severity: "warning", reason: "..." }`.
3. **Não modifica** walls — preserva LLM como source of truth na Fusão. CV serve como segunda opinião.

Resultado: badge "✓ CV" ou "⚠ CV divergente" no Inspector de cada parede.

## 33. Cache, retry, rate limit

### 33.1 Cache

- **Split cache** (`splitPdfPages`): cache em memória de páginas já fatiadas. Limpo por `clearSplitCache()` no início de cada `/process`.
- **TanStack Query** no client: cache automático de queries (`["/api/projects", id]`).
- **Sem cache de chamadas LLM** — cada projeto faz suas chamadas. Possível melhoria futura (memoização por hash da imagem).

### 33.2 Retry

`withRetry()` em `server/services/gemini/client.ts`:
```typescript
return pRetry(fn, {
  retries: 3,
  minTimeout: 2000,
  factor: 2,
  maxTimeout: 30000,
  onFailedAttempt: (err) => {
    console.warn(`[RETRY] tentativa ${err.attemptNumber} falhou: ${err.message}`);
  },
});
```

Aplicado em todas as chamadas LLM. Erros não-retryable (401, 403) interrompem na primeira tentativa.

### 33.3 Rate limit

`pLimit(N)` usado em alguns paralelismos:
- Etapa 3 (`extractGeometryParallel`) com concorrência 2.
- Split de PDFs concorrente.

Sem rate limiting global. Em ambientes com alta carga, considerar `express-rate-limit` no `/process` para evitar overload.

## 34. Tabela completa de preços (PRICING)

Em `server/services/audit/aiEvents.ts`:

```typescript
const PRICING: Record<string, ModelPricing> = {
  // Gemini 2.5
  "gemini-2.5-pro":        { input: 1.25, output: 5.00, thinking: 5.00 },
  "gemini-2.5-flash":      { input: 0.075, output: 0.30, thinking: 3.50 },
  "gemini-2.5-flash-lite": { input: 0.075, output: 0.30 },
  // Gemini 2.0 (legado)
  "gemini-2.0-flash":      { input: 0.10, output: 0.40 },
  "gemini-2.0-flash-exp":  { input: 0.10, output: 0.40 },
  // OpenAI gpt-4o family
  "gpt-4o":                { input: 2.50, output: 10.00 },
  "gpt-4o-mini":           { input: 0.15, output: 0.60 },
  "gpt-4.1":               { input: 2.00, output: 8.00 },
  "gpt-4.1-mini":          { input: 0.40, output: 1.60 },
  "gpt-4.1-nano":          { input: 0.10, output: 0.40 },
};
```

Quando o modelo retorna não está nessa tabela, `costUsd` vira `undefined` e UI mostra "—".

---

# PARTE VII — MODELO DE DADOS

## 35. Tabelas e relações

Schema em `shared/schema.ts`. PostgreSQL via Drizzle.

### 35.1 Lista de tabelas

| Tabela | Função | Tamanho típico |
|---|---|---|
| `users` | Usuários do sistema | dezenas |
| `pricing_profiles` | Perfis de preço (região/cliente) | unidades |
| `profile_prices` | Preços por SKU em cada perfil | centenas |
| `products` | Catálogo de SKUs Lightwall | ~22 (estável) |
| `projects` | Projetos criados | centenas/milhares |
| `project_files` | Arquivos enviados (PDFs, imagens, IFC) | 1-5 por projeto |
| `extracted_data` | **Log do pipeline**: cada etapa salva aqui | 20-30 por projeto |
| `budgets` | Orçamento final calculado | 1 por projeto |
| `ai_runs` | Trace de cada chamada IA (tokens, custo, duração) | 10-20 por projeto |
| `pipeline_events` | Eventos persistidos do SSE | 50-200 por projeto |
| `wall_feedback` | Feedback humano em paredes (correção/marcar não-parede) | poucos |
| `floor_side_hints` | Marcadores humanos exterior/interior na planta | poucos |

### 35.2 Diagrama ER (simplificado)

```
┌──────────┐         ┌──────────┐
│  users   │◄────────┤ projects │
└──────────┘         └────┬─────┘
                          │
        ┌─────────────────┼────────────────┐
        ▼                 ▼                ▼
  ┌────────────┐  ┌─────────────┐  ┌──────────┐
  │ extracted_ │  │ project_    │  │ budgets  │
  │   data     │  │   files     │  └──────────┘
  └────────────┘  └─────────────┘
        │
        ▼
  ┌────────────┐
  │ ai_runs    │
  └────────────┘

  ┌──────────────────┐
  │ pricing_profiles │◄────┬─ users (pricing_profile_id)
  └────────┬─────────┘     │
           │
           ▼
  ┌──────────────────┐
  │ profile_prices   │──── (referência ao SKU)
  └──────────────────┘
                          ┌──────────┐
                          │ products │ (independente, referenciado por SKU)
                          └──────────┘
```

### 35.3 Campos críticos por tabela

#### `projects`
| Campo | Tipo | Função |
|---|---|---|
| `id` | serial PK | ID interno |
| `name` | varchar(255) | Nome do projeto |
| `clientName`, `clientEmail` | varchar | Cliente |
| `status` | varchar(50) | `draft / processing / completed / error` |
| `projectType` | varchar(20) | `teste / real` |
| `buildingType` | varchar(30) | residencial / comercial / etc |
| `fileFingerprint` | varchar(128) | Hash dos arquivos (detecta duplicatas) |
| `realCost, realAreaExt, realAreaInt, ...` | decimal | Para calibração (entrada manual) |
| `discountPanelPct, freightCost, biomassCost` | decimal | Ajustes do orçamento |
| `pricingProfileId` | FK | Perfil aplicado |

#### `extracted_data`
| Campo | Tipo | Função |
|---|---|---|
| `id` | serial PK | |
| `projectId` | FK | |
| `fileId` | FK (nullable) | Quando é per-arquivo |
| `elementType` | varchar(50) | Identificador da etapa/elemento (ex: `etapa1_classificacoes`, `etapa1_5_characterization`, `etapa3_annotated_plan`, `etapa4_fusao`, `parede`, `laje`, `parede_tabela`, `cv_extraction`, `audit_notes`, `envelopes`, `building_type_detection`) |
| `data` | jsonb | Payload da etapa (estrutura varia) |
| `hasAssumption` | int | 0 ou 1 — se tem suposições/fallbacks |

**É o "log" do pipeline.** Cada etapa salva 1+ records aqui. Reabrir um projeto = ler `extracted_data` e re-hidratar a UI.

#### `pipeline_events`
| Campo | Tipo | Função |
|---|---|---|
| `id` | serial PK | |
| `projectId` | FK CASCADE | |
| `kind` | varchar(30) | `ai_call / stage / image_render / audit_finding / ...` |
| `stage` | varchar(20) | Stage relacionado (opcional) |
| `phase` | varchar(20) | `started / completed / failed` |
| `payload` | jsonb | Estrutura completa do evento |
| `createdAt` | timestamp | |

Usado para hidratar timeline ao reabrir projetos.

#### `budgets`
| Campo | Tipo | Função |
|---|---|---|
| `id` | serial PK | |
| `projectId` | FK | |
| `totalCost` | decimal | R$ total |
| `totalArea` | decimal | m² total |
| `data` | jsonb | Estrutura completa (pavimentos, categorias, consolidado, inconsistências) |
| `projectDescription` | text | Markdown gerado pela Etapa 8 |

## 36. `extracted_data` — o "log" do pipeline

A escolha de uma tabela genérica (`elementType + data jsonb`) ao invés de N tabelas específicas (`walls`, `slabs`, `corners`, etc) foi deliberada:

**Vantagens**:
- Adicionar nova etapa = só novo `elementType`, sem migração.
- JSONB permite evolução de schema interno sem ALTER TABLE.
- Queries por elementType são rápidas com índice.

**Desvantagens**:
- Sem validação de schema no DB (validação fica no Drizzle/Zod do app).
- Joins entre walls de pavimentos diferentes exigem JSONB operators.

Lista típica de `elementType`s em um projeto completo:

| elementType | Etapa que gera | Conteúdo |
|---|---|---|
| `etapa1_classificacoes` | 1 | Array de classifications por arquivo |
| `etapa1_5_characterization` | 1.5 | Caracterização JSON |
| `parede` | 3 | Cada wall individual (várias rows) |
| `laje` | 3 | Cada slab individual |
| `canto` | 3 | Cantos |
| `parede_tabela`, `esquadria_tabela` | 1 | Items de tabelas extraídas |
| `cv_extraction` | 3.4 | Resultado do CV service |
| `envelopes` | 3.7 | Polígonos do envelope |
| `etapa3_annotated_plan` | 7.5 | Plantas anotadas + wallSegments + annotationErrors |
| `etapa4_fusao` | 4 | Fusão final (walls/slabs/corners + scope) |
| `audit_notes` | 4.9 + 4.65 | Notas de auditoria |
| `etapa5_calculo` | 5 | Cálculo de quantitativos |
| `etapa7_validacao` | 7 | Inconsistências |
| `building_type_detection` | (auto) | Detecção de buildingType |

## 37. Schema do `budgets.data`

```typescript
{
  // Por pavimento
  pavimentos: [
    {
      nivel: "Terreo",
      paredes_externas: {
        quantidade_paineis: 42,
        comprimento_total_m: 35.5,
        area_liquida_m2: 89.2,
        custo_total: 24530.00,
        measurement_source_dominant: "dimension_text",
        needs_review_count: 2,
      },
      paredes_internas: { ... },
      muros: { ... },
      laje_piso: {
        quantidade_paineis: 50,
        area_m2: 113.5,
        is_radier: true,
        custo_total: 13750.00,
      },
      laje_coberta: { ... },
    },
    // ... mais pavimentos
  ],
  // Consolidado (soma de pavimentos)
  consolidado: {
    paredes_externas_paineis: ...,
    total_area_m2: ...,
    total_paineis: ...,
    preco_m2: ...,
  },
  // Inconsistências detectadas (Etapa 7)
  inconsistencias: [
    { severity: "critical" | "warning" | "info", code: "...", message: "..." },
  ],
  // Alertas adicionais
  alertas: [],
}
```

# PARTE VIII — DEVOPS & OPERAÇÃO

## 38. Variáveis de ambiente

`server/config/env.ts` define o schema Zod:

| Var | Obrigatória? | Default | Função |
|---|---|---|---|
| `NODE_ENV` | não | `development` | development / production / test |
| `PORT` | não | `5000` | Porta do servidor |
| `DATABASE_URL` | **SIM** | — | PostgreSQL connection string |
| `SESSION_SECRET` | **SIM** | — | Chave de sessão (mínimo 16 chars) |
| `DEFAULT_ADMIN_PASSWORD` | não | — | Senha do admin auto-criado |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | não | — | Chave Gemini (senão usuário configura via UI) |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | não | — | URL custom (proxy) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | não | — | Chave OpenAI |
| `AI_INTEGRATIONS_OPENAI_MODEL` | não | — | Modelo OpenAI (default: `gpt-4o`) |
| `CV_SERVICE_URL` | não | — | URL do cv-service (auto-fallback Gemini-only se ausente) |

**Comportamento**: `loadEnv()` valida no boot. Falha = log estruturado + `process.exit(1)`. Falha rápida, antes de subir o servidor.

## 39. Deploy

### 39.1 Replit (atual)

- Hospedagem principal hoje.
- DB: Neon Postgres (Replit oferece nativo).
- Cron/restart manuais via Replit UI.
- Env vars via Replit Secrets.

### 39.2 Docker (DEPLOY.md)

`DEPLOY.md` documenta 3 caminhos:
- **Caminho A**: Docker Compose local com 3 serviços (app + postgres + cv-service).
- **Caminho B**: Replit (paralelo Repl do cv-service).
- **Caminho C**: VPS / Render / Fly com `Dockerfile` separado.

### 39.3 Build de produção

```bash
npm run build       # tsc + vite build + esbuild server
# Gera dist/index.cjs (server) + dist/public/ (client)

npm start           # NODE_ENV=production node dist/index.cjs
```

Bundle do server: ~1.7 MB (CJS).
Bundle do client: ~710 KB minified, ~207 KB gzipped.

## 40. Database

### 40.1 Neon (Replit)

Default. Postgres serverless. Connection pooling automático.
Connection string em `DATABASE_URL`.

### 40.2 Local

```bash
docker run -d --name lw-pg -e POSTGRES_PASSWORD=lw -p 5432:5432 postgres:16
```

Connection: `postgresql://postgres:lw@localhost:5432/postgres`.

### 40.3 Migrations

Drizzle Kit gerencia migrações:
```bash
npm run db:push       # aplica schema direto (drizzle-kit push)
npm run db:generate   # gera arquivo SQL de migração
npm run db:studio     # UI do Drizzle Studio
```

**Cuidado**: `db:push` pode pedir DROP de tabelas que estão no DB mas não no schema (ex: `user_sessions` legado). Por isso o `bootstrap-schema.ts` existe — para casos onde queremos só adicionar (não migrar tudo).

## 41. Logs

Estrutura padrão:
```
[ETAPA X] mensagem
[INVENTARIO] Match: 21/24 paredes
[FUSAO] CORRECAO (residencial): Todas as 24 paredes sao externas
[VALIDATOR] paredes: 22→22 (-0)
[PERSIST] createBudget OK
```

Cada serviço tem seu prefixo. Logs vão para stdout. Replit Console agrega.

Logs estruturados (JSON) não estão implementados. Possível upgrade futuro.

# PARTE IX — QUALIDADE, SEGURANÇA E RISCOS

## 42. Bugs conhecidos

### 42.1 Etapa 2.5 — Vetor Nativo descarta paredes

**Sintoma**: log `"63850 segmentos, escala: cotas dispersas (cluster=21/409), fallback 1:50 ... escala não confiável, paredes descartadas"`.

**Causa**: Heurística conservadora. Em PDFs com muitas dimensões pequenas (detalhes técnicos), cluster fica em <40% das cotas, então usa fallback `1:50` hardcoded e descarta paredes vetoriais.

**Impact**: Perde "bônus" da extração vetorial. Etapa 3 Gemini ainda cobre.

**Mitigação**: relaxar para `cluster ≥ 5 cotas com tolerância ±10% E ≥10% do total`. Risco: falsos positivos.

### 42.2 Etapa 3.5 — Match de endpoints limitado

**Sintoma**: `"1 de 25 paredes ganharam endpoints"` em alguns projetos.

**Causa**: Match estrito por IoU/distância falha quando bbox da Etapa 3 está deslocado. Quando pavimento é genérico ("Outro"), agora tem fallback cross-pavimento que melhora.

**Mitigação**: melhorias incrementais nos thresholds. Subir cv-service ajuda muito (endpoints precisos via OpenCV).

### 42.3 CV Service offline

**Sintoma**: `"cv-service offline — pipeline em modo Gemini-only"` em quase todos os deploys.

**Causa**: cv-service é Python e não é deployado por default.

**Mitigação**: documentado em `DEPLOY.md`. Subir em Repl separado ou Docker é 1h de trabalho. Ganho de qualidade estimado: 15-20% em topologia.

## 43. Dívida técnica

### 43.1 ProjectMenu obsoleto

`client/src/components/project/ProjectMenu.tsx` ainda existe mas não é referenciado. Substituído por `ProjectSidebar`. Pode ser deletado em cleanup futuro.

### 43.2 InspectorPanel duplicando sidebar

`WorkspaceLayout` (em status `completed`) ainda tem `InspectorPanel` interno mostrando paredes/lajes. A `ProjectSidebar` planeja absorver essa info na seção "Inspeção". Hoje há **duplicação visual** quando o usuário está em completed.

### 43.3 SSE /progress legado

Dois canais SSE (`/progress` + `/ai-events`) podem ser consolidados em um. `/progress` deve sumir em uma refatoração futura.

### 43.4 `routes.ts` gigante

~4400 linhas em um arquivo. O pipeline (~3000 linhas) podia ser extraído para `server/services/pipeline.ts` para melhor testabilidade.

### 43.5 Sem testes automatizados

Não há test suite. Validação é manual via projetos reais. **Risco significativo**: refatoração tem alta chance de regressão.

## 44. Limitações conhecidas

| Limitação | Detalhe |
|---|---|
| Escala fallback `1:50` | PDFs sem cotas confiáveis usam escala presumida |
| Pavimento "Outro" antes da normalização | Etapa 1 antiga podia retornar "Outro"; agora `normalizePavimento()` lida |
| Sem multi-tenant real | Todos os usuários veem todos os projetos (filter por user no `getProjects` é frouxo) |
| Sem rate limit em `/process` | Múltiplos requests do mesmo usuário podem sobrecarregar |
| CV-service exige restart manual em mudanças | Sem health-check + auto-restart |
| Fingerprint de duplicatas só por hash dos arquivos | PDFs idênticos com nomes diferentes não são detectados |

## 45. Pontos críticos

### 45.1 Qualidade da extração
- **Etapa 3 (Gemini)** é responsável por 80% da qualidade. Prompt é robusto mas Gemini ainda pode confundir vista 3D com planta baixa, contar mobiliário como parede, etc.
- **Etapa 3.5 (Inventário)** define endpoints precisos. Match imperfeito = visualização menos precisa.
- **Etapa 3.7 (Topologia)** é determinística e robusta — desde que o envelope esteja correto.

### 45.2 Performance
- **Etapa 3 (Geometria)**: 120-180s. Gargalo absoluto.
- Possíveis melhorias:
  - Cache de resultado por hash de imagem.
  - Streaming dos resultados (Gemini tem streaming, ainda não usado).
  - Provider mais rápido (gpt-4o-mini é 3x mais rápido).

### 45.3 Custo
- ~US$ 0,25/projeto típico. Suportável para SaaS B2B.
- Gemini é 5x mais barato que OpenAI para mesma qualidade aqui.
- Caracterização (Etapa 1.5) sobe custo em 8% mas melhora qualidade Etapa 3 significativamente.

## 46. Segurança

### 46.1 Auth
- Passport local com bcryptjs. Senhas hashed.
- Sessões em PostgreSQL via `connect-pg-simple`. Cookies httpOnly + secure em prod.
- Sem 2FA. Sem OAuth.

### 46.2 Secrets
- Env vars validadas no boot. Logs não expõem.
- Chaves IA podem vir de env (sistema) ou Settings do usuário.

### 46.3 XSS
- React por default escapa output. Markdown da descrição IA é renderizado como texto (não HTML), seguro.

### 46.4 SQL Injection
- Drizzle ORM usa prepared statements. Imune por design.

### 46.5 CSRF
- Sessões com `sameSite="lax"`. Sem CSRF tokens explícitos. Risco baixo (mutations exigem auth + JSON body, não form).

### 46.6 Rate Limiting
- **Ausente**. Recomendado adicionar `express-rate-limit` em `/process`, `/upload`, `/login`.

### 46.7 Multipart upload
- Multer com limite de tamanho. Filtro de extensões válidas.
- Arquivos salvos em disco com nome aleatório.
- Sem antivirus scan.

### 46.8 SSE
- Heartbeat 15s.
- Sem auth check no GET /ai-events (acesso por projectId — se conhece o ID, pode escutar). Considerar verificação de propriedade.

# PARTE X — ROADMAP E RECOMENDAÇÕES

## 47. Curto prazo (sprints 1-2)

### 47.1 Subir CV Service em produção (alta prioridade)
- 1h de setup (Caminho B em DEPLOY.md — Repl Python separado).
- Ganho: 15-20% em qualidade da topologia (envelope, classificação ext/int/muro).
- Sem custo IA adicional.

### 47.2 Remover ProjectMenu.tsx
- Arquivo morto. Limpar imports.
- Cleanup pequeno mas higiênico.

### 47.3 Integrar Inspector na ProjectSidebar
- Mover paredes/lajes/auditoria do `WorkspaceLayout` para a seção "Inspeção" da sidebar.
- Workspace fica só com a planta (~100% da largura).
- Sidebar fica como navegador completo.

### 47.4 Otimizar Etapa 3 (Gemini)
- Testar `gemini-2.5-flash-lite` para verificação per-floor (vs `flash` atual).
- Streaming response (reduz tempo percebido).
- Possível redução de 30% na latência.

### 47.5 Rate limiting em `/process` e `/login`
- `express-rate-limit`: 5 requests/minuto por IP em `/process`, 10/min em `/login`.

## 48. Médio prazo (1-3 meses)

### 48.1 Cache de extrações
- Hash da imagem → resultado memoizado.
- Mesma planta processada de novo = retorno instantâneo.
- Economiza ~70% dos custos em casos de reprocessamento.

### 48.2 Multi-tenant real
- Adicionar `userId` em queries de projetos.
- Roles: admin (vê tudo), user (vê próprios).
- Isolamento de pricing profiles por user/cliente.

### 48.3 Fine-tuning training data
- Calibração já tem entrada para projetos reais (`realCost`, `realArea*`).
- Construir dataset de pares (planta, orçamento real) para validar e fine-tunar prompts.

### 48.4 Editor visual de paredes pós-extração
- Hoje há `wallFeedback` (correção/marcar não-parede) mas é primitivo.
- UI completa: drag endpoints, alterar classe, mesclar paredes, dividir.
- Resultado recalculado em real-time.

### 48.5 Testes automatizados
- Pelo menos um teste end-to-end que processa um projeto de referência e valida outputs.
- Snapshot testing dos endpoints principais.

## 49. Longo prazo (3+ meses)

### 49.1 Fine-tuning de modelo próprio
- Coletar dataset (~500 plantas + outputs validados).
- Fine-tune Gemini ou um modelo open-source (LLaVA?).
- Reduz custo + aumenta qualidade.

### 49.2 Integração CAD (DWG)
- `web-ifc` já cobre BIM (IFC). DWG ainda não.
- Parser via `dwg-converter` (Node) ou conversão server-side.

### 49.3 Modo "co-piloto"
- LLM analisa o orçamento gerado e sugere otimizações ("essa parede de 17m poderia ser dividida em 2 painéis maiores para reduzir custo").

### 49.4 Mobile responsivo total
- Hoje desktop-first. Sidebar 320px quebra em telas <1024px.
- Refactor pra coluna única em mobile.

### 49.5 Marketplace de SKUs
- Catálogo aberto. Vendedores cadastram seus painéis.
- Lightwall fica como agregador.

## 50. Investimentos recomendados (priorização)

| # | Investimento | Impacto | Esforço | ROI |
|---|---|---|---|---|
| 1 | Subir CV Service | Alta qualidade | 1h | **MUITO ALTO** |
| 2 | Cache de extrações | Baixo custo | 4h | **ALTO** |
| 3 | Streaming Etapa 3 | Melhor UX | 6h | **ALTO** |
| 4 | Multi-tenant + roles | Pré-requisito SaaS | 16h | **ALTO** |
| 5 | Testes E2E | Reduz regressões | 24h | **ALTO** |
| 6 | Editor visual pós-extração | Diferencial UX | 40h | **MÉDIO** |
| 7 | Fine-tuning | Custo + qualidade | 80h+ | **MÉDIO** (long-term) |
| 8 | Integração DWG | Cobertura formato | 24h | **MÉDIO** |
| 9 | Mobile responsivo | Mercado mobile | 16h | **BAIXO** (B2B) |
| 10 | Marketplace | Modelo novo | 200h+ | **EXPLORATÓRIO** |

# PARTE XI — GUIA DE AVALIAÇÃO PRO TIME

## 51. Perguntas por especialidade

### 51.1 Frontend (UX, performance, acessibilidade)

1. A UX adaptativa por status (`draft / processing / completed / error`) faz sentido?
2. A `ProjectSidebar` persistente direita é a melhor solução vs tabs? Há sobrecarga cognitiva?
3. O `ProcessingLiveView` ao vivo é informativo demais? Pouco? Bem balanceado?
4. Bundle de 710 KB (gzip 207 KB) é OK ou precisa code-splitting?
5. Acessibilidade: WCAG 2.1 AA? Navegação por teclado? Screen readers?
6. Mobile experience é importante para o cliente atual?
7. Tooltips do stepper têm informação suficiente? Demais?
8. Footer expansível do orçamento é eficaz vs modal full-screen?

### 51.2 Backend (arquitetura, scaling, error handling)

1. `routes.ts` com 4400 linhas é sustentável? Onde quebrar?
2. Storage abstrato (`IStorage`) é bem utilizado ou maioria das chamadas é direta?
3. SSE dual (legado + atual) cabe consolidar?
4. Graceful degradation (16 etapas soft-fail) está bem implementada?
5. Aborto cooperativo cobre os casos certos? 5 checkpoints é suficiente?
6. Pool de conexões PG está dimensionado para concorrência prevista?
7. Sem testes — qual o risco de refactor?
8. Endpoints estão bem cobertos por validação (Zod)?

### 51.3 IA/ML (prompts, qualidade extração, custo)

1. Os prompts são robustos? Vulnerabilidade a prompt injection?
2. Gemini 2.5 Pro vs Flash: a escolha de modelo por etapa está bem balanceada?
3. Caracterização (Etapa 1.5) como hint para Etapa 3 funciona? Métricas?
4. Reconciliação CV↔LLM (Etapa 4.65) é útil ou só ruído?
5. SelfCheck (Etapa 4.9) cobre os casos importantes? Faltam checks?
6. Custo de US$ 0,25/projeto é sustentável? Onde otimizar?
7. Fine-tuning é viável? Quantos exemplos necessários?
8. Como medir "qualidade da extração" objetivamente?

### 51.4 DevOps (deploy, observabilidade, segurança)

1. Deploy Replit é production-grade? Vai escalar?
2. Bootstrap automático de schema é seguro? Quando migrar para drizzle-kit?
3. Logs estruturados (JSON) vs stdout? Stack de observabilidade ideal?
4. Sem rate limiting em endpoints críticos — risco real?
5. Sem auth check em SSE GET — vulnerabilidade?
6. Sem antivirus em uploads — risco?
7. Sessões em PostgreSQL vs Redis — qual decisão?
8. Health checks completos para todos os componentes (DB, Gemini, CV)?

### 51.5 Produto (casos de uso, métricas, roadmap)

1. Persona principal é o orçamentista — outras personas importantes?
2. Taxa de sucesso 85% é aceitável? Como subir?
3. Latência 3-7 min é aceitável? Onde corta?
4. Modo "Teste" vs "Real" — distinção clara para o usuário?
5. Métricas operacionais sendo coletadas suficientes? Falta algo?
6. Roadmap prioriza certo? CV-service como #1?
7. Casos de uso B2B vs B2C — viável B2C (cliente final faz upload)?
8. Modelo de receita: SaaS, per-projeto, licença on-premise?

### 51.6 Segurança

1. Auth Passport-local é adequado para B2B? 2FA?
2. Multi-tenant ausente — risco de vazamento entre clientes?
3. CSRF: sem tokens, só sameSite. Acceptable?
4. Secrets management: env vars OK ou precisa Vault?
5. Audit log de ações sensíveis (DELETE projeto, alterar perfil de preço)?
6. PII (cliente email, nome) — LGPD compliance?
7. Backup do DB — definido?
8. Disaster recovery plan?

## 52. Checklist por especialidade

(Sugerido para cada especialista do time preencher durante a avaliação)

### Frontend
- [ ] UX faz sentido em cada estado
- [ ] Performance percebida boa (< 100ms interaction)
- [ ] Acessibilidade básica (keyboard, screen reader)
- [ ] Mobile responsivo
- [ ] Estados de erro claros

### Backend
- [ ] Modularização adequada
- [ ] Error handling robusto
- [ ] Pool de conexões dimensionado
- [ ] Sem N+1 queries
- [ ] Validação de input em endpoints

### IA/ML
- [ ] Prompts versionados
- [ ] Custos monitorados
- [ ] Qualidade medida objetivamente
- [ ] Fallbacks para falhas de modelo

### DevOps
- [ ] Logs estruturados
- [ ] Métricas (latência, error rate)
- [ ] Health checks
- [ ] Backup + restore testado
- [ ] CI/CD

### Produto
- [ ] Casos de uso priorizados
- [ ] Métricas de adoção
- [ ] Roadmap alinhado com mercado
- [ ] Modelo de receita validado

## 53. Como reproduzir um cenário típico

### 53.1 Setup local

1. **Pré-requisitos**: Node 22+, PostgreSQL 16, Python 3.11+ (opcional, para cv-service).
2. **Clone e instala**:
   ```bash
   git clone <repo>
   cd Lightwall-Orcamento
   npm install
   ```
3. **DB**:
   ```bash
   docker run -d --name lw-pg -e POSTGRES_PASSWORD=lw -p 5432:5432 postgres:16
   ```
4. **`.env`**:
   ```
   DATABASE_URL=postgresql://postgres:lw@localhost:5432/postgres
   SESSION_SECRET=$(openssl rand -hex 24)
   AI_INTEGRATIONS_GEMINI_API_KEY=<sua-chave>
   ```
5. **Schema**:
   ```bash
   npm run db:push
   ```
6. **Dev server**:
   ```bash
   npm run dev
   ```
   (Em Windows PowerShell: use `cross-env` ou rodar `$env:NODE_ENV='development'; npx tsx server/index.ts`).
7. Acesse `http://localhost:5000`.

### 53.2 Cenário de teste end-to-end

1. Login com admin (criado automaticamente).
2. Dashboard → "Novo Projeto".
3. Preenche nome, cliente, tipo (Teste), edificação (Residencial).
4. Em ProjectDetails (draft):
   - Sobe um PDF de planta residencial (ex: TriAto Mauricia e Vagner).
   - Confirma preview aparece à esquerda.
   - Config: pé-direito 3.0, escopo padrão, painéis automáticos.
   - Clica "Processar Projeto".
5. Status muda para `processing`:
   - Stepper sticky aparece no topo.
   - Etapas avançam: 0.5 → 1 → 1.5 → ... → 8.
   - Imagens anotadas aparecem no grid à medida que são geradas.
   - Sidebar mostra Telemetria atualizando (Tempo, Custo).
6. Status `completed`:
   - Planta com faixas vermelhas/verdes preenchidas.
   - Inspector lista 20-30 paredes.
   - Footer mostra Total R$ XXX.
   - Click "Detalhar" expande categorias.
   - Sidebar: Análise IA com descrição em prosa.
7. Exportar XLSX → abre no Excel com 6 abas (Resumo, Detalhamento, etc).

### 53.3 Cenário de falha

1. Sobe um PDF que não é planta (ex: capa de projeto).
2. Pipeline tenta classificar, mas Gemini retorna `irrelevante`.
3. Etapa 4 (Fusão) falha por dados insuficientes → `status=error`.
4. UI mostra `ErrorState` com mensagem e botão Reprocessar.
5. Logs do servidor mostram causa específica.

## 54. Pontos de extensão

### 54.1 Adicionar nova etapa ao pipeline
1. Definir `elementType` único (ex: `etapa5_5_new_thing`).
2. Adicionar bloco em `routes.ts` entre etapas existentes:
   ```typescript
   throwIfAborted(projectId);
   sendProgress(projectId, 5.5, "Nome", "running", "...");
   const result = await novoServico(...);
   await storage.addExtractedData({ projectId, elementType: "etapa5_5_new_thing", data: result });
   sendProgress(projectId, 5.5, "Nome", "done", "...");
   ```
3. Adicionar entry em `STAGE_CATALOG` no `LiveStepper.tsx`.
4. Adicionar inferStage mapping em `EventTimeline.tsx`.

### 54.2 Adicionar novo provider IA
1. Criar service em `server/services/<provider>/`.
2. Atualizar abstração em `server/services/ai/provider.ts`.
3. Adicionar preços em `server/services/audit/aiEvents.ts:PRICING`.
4. Adicionar opção em `analysisMode` no UI (DraftWorkspace).

### 54.3 Adicionar nova exportação
1. Implementar em `server/services/export/<formato>.ts`.
2. Adicionar endpoint `/api/projects/:id/export/<formato>`.
3. Adicionar botão em `ProjectSidebar` → seção Exportar.

### 54.4 Adicionar novo SKU
1. Direto no DB ou via UI Catalogo (`/catalogo`).
2. Adicionar perfil de preço se aplicável.
3. Atualizar regras em `server/services/calculation/engine.ts` se for categoria nova.

---

# ANEXOS

## Anexo A — Estrutura de pastas detalhada

```
Lightwall-Orcamento/
├── client/                          # Frontend React
│   ├── public/                      # Assets estáticos
│   └── src/
│       ├── pages/                   # 13 páginas
│       ├── components/
│       │   ├── ui/                  # shadcn (50+)
│       │   ├── project/             # ProjectHeader, Sidebar, etc
│       │   ├── processing/          # WorkspaceLayout, PlantaWorkspace
│       │   ├── live-pipeline/       # ProcessingLiveView, LiveStepper
│       │   └── ... (outros)
│       ├── hooks/                   # useSseWithRetry, useToast
│       ├── lib/                     # wallGeometry, queryClient, utils
│       └── App.tsx, main.tsx
├── server/                          # Backend Node + Express
│   ├── index.ts                     # Entry
│   ├── routes.ts                    # 4400 linhas — orquestrador
│   ├── auth.ts, db.ts, storage.ts
│   ├── bootstrap-schema.ts
│   ├── config/env.ts
│   └── services/
│       ├── ai/, annotation/, audit/
│       ├── calculation/, cv-service/
│       ├── extraction/ (11 etapas)
│       ├── export/, gemini/, ifc/
│       ├── openai/, preflight/
│       ├── pipelineAbort.ts
│       └── takeoff/
├── shared/
│   └── schema.ts                    # Drizzle schemas (10 tabelas)
├── cv-service/                      # Python FastAPI
│   ├── app/
│   │   ├── main.py
│   │   └── routers/
│   ├── requirements.txt
│   └── DEPLOY.md
├── docs/
│   ├── PIPELINE.md (650 linhas)
│   ├── PIPELINE.docx, PIPELINE_BPMN.png
│   ├── TECHNICAL.md (243 linhas)
│   ├── SUMMARY.md, USER_GUIDE.md
│   └── LIGHTWALL_ARCHITECTURE.md    # ESTE arquivo
├── script/
│   ├── build.ts                     # esbuild orchestrator
│   ├── md_to_docx.py                # Markdown → DOCX
│   └── bpmn_pipeline.py             # Gerador BPMN
├── drizzle.config.ts
├── package.json
├── README.md, DEPLOY.md, STATUS.md
└── tsconfig.json, vite.config.ts, tailwind.config.ts
```

## Anexo B — Schemas SQL (extrato)

```sql
-- Users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'viewer',
  active INTEGER NOT NULL DEFAULT 1,
  store_name VARCHAR(255),
  pricing_profile_id INTEGER REFERENCES pricing_profiles(id) ON DELETE SET NULL,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Projects
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  client_name VARCHAR(255),
  client_email VARCHAR(255),
  description TEXT,
  status VARCHAR(50) DEFAULT 'draft',
  project_type VARCHAR(20) DEFAULT 'real',
  building_type VARCHAR(30),
  file_fingerprint VARCHAR(128),
  real_cost DECIMAL(15,2),
  real_area_ext DECIMAL(10,2),
  -- ... (mais campos calibracao)
  discount_panel_pct DECIMAL(5,2) DEFAULT 0.00,
  freight_cost DECIMAL(10,2) DEFAULT 0.00,
  biomass_cost DECIMAL(10,2) DEFAULT 0.00,
  pricing_profile_id INTEGER REFERENCES pricing_profiles(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Extracted Data (o "log" do pipeline)
CREATE TABLE extracted_data (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id INTEGER REFERENCES project_files(id) ON DELETE CASCADE,
  element_type VARCHAR(50) NOT NULL,
  data JSONB NOT NULL,
  has_assumption INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Pipeline Events (SSE persistido)
CREATE TABLE pipeline_events (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind VARCHAR(30) NOT NULL,
  stage VARCHAR(20),
  phase VARCHAR(20) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX pipeline_events_project_idx ON pipeline_events(project_id);

-- Budgets
CREATE TABLE budgets (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  total_cost DECIMAL(15,2),
  total_area DECIMAL(10,2),
  data JSONB,
  project_description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Anexo C — Prompts resumidos

### Classify + Tables (Etapa 1) — resumo
```
Você é um arquiteto orçamentista experiente. Analise esta página de projeto e:
1) Classifique o tipo: planta_baixa | corte | fachada | tabela | quadro | detalhe | vista_3d | irrelevante
2) Identifique o pavimento (nome LITERAL: "Terreo", "Superior", "Subsolo", "1 Pavimento", etc; NUNCA use "Outro")
3) Extraia tabelas presentes: paredes_de_tabela, esquadrias_de_tabela, areas_de_tabela

REGRAS DO PAVIMENTO:
- Use o nome LITERAL como aparece no carimbo
- Se houver complemento ("SUBSOLO - AREA GOURMET"), pegue apenas o nível
- Se não houver indicação, use exatamente "Terreo"

Output: <RACIOCINIO>...</RACIOCINIO> { "classificacao": {...}, "tabelas": {...} }
```

### Characterize (Etapa 1.5) — resumo
```
Caracterize este projeto arquitetônico em JSON estruturado:
- typology: casa_terrea | sobrado | edificio | comercial_loja | etc
- pavimentos: ["Terreo", "Superior"]
- programa: [{ambiente, qty}]
- padrao: popular | medio | alto
- estimativas: ranges esperados de paredes, esquadrias, espessura, pé-direito, área
- caracteristicas: temCobertura, temGaragem, etc
- confidence: high | medium | low

Hint do usuário: tipo "[buildingType]"
```

### Extract Geometry (Etapa 3) — resumo (~5000 chars)
```
Você é um engenheiro orcamentista. Analise as plantas baixas do pavimento "[nivel]" e extraia
TODOS os elementos para orçamento de painéis Lightwall.

PRÉ-TRATAMENTO (ignorar): mobília, vegetação, carros, hachuras, textos, cotas de nível.

DEFINIÇÕES:
- MURO: vedação do terreno, fora da casa
- PAREDE EXTERNA: envoltória da edificação, separa interior do exterior
- PAREDE INTERNA: divisória interna, ambas faces internas

REGRA TOPOLÓGICA: nunca interna está fora do polígono externo.

[CARACTERIZAÇÃO PREVIA]
- Tipologia: [typology] | Padrão: [padrao]
- Pavimentos: [pavimentos]
- Paredes esperadas: [paredeCountRange]
- Espessura típica: [espessuraParedeM]
- Pé-direito típico: [peDireitoM]

ETAPAS (siga na ordem):
1) Identificar cômodos
2) Identificar muros
3) Traçar polígono da envoltória (paredes externas)
4) Listar paredes internas
5) Listar lajes
6) Ler cotas

Output: <RACIOCINIO>...</RACIOCINIO> { "walls": [...], "slabs": [...], "corners": [...] }
```

## Anexo D — Scripts úteis

| Script | Função |
|---|---|
| `npm run dev` | Inicia dev server (precisa `cross-env` em Windows) |
| `npm run build` | Build produção |
| `npm start` | Inicia servidor produção |
| `npm run check` | TypeScript type-check |
| `npm run db:push` | Aplica schema no DB |
| `npm run db:studio` | UI do Drizzle Studio |
| `python script/md_to_docx.py docs/X.md docs/X.docx` | Converte MD → DOCX |
| `python script/bpmn_pipeline.py` | Re-gera PIPELINE_BPMN.png |
| `npm run db:seed` | Popula catálogo inicial |
| `npm run validate` | Valida env vars sem subir server |

## Anexo E — Glossário

| Termo | Definição |
|---|---|
| **Caracterização** | JSON estruturado da Etapa 1.5: typology, pavimentos, padrão, ranges esperados |
| **CV Service** | Micro-serviço Python (FastAPI) para extração geométrica determinística via OpenCV |
| **Envelope** | Polígono fechado da edificação coberta (sem muros) |
| **Etapa** | Bloco do pipeline com número (0.5 → 8), com input/output bem definidos |
| **Fingerprint** | Hash dos arquivos do projeto (detecta duplicatas) |
| **Fusão multivista** | Etapa 4: dedup + reclassify + auto-gerar lajes |
| **Graceful degradation** | Padrão: etapas pulam silenciosamente em vez de derrubar pipeline |
| **IFC** | Industry Foundation Classes — formato BIM |
| **Inventário** | Etapa 3.5: lista todos os segmentos de parede com endpoints |
| **Pavimento** | Nível da edificação (Terreo, Superior, Subsolo, Cobertura, Pavimento1, etc) |
| **Pipeline** | As 22 etapas que rodam no `POST /process` |
| **Pre-flight** | Etapa 0.5: inspeção rápida do arquivo |
| **Self-check** | Etapa 4.9: 9 verificações determinísticas sobre o resultado |
| **SKU** | Stock Keeping Unit — código de produto (ex: `LW-2P-090`) |
| **SSE** | Server-Sent Events — streaming HTTP unidirecional do server pro client |
| **Stage** | Sinônimo de "Etapa" em código |
| **Topologia** | Etapa 3.7: classifica paredes (externa/interna/muro) por point-in-polygon |
| **Vetor PDF** | Etapa 2.5: extração direta de paths do PDF (sem IA) |
| **WallSegment** | Estrutura geométrica { p1, p2, thickness_pct } detectada na Etapa 3.5 |

## Anexo F — Commits relevantes recentes

| Commit | Descrição |
|---|---|
| `6839bb1` | feat(ui): ProjectSidebar persistente direita (substitui menu kebab) |
| `7274310` | fix(ui): stepper compacto com wrap — sem barra de rolagem horizontal |
| `76ea39e` | feat(ui+pipeline): stepper sticky com descrições + fixes (tempo negativo, "Etapa ?", pavimento "Outro") |
| `524f5fe` | fix(react): move useProcessingEvents above early returns (error #310) |
| `64b095b` | fix(ui): tempo + custo IA + email cliente sempre visiveis; limpa dead code |
| `782be5a` | feat(ui): redesign total — tela adaptativa por status (sem abas) |
| `48fd41d` | fix(annotation): pinta a planta a partir dos segmentos do wallInventory |
| `a68bc62` | feat(boot): self-heal pipeline_events table on server startup |
| `b7d3a9d` | fix(annotation): rank-match fallback when walls lack bbox + surface 0-rendered as error |
| `a816b9e` | feat(annotation): paint walls as filled strips (deliverable style) |
| `1fbb4f3` | docs: BPMN flowchart of the analysis pipeline (PNG) |

## Anexo G — Links e referências

- **Drizzle ORM**: https://orm.drizzle.team
- **TanStack Query**: https://tanstack.com/query
- **Radix UI**: https://radix-ui.com
- **shadcn/ui**: https://ui.shadcn.com
- **Gemini API**: https://ai.google.dev
- **OpenAI API**: https://platform.openai.com
- **Sharp**: https://sharp.pixelplumbing.com
- **FastAPI**: https://fastapi.tiangolo.com
- **Manual Biomassa Lightwall** — documento interno (referência para regras de quantitativos)

---

**FIM DO DOCUMENTO**

*Versão 1.0 — 30 de maio de 2026*
*Autor: Time Lightwall (com auxílio de Claude Opus 4.7)*
*Fonte: `main` no momento da escrita. Para a verdade absoluta, consulte o código.*
