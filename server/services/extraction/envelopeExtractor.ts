import { withRetry } from "../gemini/client";
import { repairJSON, getActiveGenAI } from "../gemini/planAnalyzer";
import { auditAiCall, recordAiUsage, geminiUsageFromResponse } from "../audit/aiAuditor";

/**
 * Estagio S2 da metodologia de extracao passo-a-passo.
 *
 * Resolve "o que esta dentro e o que esta fora da edificacao" como
 * UM POLIGONO EXPLICITO, em vez de deixar isso implicito no prompt
 * monolitico da Etapa 3. Cada planta_baixa produz um envelope, que
 * depois e usado pela classificacao topologica deterministica (S5).
 *
 * Princıpio: peça ao LLM SO o que ele é bom — ver formas e tracar
 * contorno. Toda a logica subsequente (point-in-polygon, comparar
 * areas, dedup) e codigo determinıstico.
 */

export interface EnvelopePolygon {
  pavimento: string;
  pageIndex: number;
  /** Polígono fechado, vertices em coordenadas normalizadas 0-1000 (x, y). */
  polygon: Array<[number, number]>;
  /** Polígono do lote (muros de divisa) se visível. */
  lotPolygon?: Array<[number, number]>;
  confidence: number;
  notes: string[];
}

interface EnvelopeJob {
  projectId: number;
  pageIndex: number;
  pavimento: string;
  base64: string;
  mimeType: string;
  formaHint?: FormaEnvelopeHint;
}

const ENVELOPE_MODEL = "gemini-2.5-pro";

export type FormaEnvelopeHint = "retangular_simples" | "L" | "U" | "irregular";

function formaHintBlock(hint?: FormaEnvelopeHint): string {
  if (!hint) return "";
  const map: Record<FormaEnvelopeHint, string> = {
    retangular_simples: "DICA: caracterizacao previa indicou envelope RETANGULAR SIMPLES (4 vertices ortogonais). Privilegie vertices ortogonais; se voce ve 6+ vertices, reavalie.",
    L: "DICA: caracterizacao previa indicou envelope em formato L (6 vertices, 1 reentrancia). Espere 6 vertices ortogonais.",
    U: "DICA: caracterizacao previa indicou envelope em formato U (8 vertices, 2 reentrancias). Espere 8 vertices ortogonais.",
    irregular: "DICA: caracterizacao previa indicou envelope IRREGULAR. Sem expectativa de quantidade — siga o contorno real.",
  };
  return `\n\n${map[hint]}\n`;
}

function buildEnvelopePrompt(pavimento: string, hint?: FormaEnvelopeHint): string {
  return `TAREFA UNICA: trace o poligono fechado que separa a EDIFICACAO COBERTA do exterior nesta planta arquitetonica do pavimento "${pavimento}".${formaHintBlock(hint)}

NAO classifique paredes.
NAO conte comodos.
NAO leia cotas.
NAO descreva o desenho.

Apenas devolva os vertices do contorno externo da casa, percorrendo-os em ordem (sentido horario ou anti-horario, tanto faz desde que conexos).

DEFINICAO de "edificacao coberta":
- Inclui ambientes fechados (salas, quartos, banheiros, cozinha, area de servico).
- Inclui varandas cobertas, garagens cobertas e areas com cobertura.
- EXCLUI jardins, calcadas, piscina externa, recuos, estacionamento aberto.

Se houver um muro de divisa do LOTE visivelmente separado da edificacao
(linha mais externa, contorno do terreno), devolva esse poligono em "lotPolygon".
Se nao houver muro de divisa visivel, devolva null.

Output JSON valido, sem texto antes ou depois, sem markdown, sem comentarios:
{
  "polygon": [[x,y], [x,y], [x,y], ...],
  "lotPolygon": [[x,y], ...] | null,
  "confidence": 0.0-1.0,
  "notes": ["observacao curta", ...]
}

Coordenadas normalizadas em 0-1000 (x = horizontal, y = vertical; (0,0) = canto superior esquerdo).
Use no minimo 4 vertices para o poligono. Casas retangulares simples = 4 vertices; casas com recuos = 6-12 vertices.`;
}

function validatePolygon(raw: any): Array<[number, number]> | null {
  if (!Array.isArray(raw)) return null;
  const pts: Array<[number, number]> = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const x = Number(item[0]);
    const y = Number(item[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || x > 1000 || y < 0 || y > 1000) continue;
    pts.push([x, y]);
  }
  return pts.length >= 3 ? pts : null;
}

async function extractOneEnvelope(job: EnvelopeJob): Promise<EnvelopePolygon | null> {
  const prompt = buildEnvelopePrompt(job.pavimento, job.formaHint);
  const parts = [{ inlineData: { mimeType: job.mimeType, data: job.base64 } }, { text: prompt }];

  const text = await auditAiCall(
    {
      projectId: job.projectId,
      pageId: job.pageIndex,
      promptVersion: "envelope_v1",
      model: ENVELOPE_MODEL,
      inputSummary: `envelope pavimento="${job.pavimento}" page=${job.pageIndex}`,
    },
    async () => {
      return withRetry(async () => {
        const response = await getActiveGenAI().models.generateContent({
          model: ENVELOPE_MODEL,
          contents: [{ role: "user", parts }],
          // Thinking budget alto: tracar contorno demanda raciocinio espacial,
          // e essa e a unica tarefa da chamada — vale o custo.
          config: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 6144 } },
        });
        recordAiUsage(geminiUsageFromResponse(response));
        return response.text ?? "";
      }, "envelopeExtractor");
    },
  );

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(`[ENVELOPE] Pav "${job.pavimento}" pg ${job.pageIndex}: sem JSON na resposta`);
    return null;
  }
  const parsed = repairJSON(jsonMatch[0]);
  if (!parsed || typeof parsed !== "object") {
    console.warn(`[ENVELOPE] Pav "${job.pavimento}" pg ${job.pageIndex}: JSON invalido`);
    return null;
  }

  const polygon = validatePolygon(parsed.polygon);
  if (!polygon) {
    console.warn(`[ENVELOPE] Pav "${job.pavimento}" pg ${job.pageIndex}: poligono invalido (${parsed.polygon?.length || 0} vertices)`);
    return null;
  }

  const lotPolygonRaw = parsed.lotPolygon ?? parsed.lot_polygon;
  const lotPolygon = lotPolygonRaw ? validatePolygon(lotPolygonRaw) ?? undefined : undefined;

  const confidence = Number(parsed.confidence);
  const notes: string[] = Array.isArray(parsed.notes)
    ? parsed.notes.filter((n: any) => typeof n === "string").slice(0, 5)
    : [];

  console.log(
    `[ENVELOPE] Pav "${job.pavimento}" pg ${job.pageIndex}: ${polygon.length} vertices, ` +
    `lot=${lotPolygon ? lotPolygon.length + "v" : "nenhum"}, conf=${confidence}`,
  );

  return {
    pavimento: job.pavimento,
    pageIndex: job.pageIndex,
    polygon,
    lotPolygon,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7,
    notes,
  };
}

export interface ExtractEnvelopesInput {
  projectId: number;
  pages: Array<{ pageIndex: number; pavimento: string; base64: string; mimeType: string }>;
  /** Dica vinda da caracterizacao (Etapa 1.5). Quando presente, vira parte do prompt. */
  formaHint?: FormaEnvelopeHint;
}

/**
 * Extrai um envelope por pavimento (de-duplicado: se duas plantas_baixa do
 * mesmo pavimento existirem, processa apenas a primeira). Paralelo entre
 * pavimentos. Falhas por pavimento sao isoladas — retorna apenas os que
 * conseguiram.
 */
export async function extractEnvelopes(input: ExtractEnvelopesInput): Promise<EnvelopePolygon[]> {
  // dedup: 1 chamada por pavimento (mesma assinatura que getAnnotationImageSources)
  const seen = new Set<string>();
  const jobs: EnvelopeJob[] = [];
  for (const p of input.pages) {
    if (seen.has(p.pavimento)) continue;
    seen.add(p.pavimento);
    jobs.push({
      projectId: input.projectId,
      pageIndex: p.pageIndex,
      pavimento: p.pavimento,
      base64: p.base64,
      mimeType: p.mimeType,
      formaHint: input.formaHint,
    });
  }

  if (jobs.length === 0) return [];

  const results = await Promise.allSettled(jobs.map(extractOneEnvelope));
  const envelopes: EnvelopePolygon[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled" && r.value) envelopes.push(r.value);
    else if (r.status === "rejected") {
      console.warn(`[ENVELOPE] Pav "${jobs[i].pavimento}" falhou:`, (r as PromiseRejectedResult).reason?.message || r);
    }
  }
  return envelopes;
}
