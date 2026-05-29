import express, { type Request, Response, NextFunction } from "express";
import { env } from "./config/env";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupAuth, ensureDefaultUser } from "./auth";
import { ensureProductCatalog } from "./seed-startup";
import { bootstrapSchema } from "./bootstrap-schema";

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err);
  // Nao derrubamos o processo aqui — em producao o supervisor (PM2/Docker)
  // reinicia se precisar, e logamos pra investigar. Caso surja um padrao de
  // estados corrompidos pos-erro, trocar por process.exit(1).
});

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "100mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "100mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        // Skip body for endpoints that may contain heavy/sensitive payloads
        // (rendered page images, AI raw outputs, file blobs, etc).
        const isHeavyEndpoint = /\/takeoff(\b|\/)/i.test(path) || /\/files\//i.test(path);
        if (!isHeavyEndpoint) {
          const serialized = JSON.stringify(capturedJsonResponse);
          logLine += ` :: ${serialized.length > 500 ? serialized.slice(0, 500) + "...[truncated]" : serialized}`;
        }
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  setupAuth(app);
  await bootstrapSchema();
  await ensureDefaultUser();
  await ensureProductCatalog();
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  // NOTE: usar process.env.NODE_ENV (nao env.NODE_ENV) pra que o esbuild
  // substitua em build-time (define) e elimine o import dinamico de ./vite no
  // bundle de producao — caso contrario o bundle puxa vite.config.ts e os
  // plugins ESM-only do Replit, quebrando o deploy com "module is not defined
  // in ES module scope".
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  httpServer.listen(
    {
      port: env.PORT,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${env.PORT}`);
    },
  );
})();
