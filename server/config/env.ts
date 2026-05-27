import { z } from "zod";

/**
 * Schema das variaveis de ambiente do servidor. Validado uma unica vez no
 * boot via `loadEnv()` e re-exportado como `env` para ser consumido em
 * type-safe pelos demais modulos.
 *
 * Regra de seguranca: NUNCA leia process.env diretamente em modulos novos —
 * sempre use `import { env } from "./config/env"`. Isso garante que mudancas
 * no contrato sejam visiveis no schema (e no .env.example).
 */
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (Postgres connection string)"),

  // Auth / sessions
  SESSION_SECRET: z
    .string()
    .min(16, "SESSION_SECRET must be at least 16 chars (use a long random string)"),
  DEFAULT_ADMIN_PASSWORD: z.string().min(1).optional(),

  // AI integrations (todas opcionais — se nao definidas, usuario configura via UI;
  // se definidas, viram source-of-truth imutavel e a UI fica read-only).
  AI_INTEGRATIONS_GEMINI_API_KEY: z.string().min(10).optional(),
  AI_INTEGRATIONS_GEMINI_BASE_URL: z.string().url().optional(),
  AI_INTEGRATIONS_OPENAI_API_KEY: z.string().min(10).optional(),
  AI_INTEGRATIONS_OPENAI_MODEL: z.string().min(1).optional(),

  // CV service (opcional — auto-fallback para Gemini-only se ausente)
  CV_SERVICE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Le e valida as env vars. Em falha, imprime erros formatados e encerra
 * o processo com exit code 1 — falha cedo, antes de subir o servidor.
 */
export function loadEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    console.error(
      `\n[env] Falha na validacao das variaveis de ambiente:\n${issues}\n\n` +
        `Verifique seu arquivo .env (copie .env.example se ainda nao existir).\n`,
    );
    process.exit(1);
  }

  cached = parsed.data;
  return cached;
}

/** Env validado e tipado. Disparado no momento do primeiro import. */
export const env: Env = loadEnv();
