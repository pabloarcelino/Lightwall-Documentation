import { pool } from "./db";

/**
 * Self-heal schema gaps no boot. Roda CREATE TABLE IF NOT EXISTS / CREATE
 * INDEX IF NOT EXISTS pra tabelas/indices que foram introduzidas em commits
 * recentes mas podem ainda nao existir em bancos antigos (porque
 * `drizzle-kit push` nao foi rodado, ou rodaria com DATA LOSS warnings em
 * outras tabelas).
 *
 * Regras de seguranca:
 *  - NUNCA usar DROP, ALTER ... DROP, ou TRUNCATE.
 *  - NUNCA tocar em tabelas que ja existem (so adicionar novas ou indices).
 *  - Cada bloco DEVE ser idempotente (rodavel multiplas vezes sem dano).
 *  - Falhas individuais nao quebram o boot — logamos e seguimos. Codigo de
 *    storage tem try/catch defensivo pra ausencia da tabela.
 *
 * Quando o `drizzle-kit push` for finalmente rodado e o schema do banco
 * convergir 100% com o schema do app, esse arquivo vira no-op.
 */
export async function bootstrapSchema(): Promise<void> {
  const statements: Array<{ name: string; sql: string }> = [
    {
      name: "pipeline_events table",
      sql: `
        CREATE TABLE IF NOT EXISTS pipeline_events (
          id SERIAL PRIMARY KEY,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          kind VARCHAR(30) NOT NULL,
          stage VARCHAR(20),
          phase VARCHAR(20) NOT NULL,
          payload JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `,
    },
    {
      name: "pipeline_events project_id index",
      sql: `
        CREATE INDEX IF NOT EXISTS pipeline_events_project_idx
        ON pipeline_events(project_id)
      `,
    },
    {
      name: "vision_direct_runs table",
      sql: `
        CREATE TABLE IF NOT EXISTS vision_direct_runs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          file_name VARCHAR(255) NOT NULL,
          file_type VARCHAR(20) NOT NULL,
          page_count INTEGER NOT NULL DEFAULT 1,
          pe_direito_usado_m DECIMAL(4,2),
          pe_direito_fonte VARCHAR(20),
          results JSONB NOT NULL,
          cost_usd DECIMAL(6,4),
          duration_ms INTEGER,
          status VARCHAR(20) NOT NULL DEFAULT 'completed',
          error_message TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `,
    },
    {
      name: "vision_direct_runs user_id index",
      sql: `
        CREATE INDEX IF NOT EXISTS vision_direct_runs_user_idx
        ON vision_direct_runs(user_id)
      `,
    },
  ];

  for (const stmt of statements) {
    try {
      await pool.query(stmt.sql);
      console.log(`[BOOTSTRAP] OK: ${stmt.name}`);
    } catch (err: any) {
      // Best-effort. Erros tipicos: permissao insuficiente, dependencia
      // ausente. Nao bloqueia o servidor — codigo cliente tem fallback.
      console.warn(`[BOOTSTRAP] Falha em "${stmt.name}": ${err?.message || err}`);
    }
  }
}
