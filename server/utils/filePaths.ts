import fs from "node:fs";
import path from "node:path";

/**
 * Diretorio canonico onde os uploads de projetos vivem. Resolvido contra o
 * process.cwd() do servidor no momento do boot — uma vez resolvido, o valor
 * fica fixo mesmo se o cwd mudar durante a execucao.
 *
 * Em producao Docker isso aponta para /app/server/uploads/projects (volume
 * persistente "app_uploads" no docker-compose.yml). No Replit aponta para o
 * diretorio do projeto. Em dev local, idem.
 */
export const UPLOADS_DIR = path.resolve(process.cwd(), "server", "uploads", "projects");

/**
 * Resolve um filePath salvo no banco para o caminho absoluto efetivamente
 * presente no disco. Lida com tres formatos que aparecem em projetos
 * historicos do Lightwall:
 *
 *   1. Path absoluto ja correto (uploads novos apos o fix)
 *   2. Path relativo ao cwd ("server/uploads/projects/abc123") — formato
 *      legado do multer, quebra quando o cwd do servidor muda entre
 *      restarts/deploys
 *   3. Basename + diretorio canonico — funciona mesmo se o path no DB
 *      apontar para um cwd diferente, contanto que o arquivo esteja no
 *      diretorio padrao de uploads
 *
 * Retorna o caminho absoluto verificado em disco, ou `null` se nenhuma
 * variante existir (arquivo realmente foi perdido — usuario precisa
 * fazer re-upload).
 */
export function resolveProjectFilePath(filePath: string | null | undefined): string | null {
  if (!filePath) return null;

  const candidates: string[] = [];
  if (path.isAbsolute(filePath)) candidates.push(filePath);
  candidates.push(path.resolve(process.cwd(), filePath));
  candidates.push(path.join(UPLOADS_DIR, path.basename(filePath)));

  // Tira duplicatas mantendo a ordem (caso path.isAbsolute === resolve(cwd, p))
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // erros de permissao etc — tenta o proximo candidato
    }
  }
  return null;
}

/**
 * Variante stricta: usa em fluxos onde o caminho TEM que existir.
 * Lanca erro com mensagem clara se nada resolver.
 */
export function requireProjectFilePath(filePath: string | null | undefined, label = "arquivo"): string {
  const resolved = resolveProjectFilePath(filePath);
  if (resolved) return resolved;
  throw new Error(
    `Nao foi possivel localizar o ${label} em disco (filePath="${filePath}"). ` +
    `O arquivo pode ter sido removido apos o upload original. ` +
    `Faca upload do arquivo novamente.`
  );
}
