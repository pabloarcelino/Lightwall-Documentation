# Lightwall Budget System

Web app for parametric budgeting of Lightwall concrete panels with AI-powered interpretation of architectural plans (PDF/images), exporting budgets in various formats.

## Run & Operate

- `npm run dev`: Starts the development server.
- `npm run db:push`: Applies the Drizzle database schema migrations.
- `npm run db:seed`: Populates the product catalog.
- `npm run validate`: Validates system configuration.
- `npx tsx server/importLeroyMerlinPrices.ts [path.xlsx]`: Importa a Tabela Unificada Leroy Merlin (aba `Tabelas_Nova Válida`, coluna **TABELA VÁLIDA** — sem frete). Cria um perfil de preço por central (`LM-MACEIO`, `LM-FORTALEZA`, `LM-NATAL`, `LM-BARRA-DA-TIJUCA`, `LM-SANTOS`, `LM-ANHANGUERA`, `LM-DOM-PEDRO`, `LM-MORUMBI`, `LM-RAPOSO-TAVARES`, `LM-SAO-JOSE`, `LM-TAMBORE`, `LM-TIETE-2`) e faz upsert de `profile_prices` casando produtos por nome normalizado (sem acentos/aspas). Idempotente. Default lê `attached_assets/Tabela_Unificada_-_Leroy_Merlim_V2_1779112601069.xlsx`.
- `npx tsx server/tests/accuracy.ts [fixture]`: Runs the quantitative accuracy regression suite against fixtures defined in `server/tests/groundTruth.json`. Reads persisted budgets from the DB (no AI calls) and reports per-category and weighted-average accuracy vs. ground truth. Pass a substring (e.g. `patricia`) to filter.

**Environment Variables:**
- `DEFAULT_ADMIN_PASSWORD`: Sets the password for the default admin user on first startup.
- Google Gemini API key or OpenAI API key (configurable in Settings).

## Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Shadcn UI, TanStack Query, wouter, react-dropzone
- **Backend**: Express, TypeScript, Drizzle ORM, PostgreSQL
- **AI**: Google Gemini 2.5 Pro, OpenAI GPT-4o
- **Export**: PDFKit, ExcelJS, JSON
- **Build Tool**: npm

## Where things live

- `shared/schema.ts`: Database schema definition (Drizzle).
- `server/routes.ts`: API routes and pipeline orchestration.
- `server/storage.ts`: Database storage layer.
- `server/services/gemini/client.ts`: Gemini AI client and health metrics.
- `server/services/gemini/planAnalyzer.ts`: AI services for page classification, table/geometry extraction, and project description.
- `server/services/ai/provider.ts`: AI provider abstraction (Gemini, OpenAI).
- `server/services/calculation/engine.ts`: Multi-view fusion, budget calculation, validation.
- `server/services/export/exportService.ts`: PDF/Excel/JSON export logic.
- `server/seed.ts`: Product catalog seeding.
- `client/src/App.tsx`: Frontend routing.
- `client/src/pages/ProjectDetails.tsx`: Main project view with tabs.
- `client/src/pages/Settings.tsx`: API key configuration.
- `server/auth.ts`: Authentication setup (express-session, passport-local).

## Architecture decisions

- **8-Step AI Pipeline**: Structured approach for robust plan analysis and budgeting, including classification, extraction, fusion, and validation.
- **Multi-Model AI Verification**: Optional cross-model verification (Gemini vs. OpenAI) to enhance data accuracy and reliability, especially for geometry extraction.
- **Topological Wall Classification**: Uses a ray-casting method for precise external/internal wall classification, robust to complex architectural shapes.
- **Client Identifier System**: SHA-256 file fingerprinting and optional client email for duplicate project detection and enhanced data management.
- **Calibration System**: Integrated module for tracking budget accuracy against real costs, providing insights into model performance and deviations.
- **Vector Extraction Scale Gate**: PDF vector extractor only emits walls when page-level scale comes from confirmed cota text (`scale.source === "cota"`). Pages with fallback scale are skipped to avoid inflating the budget with furniture/hatches misclassified as walls.
- **Sanity Caps in Auto-Slabs**: `estimateFloorArea` and the coberta mirror fallback bail out when the inferred per-floor area exceeds `SANE_FLOOR_AREA_MAX_M2` (800 m²) — prevents absurd auto-generated slabs (e.g. 16k m²) when wall perimeter is over-extracted.
- **Quadro de áreas autoritativo**: `area_total` extraído da tabela vira ground-truth para a área da laje do nivel correspondente: cria a laje quando ausente, sobrescreve quando presente, e impõe um cap absoluto de +5% sobre `area_total` em todas as lajes daquele nivel (`*_capped_by_table`). `tipo: "area_coberta"` recebe o mesmo tratamento. Soma de comodos é fallback de menor confiança.
- **Detecção de escala vetorial robusta**: `detectScale` em `pdfVectorExtractor.ts` usa regex tolerante (cm/m/mm, separadores `,`/`.`, sinal opcional, inteiros como cm), agrupa razões em clusters 1D ±15% e adota o cluster denso dominante. O limiar de proximidade cota↔segmento escala com a diagonal da página (suporta A1/A0). Páginas sem cota confiável continuam a pular o vetor.
- **Auditoria cross-source de perímetro**: ao final de `fusionMultiView`, o perímetro externo somado por nivel é comparado entre as fontes presentes (vetor PDF, IA, OpenAI Vision, tabela). Quando uma fonte diverge >50% da mediana, todas as paredes daquela fonte ganham `needs_review=true` com `review_reason` indicando o desvio, e a confiança é cortada para ≤0.55. Fica visível no UI como badge "revisar".

## Product

- **Parametric Budgeting**: Generates budget proposals for Lightwall concrete panels based on architectural plans.
- **AI-Powered Plan Analysis**: Automatically classifies pages, extracts geometry, and identifies elements from PDF/image plans.
- **Multi-Format Export**: Supports exporting budgets as PDF, Excel, and JSON.
- **Customizable Proposals**: Allows selection of panel types, pre-selection of scope categories, and manual adjustments to quantities.
- **System Calibration**: Provides tools to assess and improve the accuracy of AI calculations by comparing against real project costs.
- **User and Product Management**: Features for managing users, roles, and a product catalog.

## User preferences

- _Populate as you build_

## Gotchas

- **AI Key Configuration**: Ensure either a Google Gemini or OpenAI API key is configured in settings for full AI functionality; otherwise, some features may fall back or be unavailable.
- **PDF Vector Extraction**: Vector PDF processing relies on `pdftoppm` system utility for OpenAI image editing, which might require separate installation.
- **Geometry Validation**: Automated geometry validation may remove or modify absurd elements (e.g., extremely large slabs), which are logged but may alter initial AI extraction results.
- **Large File Processing**: `server/routes.ts` and `client/src/pages/ProjectDetails.tsx` are very large; refactoring them is a deferred task with potential regression risk.

## Pointers

- [Drizzle ORM Documentation](https://orm.drizzle.team/docs/overview)
- [TanStack Query Documentation](https://tanstack.com/query/latest)
- [Google Gemini API Documentation](https://ai.google.dev/docs)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [PDF-LIB Documentation](https://pdf-lib.js.org/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Shadcn UI Documentation](https://ui.shadcn.com/)