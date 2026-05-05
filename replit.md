# Lightwall Budget System

Web app for parametric budgeting of Lightwall concrete panels with AI-powered interpretation of architectural plans (PDF/images), exporting budgets in various formats.

## Run & Operate

- `npm run dev`: Starts the development server.
- `npm run db:push`: Applies the Drizzle database schema migrations.
- `npm run db:seed`: Populates the product catalog.
- `npm run validate`: Validates system configuration.

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