---
name: Deploy bundle must not include vite
description: Why the prod server gate must use process.env.NODE_ENV, or the deploy crashes loading ESM-only Replit vite plugins.
---

# Production bundle must dead-code-eliminate the dev `./vite` import

The prod server is bundled by `script/build.ts` via esbuild to `dist/index.cjs`
(CommonJS) with `define: { "process.env.NODE_ENV": '"production"' }`.

`server/index.ts` gates the dev-only `await import("./vite")` (which pulls in
`vite.config.ts` and the `@replit/vite-plugin-*` packages, all ESM-only). That
gate **must** be written as `process.env.NODE_ENV === "production"` — NOT
`env.NODE_ENV` (the object from `server/config/env.ts`).

**Why:** Only the literal `process.env.NODE_ENV` is replaced by esbuild's
`define` at build time, letting esbuild constant-fold the condition and strip the
`else` branch. With `env.NODE_ENV` both branches stay reachable, so the bundle
requires the ESM-only Replit vite plugins and the deploy crashes at startup with
`ReferenceError: module is not defined in ES module scope`.

**How to apply:** If a deploy fails with that error, check this gate first.
Verify with: `npm run build` then
`grep -c "vite-plugin-runtime-error-modal" dist/index.cjs` → must be 0.
This fix has been reverted once by a checkpoint rollback — re-check it exists if
the deploy regresses. Using both `env` (for PORT) and `process.env` (for this
gate) in the same file is deliberate; do not "clean it up".
