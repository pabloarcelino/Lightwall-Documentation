# Lightwall Budget System

## Overview
Web app for parametric budgeting of Lightwall concrete panels with AI-powered interpretation of architectural plans (PDF/images). Uses Google Gemini AI (gemini-2.5-pro) with an 8-step pipeline: classify pages, extract tables, extract geometry, multi-view fusion, deterministic calculation, catalog integration, validation, and AI project description. Exports budgets as PDF/Excel/JSON.

Output format matches the real Lightwall commercial proposal format (4 categories: Paredes Externas, Paredes Internas, Laje de Piso, Laje Coberta + Projeto de Paginacao).

## Architecture
- **Frontend**: React 18 + TypeScript, Tailwind CSS + Shadcn UI, TanStack Query, wouter routing, react-dropzone
- **Backend**: Express + TypeScript, Drizzle ORM, PostgreSQL
- **AI**: Google Gemini 2.5 Pro via Replit AI Integrations or user's own API key (`@google/genai` with `GoogleGenAI` class). Optional OpenAI GPT-4o for cross-model verification (Etapa 3.5). Three analysis modes selectable per-project via dropdown: (1) **Gemini-only** — default, runs entire pipeline through Gemini; (2) **OpenAI-only** — runs entire pipeline through OpenAI (default model `gpt-5-mini`, configurable in Settings); (3) **OpenAI Vision Takeoff** — uses OpenAI Responses API with strict JSON Schema (structured outputs via `AiTakeoffService`) per planta_baixa page. All AI runs are audited in the `ai_runs` table.
- **Export**: PDFKit (PDF), ExcelJS (Excel), JSON

## 8-Step Processing Pipeline (with AI enhancements)
1. **ETAPA 1 - Classificacao** (gemini-2.0-flash): Page-by-page classification (PDF split via pdf-lib). Chain-of-thought reasoning. Uses Flash model for speed. Categories: planta_baixa, planta_cobertura, corte, fachada, tabela_quantitativo, quadro_esquadrias, detalhe_construtivo, irrelevante
2. **ETAPA 2 - Extracao de Tabelas** (gemini-2.0-flash): Page-by-page extraction with chain-of-thought + few-shot examples. Uses Flash model for speed. paredes_de_tabela, esquadrias_de_tabela, areas_de_tabela. Includes cm→m conversion examples
3. **ETAPA 3 - Extracao Geometrica** (gemini-2.5-pro): Page-by-page with mandatory 5-step chain-of-thought (read cotas → identify rooms → map walls → find esquadrias → calc slabs/corners). 3 few-shot examples. Fallback to full-doc if page-by-page fails
4. **ETAPA 3.5 - Verificacao IA (Cross-Model)**: Second-pass verification comparing extracted data vs original image. When OpenAI key is configured, uses GPT-4o (supports PDFs natively via file content type). Falls back to Gemini if OpenAI fails. Non-fatal: pipeline continues with unverified data if verification fails. Checks 7 criteria (count, lengths, classification, esquadrias, areas, missing walls, unit conversion). Records verification metrics
5. **ETAPA 4 - Fusao Multivista**: Merge + deduplicate (signature 5cm + page-dominance trigger when >30 paredes/nivel/classe sugerem multi-planta) + table precedence + cross-validation (area correction >15% discrepancy) + auto cm→m conversion (length>50, height>10) + auto-generate missing slabs. Lajes deduplicadas só quando áreas batem dentro de 30% (preserva lajes distintas no mesmo nível/classe).
6. **ETAPA 5 - Calculo Deterministico**: Panel calculation (ALL panels are 2P), per-floor grouping, radier excluded
7. **ETAPA 6 - Catalogo**: Cost calculation in real Lightwall proposal format (R$ 275/m2 for panels + R$ 11/m2 for paginacao)
8. **ETAPA 7 - Validacao**: 3-level inconsistencies (Critica, Media, Baixa)
9. **ETAPA 8 - Descricao do Projeto**: Deep AI analysis of all images generating descriptive technical text

## Lightwall Product Model (from real proposal)
- **Product**: PAINEL DE CONCRETO LEVE 3000X610X90MM 2P
- **Panel area**: 1.83 m2 per unit (3.00m x 0.61m)
- **ALL applications use the same 2P panel**: walls (ext/int) AND slabs (piso/coberta)
- **Price**: R$ 275,00/m2 (uniform for all applications)
- **Projeto de Paginacao**: R$ 11,00/m2 (BIM paging project, separate line item)
- **Output categories**: Paredes Externas, Paredes Internas, Laje de Piso, Laje Coberta
- **Materials/labor**: Tracked as supplementary estimates, NOT part of main proposal cost

## Intermediate Results Storage
All intermediate pipeline results are saved to `extracted_data` table for later consultation:
- `etapa1_classificacoes` - Page classifications
- `etapa2_tabelas` - Extracted table data (walls, esquadrias, areas)
- `etapa3_geometria_bruta` - Raw geometry before fusion (per-file)
- `etapa4_fusao` - Fused/deduplicated geometry
- `etapa5_calculo` - Budget calculation results
- `etapa6_catalogo` - Catalog integration with proposal format (proposta.itens, paginacao, complementar)
- `etapa7_validacao` - Inconsistencies and alerts
- `descricao_projeto` - AI-generated project description text

## Building Type System
- **Types**: residencial, comercial, institucional, industrial, outro
- **Auto-detection**: In Etapa 1, each page votes on building type; majority wins
- **Manual override**: User can change via dropdown in ProjectDetails header bar
- **Specialized prompts**: `server/services/gemini/buildingTypePrompts.ts` contains per-type few-shot context, verification hints, and fusion heuristics
- **Pipeline integration**: buildingType flows through Etapa 3 (geometry extraction), Etapa 3.5 (verification), and Etapa 4 (fusion) for type-aware behavior
- **Fusion heuristics by type**: Industrial allows all-external walls (no forced reclassification), residential forces more internal walls, etc.

## Key Files
- `shared/schema.ts` - Drizzle schema: products, projects (with projectType + realCost + buildingType), project_files, extracted_data, budgets, settings
- `server/routes.ts` - API routes with 8-step pipeline orchestration, SSE progress, delete project
- `server/storage.ts` - Database storage layer using Drizzle
- `server/services/gemini/client.ts` - Gemini AI client (gemini-2.5-pro, supports user key or Replit AI Integrations), API health metrics tracking (with VerificationMetrics), reliability scoring
- `server/services/gemini/planAnalyzer.ts` - ETAPA 1-3 (page-by-page with CoT + few-shot), ETAPA 3.5 (verifyExtraction with cross-model support), ETAPA 8 (describeProject). Uses pdf-lib for page splitting
- `server/services/gemini/buildingTypePrompts.ts` - Building type prompt library (per-type fewShotContext, verificationHints, fusionHeuristics)
- `server/services/ai/provider.ts` - AIProvider interface abstraction, GeminiProvider, OpenAIProvider (GPT-4o), OpenAI key management
- `server/services/calculation/engine.ts` - ETAPA 4 (fusionMultiView), ETAPA 5 (calculateBudget), ETAPA 7 (validation), plus legacy format adapter
- `server/services/calculation/assumptions.ts` - Default assumptions (wall height 3m, door 0.8x2.1m, etc.)
- `server/services/export/exportService.ts` - PDF/Excel/JSON export
- `server/seed.ts` - Product catalog seed (LW-2P-090 at R$275/m2, PROJ-PAG at R$11/m2)
- `client/src/App.tsx` - Frontend routes (Dashboard, NewProject, ProjectDetails, Settings, Metodologia, Catalogo, Calibracao, Usuarios, GuiaExterno)
- `client/src/components/Metodologia.tsx` - Reusable methodology section (process, calculations, assumptions, methods)
- `client/src/pages/MetodologiaPage.tsx` - Standalone methodology page (/metodologia)
- `client/src/pages/Catalogo.tsx` - Product catalog management page (/catalogo) with CRUD
- `client/src/components/QuantitativosEditor.tsx` - Editable quantitative parameters (walls, slabs, corners) with enable/disable toggles and recalculate
- `client/src/pages/ProjectDetails.tsx` - Project details with 7 tabs (Analise IA, Arquivos, Etapas, Quantitativos, Orcamento, Metodologia, Exportar), inline project info editing, product selector for processing
- `client/src/pages/Settings.tsx` - API key configuration for Gemini and OpenAI (with reusable ApiKeyCard component), multi-model info card
- `client/src/pages/Calibracao.tsx` - Calibration details page (/calibracao) with comparative table per test project
- `client/src/pages/Usuarios.tsx` - Admin user management page (/usuarios) with user CRUD, store/origin tracking, role/status toggles
- `client/src/pages/GuiaExterno.tsx` - External usage guide page (/guia) with accordion sections for store staff

## Scope Pre-selection
- **Pre-process scope checkboxes**: Before clicking "Processar Projeto", user can select which categories to include: paredes externas, paredes internas, laje de piso, laje coberta, cantos/conexões
- All categories enabled by default, but can be unchecked before processing
- AI still extracts all data, but unchecked categories are filtered from budget calculation and marked as `enabled: false` in the quantitativos editor
- Scope is sent as `scope` object in POST /api/projects/:id/process body
- Stored in `etapa4_fusao.data.scope` for reference

## Slab Detection Refinement
- Geometry extraction prompts (Etapa 3) include explicit instructions to distinguish concrete slabs from tile roofs
- Only concrete slabs (piso, coberta, radier) are included; tile roofs (ceramic, fiber cement, metal) are excluded
- Water tank slabs (laje de caixa d'água) are identified separately with `measurement_source: "laje_caixa_dagua"`
- Prompt includes examples for telhado exclusion and caixa d'água inclusion

## Frontend Tabs (ProjectDetails)
- **Tipo Projeto**: Toggle between "Teste" (with real cost input and accuracy calculation) and "Real" 
- **Analise IA**: AI-generated bullet-point analysis focused on budget/quantitative perspective (sections: Identificacao, Quantitativos, Distribuicao, Observacoes, Resumo, Alertas)
- **Arquivos**: Uploaded files with page classifications, delete per file, add new files, reprocess button
- **Etapas**: Expandable cards for each pipeline step; Etapa 5 shows formatted stat cards + per-floor tables (not raw JSON)
- **Quantitativos**: Editable walls/slabs/corners with enable/disable toggles and recalculate
- **Orcamento**: Proposta comercial table (matching real Lightwall format), SKU totals summary table, per-floor breakdown, complementary costs, API health/reliability card
- **Metodologia**: Detailed explanation of process, calculations, assumptions, methods, product specs, proposal format, validation, and limitations
- **Exportar**: PDF/Excel/JSON export options

## Calibration System
- **Dashboard card**: "Calibracao do Sistema" card appears when test projects with real cost exist, showing avg accuracy, avg deviation, category distribution bars, and identified patterns
- **Calibration page** (`/calibracao`): Detailed analysis with stat cards, category cost distribution, and comparative table per test project (calculated vs real cost, deviation, accuracy, over/under status)
- **Accuracy metrics**: Primary metric is m²-based (weighted average per category comparing calculated vs real area); R$-based accuracy as secondary. Projects without real area data fall back to R$ accuracy
- **Per-category m² accuracy**: 4 categories tracked: paredes_externas, paredes_internas, laje_piso, laje_coberta. DB columns: `real_area_ext`, `real_area_int`, `real_area_piso`, `real_area_coberta` (decimal 10,2)
- **Data preservation**: When user manually edits quantitativos, original AI data is preserved as `etapa4_fusao_original` in extracted_data table (snapshot before first edit)
- **API endpoint**: `GET /api/calibration` returns aggregated metrics including per-category area accuracy from all test projects with real cost

## Budget Data Structure
```
budgetData = {
  proposta: {
    itens: [{ item, local, discriminacao, sku, qtd_un, qtd_m2, preco_m2, preco_total }],
    totais_por_sku: [{ sku, nome, qtd_un, qtd_m2, preco_total }],
    paginacao: { discriminacao, qtd_un, qtd_m2, preco_m2, preco_total },
    total_paineis_un, total_area_m2, total_paineis_cost, grandTotal, preco_m2
  },
  costs: {
    panels: { total },
    paginacao: { total },
    complementar: { materials: { items, total }, labor: { hours, rate, total } },
    grandTotal
  },
  budget7etapas, quantitatives, materials, alerts, totals, projectDescription,
  apiHealth: {
    metrics: { totalCalls, successfulCalls, failedCalls, totalRetries, rateLimitHits, serverErrors, jsonParseRetries, failedPages,
      verification?: { verificationModel, isCrossModel, hadCorrections, fallbackUsed, fallbackReason? }
    },
    reliability: { score (0-100), level ("high"|"medium"|"low"), factors: string[] },
    processedAt
  }
}
```

## Calculation Rules
- Panel area: 1.83 m2 (3.00m x 0.61m)
- ALL panels are type 2P (no SP distinction)
- Loss coefficient: 5% if openings <= 20% of wall area, else 8%
- Slab loss: 10% fixed
- Radier (piso terreo): excluded from calculation (0 panels)
- Per-floor grouping: paredes_externas, paredes_internas, laje_piso, laje_coberta

## Gemini API Key
- Users can enter their own Google Gemini API key in Settings (/settings)
- All calls use gemini-2.5-pro model
- When user's key is set: direct Google API
- When no user key: falls back to Replit AI Integrations
- Key stored in settings table, loaded on server startup

## Product Catalog
- 22 pre-loaded Lightwall panels + 1 service (Projeto de Paginacao)
- Panel types: 2P and SP, various thicknesses (75mm, 90mm, 95mm, 120mm), standard and electric variants, L-type corners, 2500mm and 3000mm lengths
- Products table has `panel_type` column for type filtering
- CRUD API: GET/POST /api/products, PUT/DELETE /api/products/:id
- Users select which panel to use when processing a project (price from catalog drives the budget)
- Default product: LW-2P-090 (R$ 275/m2) if none selected

## Authentication
- Login system with express-session + passport-local + connect-pg-simple
- Session stored in PostgreSQL (`user_sessions` table, auto-created)
- Users table: id, username, password (bcrypt hash), display_name, role (admin/viewer), active, store_name, last_login_at
- Default admin user seeded on first startup (password configurable via DEFAULT_ADMIN_PASSWORD env var)
- Auth endpoints: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
- Admin user management: GET/POST /api/users, PUT /api/users/:id (all requireAdmin)
- All /api routes protected by requireAuth middleware (except /api/auth/*)
- Frontend AuthGate in App.tsx checks /api/auth/me; shows Login page if unauthenticated
- Login page uses Lightwall glass design with brand identity
- Logout button in Dashboard header clears session and redirects to login
- Session fixation protection: session regenerated on login
- Login tracks lastLoginAt timestamp per user
- Admin user management page (/usuarios) with create/edit/activate/deactivate users, store/origin tracking
- Self-protection: admins cannot deactivate themselves or remove their own admin role
- Key files: server/auth.ts, client/src/pages/Login.tsx, client/src/pages/Usuarios.tsx

## Client Identifier System
- **Client email**: Optional field on project creation, stored lowercase in `projects.client_email`
- **File fingerprint**: SHA-256 hash of sorted file contents generated on upload, stored in `projects.file_fingerprint` (64 chars)
- **Duplicate detection**: On `/process`, checks for existing completed projects with same fingerprint (and matching email when both present). Returns HTTP 409 with redirect to existing project
- **Admin-only visibility**: `clientEmail` and `fileFingerprint` are stripped from API responses for non-admin users (server-side filtering). Admin users see email/fingerprint badges in ProjectDetails header

## AI Pre-Treatment (Furniture/Debris Filtering)
- Geometry extraction prompt (`buildGeometryPrompt` in planAnalyzer.ts) includes explicit PRE-TREATMENT section
- Instructs AI to ignore: furniture, vegetation, vehicles, decorative hatching, area text, level markers, projection lines
- Focuses extraction on: solid wall lines, door arcs, window marks, dimensional annotations, slab boundaries

## Senior Architect Review (May 2026)
- **TypeScript baseline**: tsconfig now sets `target: ES2022`, eliminating Map/Set iteration errors and `function`-in-block strict-mode errors. `npx tsc --noEmit` returns clean.
- **Dead code removed**: `server/replit_integrations/chat/` (broken imports, never wired) and `server/replit_integrations/batch/` (unused, broken `pRetry.AbortError`) deleted. Only the `image/` integration remains.
- **Type cleanup**: `server/services/export/exportService.ts` now uses the actual `LegacyQuantitativeResult` shape and a locally-defined `MaterialList` type (mirrors the runtime shape produced in routes.ts). Removed dead references to legacy panel categories (SP, Tipo L, Eletricos) — all panels are 2P in current model.
- **Runtime hardening**: `parseInt(req.params.id)` → `parseInt(String(req.params.id))` on all Express handlers in routes.ts (defensive against the `string | string[]` type in some Express overloads). `assignDisplayLabels` now has explicit param types.
- **buildingTypePrompts**: `getBuildingTypeConfig` uses a typed key cast, removing implicit any.
- **Phase 2 applied** (PageHeader + states + rename + a11y):
  1. **`client/src/components/PageHeader.tsx`**: thin wrapper for the duplicated `glass-header` shell. Migrated all 9 pages: Dashboard, Settings, GuiaExterno, Catalogo, MetodologiaPage, Calibracao, Usuarios, NewProject, ProjectDetails. Header `<header className="glass-header...">` block + container div eliminated as duplicated code.
  2. **`client/src/components/ui/states.tsx`**: shared `LoadingState`, `ErrorState`, `EmptyState` components built on Card + lucide icons (Loader2/AlertTriangle/Inbox). Adopted in Calibracao (loading + empty) and Usuarios (loading + error).
  3. **`LegacyQuantitativeResult` → `QuantitativeResult`**: global rename in engine.ts and exportService.ts. The "Legacy" prefix was a misnomer — it's the only quantitatives shape now.
  4. **A11y**: `aria-label` added to icon-only Button components in Dashboard (logout) and ProjectDetails (edit/save/cancel project info).
- **Still deferred** (require dedicated session):
  1. `server/routes.ts` (2635 lines) and `client/src/pages/ProjectDetails.tsx` (2271 lines) splitting — multi-day refactor with regression risk that needs an isolated branch and full E2E tests.
  2. CI integration for `npx tsc --noEmit` and Playwright E2E tests — infra changes outside scope.

## Refinamento de classificacao IA (Maio 2026)
Refinamento dos prompts e heuristicas para melhorar a identificacao de parede externa/interna, muro, lajes e aberturas:

1. **Prompt enriquecido** (`server/services/takeoff/prompt.ts` — `TAKEOFF_SYSTEM_PROMPT`):
   - Checklist de raciocinio em 6 passos antes da classificacao.
   - Definicoes detalhadas com pistas visuais brasileiras (NBR 6492): traco grosso vs fino, hachuras, posicao no perimetro, espessuras tipicas, tem cobertura ou nao.
   - Secao de anti-exemplos (parede grossa interna != externa, linha tracejada perimetral != externa, muro de divisa != externa, beiral faz parte da laje_cobertura).
   - Secao de aberturas com pistas visuais (arco da porta, linhas paralelas da janela) e instrucao para cruzar com o quadro_esquadrias usando codigos P1/J1.
   - `needs_review=true` agora obrigatorio em qualquer ambiguidade entre categorias.

2. **Contexto de tipo de edificacao injetado no prompt visual** (`buildUserPrompt`):
   - Novo parametro opcional `buildingType?: string | null`.
   - Quando presente, injeta `fewShotContext` + `verificationHints` do `getBuildingTypeConfig` (residencial/comercial/institucional/industrial/outro). Lazy require com try/catch para nao quebrar caso a config falhe.
   - `AnalyzeOptions` em `aiTakeoffService.ts` recebeu o campo. Call site em `server/routes.ts` (L1094) passa `effectiveBuildingType()`.

3. **Score-based reclassification sempre rodando como flag** (`server/services/calculation/engine.ts`):
   - `ExtractedWall` (planAnalyzer.ts) e `WallItem` (engine.ts) ganharam campos opcionais `needs_review?: boolean; review_reason?: string`.
   - O caso extremo existente (intWallCount === 0 → reclassifica por score) foi preservado e agora tambem marca `needs_review` nas paredes mexidas.
   - Novo passo sempre-ativo (quando ha 4+ paredes nao-muro): calcula `wallExternalScore` para todas, normaliza 0..1, identifica top expectedPerimeter por score. Marca `needs_review=true` + `review_reason` + reduz confidence (cap em 0.6) quando classificacao IA discorda do score, mas **NAO sobrescreve a classe** — decisao final fica com o humano. Walls ja sinalizadas pelo caso extremo sao puladas (evita double-flag).
   - `calculateWallPanels` propaga os campos para o `WallItem` consumido pelo frontend.

**Surface de follow-up identificada pela revisao** (nao implementada ainda):
- `client/src/components/QuantitativosEditor.tsx`: exibir indicador visual (ex: icone laranja) e tooltip com `review_reason` nas linhas onde `needs_review === true`.
- `server/services/export/exportService.ts`: coluna "Notas de Revisao" no Excel/PDF para alertar a equipe tecnica.
- `BudgetResult` ja propaga os campos via API existente, dados estao disponiveis no frontend sem mudanca de rota.

## Database
- PostgreSQL with 8 tables: users, products (with panel_type), projects (with client_email + file_fingerprint), project_files, extracted_data, budgets, settings, ai_runs + user_sessions (auto-managed)
- Orphan tables removed (Apr 2026): takeoff_segments, takeoff_slabs, takeoff_revisions, takeoff_exports, project_pages

## Pre-flight & Native PDF Vector Pipeline (Apr 2026)
- **server/services/preflight/inspector.ts**: Inspects every uploaded file before any IA call. Returns {fileType, isPdfVector, pageCount, hasEmbeddedText, dimensions, recommendedMode}. Counts only path-drawing OPS (constructPath/rectangle/stroke/fill) and applies a paths-per-page ratio check to distinguish true vector PDFs from raster-only scans. Result is logged + sent as a progress event.
- **server/services/preflight/pdfVectorExtractor.ts**: Native vector extraction via pdfjs-dist v5 legacy build. Handles the v5 fused `constructPath(op, data, minMax)` encoding where `args[0]` is the painting op (whitelisted: stroke/closeStroke/fill/eoFill/fillStroke/eoFillStroke/closeFillStroke/closeEOFillStroke) and `args[1]` is a Float32Array of inline DrawOPS (moveTo=0, lineTo=1, curveTo=2, quadraticCurveTo=3, closePath=4). Includes standalone OPS.rectangle handler. Wall pairing uses real projected overlap + collinearity (>=60% min side). Scale derived from cota text with a dispersion gate: requires >=60% of cotas to agree within +/-25% of median, otherwise falls back to default 1:50 scale. Scoped to plantaPages only. Pushed into allGeometries as candidates with measurement_source="pdf_vector".
- **server/services/calculation/geometryValidator.ts**: Applied between fusion and budget calc. filterByThickness, snapOrthogonal, closeSmallGaps, removeFloatingWalls, removeOpenSlabLoops + Number.isFinite guards everywhere. Logs dropped/modified counts (e.g., `[VALIDATOR] paredes: 175→175 | lajes: 2→0 (-2)` with reason `2 laje(s) absurdas (> 5000m²)`).
- **server/services/audit/aiAuditor.ts**: `auditAiCall(name, fn, ctx)` wraps every IA call (classifyAndExtractTables, extractGeometryParallel, describeProject, OpenAI Vision Takeoff). Persists projectId, model (dynamic: `openai:${getOpenAIModelName()}` vs `gemini-2.5-pro/flash`), inputSummary, durationMs, status, errorMessage to `ai_runs`.

## Visual + Precision Improvements (May 2026 — T101..T105)
- **Color scheme overhaul (T101)**: Annotated PNGs now use red(#dc2626)=externas / green(#16a34a)=internas / blue(#1d4ed8)=muros. Updated in `server/routes.ts` `buildAnnotationPrompt`, `client/src/components/AnnotatedFloorPlan.tsx` (EXT/INT/MURO_COLORS), and `cv-service/app/config.py` COLORS dict. Legend strip on annotated images mirrors the same scheme.
- **Sequential per-pavimento labels (T102)**: `assignDisplayLabels()` helper in `server/routes.ts` mutates wall.displayLabel = `W##` (externas/internas) or `M##` (muros), sorted by classe then descending length. Slabs get `L##`. Labels appear in annotated PNG as `W01\n9,20 m` with white background + colored border tag.
- **Consolidated multi-pavimento PNG (T103)**: New `server/services/render/consolidatedAnnotation.ts` (sharp v0.34.5) composes per-pavimento PNGs into a 2-column grid with SVG title bars + bottom legend strip. Endpoint `POST /api/projects/:id/annotated-image-consolidated` reads cached images from `extracted_data` where `elementType='etapa3_annotated_plan'` and returns `{image: dataUrl, pavimentos: [...]}`. Returns 400 when no cache exists (fail-loud).
- **Global cross-validation pass (T104)**: New `server/services/gemini/globalValidator.ts` runs after `validateGeometry` and before budget calc. Sends ALL planta_baixa pages + the fused `{walls, slabs}` JSON in a single conversational call (gemini-2.5-pro or `openai:${model}` based on `getActiveProvider()`, max 16384 output tokens). Prompts the AI to find duplicates, missing walls, unit errors (cm vs m), and misclassifications. Corrections (`comprimento_m`, `altura_m`, `classe`, `remove`) are applied **only** when AI returns `confidence >= 0.7`. Wrapped in `auditAiCall` with promptVersion=`globalCrossValidation_v1`. Opt-in via `?globalValidation=1` query param OR `project.settings.useGlobalValidation = true`. Failures are caught and logged — pipeline continues unchanged. Smoke-tested on project 5: invoked correctly under `runWithProvider` context, error path handled gracefully when AI key unavailable.

## Provider-Aware Image Annotation (May 2026)
- **editImage** (`server/replit_integrations/image/client.ts`): Now provider-aware — routes to Gemini or OpenAI based on `getActiveProvider()`. Falls back to OpenAI when Gemini key is unavailable.
- **OpenAI image editing**: Uses `/v1/images/edits` endpoint. Tries `gpt-image-1` first, then falls back to `dall-e-2`. Handles RGBA conversion (dall-e-2 requirement), prompt truncation (1000-char limit for dall-e-2), and PDF→PNG conversion via `pdftoppm`.
- **PDF→PNG conversion**: `pdfBufferToPng()` uses system `pdftoppm` (poppler) to render PDF pages to 200 DPI PNG before sending to OpenAI (Gemini accepts PDF natively).
- **Pipeline SSE timer fix**: Pre-flight events moved from step 0 to step 0.5; frontend only treats step 0 as terminal when label is "Concluido" or "Erro"; removed duplicate `setIsProcessing(false)` from mutation `onSuccess`.

## Pipeline Performance Optimizations (May 2026)
- **PDF split cache** (`planAnalyzer.ts`): `splitPdfPages()` now caches results in a module-level `Map<absPath, pages[]>`. Cache is cleared at the start of each `/process` call via `clearSplitCache()`. Eliminates 3-4 redundant PDF re-parses per file (each involves file I/O + pdf-lib load + per-page copy + base64 encode). Confirmed via `[PDF] Cache hit` log lines.
- **Parallel annotation generation** (`routes.ts` Etapa 4.5): All pavimento `editImage()` calls now fire concurrently via `Promise.allSettled` instead of sequential `for...await`. For a 3-pavimento project at ~15s/image, saves ~30s.
- **Early description fire** (`routes.ts`): `describeProject()` AI call is launched as an unawaited promise immediately after budget calc, running concurrently with annotation persistence + reference image extraction. Awaited just before its result is needed. Saves ~10-15s on typical projects.
- **Net impact**: ~30-45s faster on a typical 3-page residential project in production (where AI calls dominate). Dev environment shows ~4s improvement (AI calls fail instantly with 403).

## Scripts
- `npm run dev` - Development server (port 5000)
- `npm run db:seed` - Populate product catalog
- `npm run db:push` - Apply Drizzle schema
- `npm run validate` - Validate system configuration
