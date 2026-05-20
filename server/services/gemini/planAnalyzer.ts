import { genAI, MODEL_NAME, createUserGenAI, USER_MODEL_NAME } from "./client";
import type { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import { PDFDocument } from "pdf-lib";
import path from "path";
import { getBuildingTypeConfig } from "./buildingTypePrompts";

let activeGenAI: GoogleGenAI = genAI;
let activeModelName: string = MODEL_NAME;

export function setUserApiKey(apiKey: string) {
  activeGenAI = createUserGenAI(apiKey);
  activeModelName = USER_MODEL_NAME;
  console.log("[Gemini] Usando chave de API do usuario");
}

export function clearUserApiKey() {
  activeGenAI = genAI;
  activeModelName = MODEL_NAME;
  console.log("[Gemini] Usando chave de API do sistema (Replit AI Integrations)");
}

export interface PageClassification {
  page_index: number;
  classificacao: string;
  pavimento: string;
  has_table: boolean;
  has_scale: boolean;
}

export interface WallEsquadria {
  tipo: "porta" | "janela";
  codigo: string;
  largura_m: number;
  altura_m: number;
  peitoril_m?: number;
  measurement_source: string;
}

export interface ExtractedWall {
  id: string;
  nivel: string;
  classe: "externa" | "interna" | "muro";
  comprimento_m: number;
  altura_m: number;
  espessura_m: number;
  measurement_source: string;
  confidence: number;
  has_door: boolean;
  has_window: boolean;
  opening_area_m2: number;
  esquadrias: WallEsquadria[];
  bbox?: [number, number, number, number];
  page_index?: number;
  needs_review?: boolean;
  review_reason?: string;
  // Task #9: origem da altura. "ai" = extraída da própria planta; "corte" =
  // confirmada/sobrescrita por um corte; "default" = fallback do
  // DEFAULT_ASSUMPTIONS.wallHeight. Default em projetos sem corte.
  height_source?: "ai" | "corte" | "default" | "table";
  // Task #9: validação cruzada com cortes. `confirmed_by_section=true` quando
  // o pavimento desta parede tem corte processado. `needs_section_confirmation`
  // marca pavimentos multi-andar sem corte (revisão recomendada).
  confirmed_by_section?: boolean;
  needs_section_confirmation?: boolean;
}

// Task #9: informação extraída de um corte (height por pavimento)
export interface SectionInfo {
  pavimento: string;
  pe_direito_m: number;
  confidence: number;
  page_index: number;
  observacao?: string;
}

export interface ExtractedSlab {
  id: string;
  nivel: string;
  classe: "coberta" | "piso" | "radier";
  area_m2: number;
  measurement_source: string;
  confidence: number;
}

export interface ExtractedCorner {
  id: string;
  nivel: string;
  qtd_cantos: number;
}

export interface TableData {
  paredes_de_tabela: Array<{
    id: string;
    nivel: string;
    classe: string;
    comprimento_m: number;
    altura_m: number;
    espessura_m: number;
  }>;
  esquadrias_de_tabela: Array<{
    codigo: string;
    tipo: string;
    largura_m: number;
    altura_m: number;
    quantidade: number;
  }>;
  areas_de_tabela: Array<{
    nivel: string;
    area_m2: number;
    tipo: string;
  }>;
}

export interface GeometryResult {
  walls: ExtractedWall[];
  slabs: ExtractedSlab[];
  corners: ExtractedCorner[];
}

function getMimeType(filePath: string, fileType?: string): string {
  const ext = filePath.toLowerCase().split(".").pop() || "";
  if (fileType === "pdf" || ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (fileType === "image") {
    if (filePath.toLowerCase().includes(".jpg") || filePath.toLowerCase().includes(".jpeg")) return "image/jpeg";
    if (filePath.toLowerCase().includes(".png")) return "image/png";
    if (filePath.toLowerCase().includes(".webp")) return "image/webp";
    return "image/png";
  }
  return "image/png";
}

function repairJSON(jsonStr: string): any {
  try {
    return JSON.parse(jsonStr);
  } catch {
    console.log("[JSON] Tentando reparar JSON truncado...");
    try {
      let repaired = jsonStr;

      repaired = repaired.replace(/^[^{\[]*/, "");

      repaired = repaired.replace(/[\x00-\x1F\x7F]/g, (ch) => {
        if (ch === "\n" || ch === "\r" || ch === "\t") return ch;
        return "";
      });

      repaired = repaired.replace(/,\s*$/, "");
      repaired = repaired.replace(/,\s*\]/g, "]");
      repaired = repaired.replace(/,\s*\}/g, "}");

      repaired = repaired.replace(/:\s*"([^"]*?)"\s*"[^"]*$/m, ': "$1"');
      repaired = repaired.replace(/:\s*"[^"]*$/m, ': ""');
      repaired = repaired.replace(/,\s*"[^"]*$/m, "");

      const lastComplete = Math.max(repaired.lastIndexOf("}"), repaired.lastIndexOf("]"));
      if (lastComplete > 0) {
        const afterJson = repaired.substring(lastComplete + 1).trim();
        if (afterJson.length > 0 && !afterJson.startsWith("]") && !afterJson.startsWith("}")) {
          repaired = repaired.substring(0, lastComplete + 1);
        }
      }

      const openBraces = (repaired.match(/\{/g) || []).length;
      const closeBraces = (repaired.match(/\}/g) || []).length;
      const openBrackets = (repaired.match(/\[/g) || []).length;
      const closeBrackets = (repaired.match(/\]/g) || []).length;
      for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]";
      for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}";

      repaired = repaired.replace(/,\s*\]/g, "]");
      repaired = repaired.replace(/,\s*\}/g, "}");

      const result = JSON.parse(repaired);
      console.log("[JSON] Reparado com sucesso!");
      return result;
    } catch (e) {
      console.error("[JSON] Falha ao reparar:", e);
      return null;
    }
  }
}

function buildConfig(temperature: number, maxTokens: number, thinkingBudget?: number): any {
  if (thinkingBudget && thinkingBudget > 0) {
    // Modelos com thinking nao aceitam topP, topK nem temperature != 1.0
    return { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget } };
  }
  return { temperature, topP: 0.95, topK: 40, maxOutputTokens: maxTokens };
}

/**
 * Convert Gemini-style multipart contents to a single-prompt + images list
 * suitable for the AIProvider interface (used by OpenAI routing).
 */
function partsToProviderInput(
  parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }>,
): { prompt: string; images: Array<{ base64: string; mimeType: string }> } {
  const images: Array<{ base64: string; mimeType: string }> = [];
  const textChunks: string[] = [];
  for (const p of parts) {
    if (p.inlineData) {
      images.push({ base64: p.inlineData.data, mimeType: p.inlineData.mimeType });
    } else if (p.text) {
      textChunks.push(p.text);
    }
  }
  return { prompt: textChunks.join("\n\n"), images };
}

async function maybeRouteToOpenAI(
  parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }>,
  maxTokens: number,
  temperature: number,
): Promise<string | null> {
  const { getActiveProvider, createOpenAIProvider, hasOpenAIKey } = await import("../ai/provider");
  if (getActiveProvider() !== "openai" || !hasOpenAIKey()) return null;
  const provider = createOpenAIProvider();
  if (!provider) return null;
  const { prompt, images } = partsToProviderInput(parts);
  return provider.generateContent(prompt, images, { temperature, maxOutputTokens: maxTokens });
}

async function callGemini(base64Data: string, mimeType: string, prompt: string, maxTokens: number = 16384, thinkingBudget?: number): Promise<string> {
  const parts = [{ inlineData: { mimeType, data: base64Data } }, { text: prompt }];
  const openaiText = await maybeRouteToOpenAI(parts, maxTokens, 0.1);
  if (openaiText !== null) return openaiText;
  const { withRetry } = await import("./client");
  return withRetry(async () => {
    const response = await activeGenAI.models.generateContent({
      model: activeModelName,
      contents: [{ role: "user", parts }],
      config: buildConfig(0.1, maxTokens, thinkingBudget),
    });
    return response.text ?? "";
  }, "callGemini");
}

// Modelo usado nas chamadas de extracao/classificacao. Promovido de Flash para
// Pro porque o 2.5-Flash erra muito em plantas com cotas pequenas e topologia
// externa/interna. Custo sobe ~5x, latencia ~3-4x — aceito em troca de acuracia.
const EXTRACTION_MODEL = "gemini-2.5-pro";

async function callGeminiExtraction(base64Data: string, mimeType: string, prompt: string, maxTokens: number = 16384, thinkingBudget?: number): Promise<string> {
  const parts = [{ inlineData: { mimeType, data: base64Data } }, { text: prompt }];
  const openaiText = await maybeRouteToOpenAI(parts, maxTokens, 0.1);
  if (openaiText !== null) return openaiText;
  const { withRetry } = await import("./client");
  return withRetry(async () => {
    const response = await activeGenAI.models.generateContent({
      model: EXTRACTION_MODEL,
      contents: [{ role: "user", parts }],
      config: buildConfig(0.1, maxTokens, thinkingBudget),
    });
    return response.text ?? "";
  }, "callGeminiExtraction");
}

async function callGeminiMultiPart(
  parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }>,
  maxTokens: number = 16384,
  temperature: number = 0.1,
  thinkingBudget?: number,
): Promise<string> {
  const openaiText = await maybeRouteToOpenAI(parts, maxTokens, temperature);
  if (openaiText !== null) return openaiText;
  const { withRetry } = await import("./client");
  return withRetry(async () => {
    const response = await activeGenAI.models.generateContent({
      model: activeModelName,
      contents: [{ role: "user", parts }],
      config: buildConfig(temperature, maxTokens, thinkingBudget),
    });
    return response.text ?? "";
  }, "callGeminiMultiPart");
}

async function callGeminiExtractionMultiPart(
  parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }>,
  maxTokens: number = 16384,
  temperature: number = 0.1,
  thinkingBudget?: number,
): Promise<string> {
  const openaiText = await maybeRouteToOpenAI(parts, maxTokens, temperature);
  if (openaiText !== null) return openaiText;
  const { withRetry } = await import("./client");
  return withRetry(async () => {
    const response = await activeGenAI.models.generateContent({
      model: EXTRACTION_MODEL,
      contents: [{ role: "user", parts }],
      config: buildConfig(temperature, maxTokens, thinkingBudget),
    });
    return response.text ?? "";
  }, "callGeminiExtractionMultiPart");
}

const _splitCache = new Map<string, Array<{ pageIndex: number; base64: string }>>();

export function clearSplitCache(): void {
  _splitCache.clear();
}

export async function splitPdfPages(pdfPath: string): Promise<Array<{ pageIndex: number; base64: string }>> {
  const absPath = path.resolve(pdfPath);
  const cached = _splitCache.get(absPath);
  if (cached) {
    console.log(`[PDF] Cache hit — ${cached.length} paginas (${absPath})`);
    return cached;
  }

  const pdfBytes = await fs.readFile(absPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pageCount = pdfDoc.getPageCount();
  const pages: Array<{ pageIndex: number; base64: string }> = [];

  for (let i = 0; i < pageCount; i++) {
    const singleDoc = await PDFDocument.create();
    const [copiedPage] = await singleDoc.copyPages(pdfDoc, [i]);
    singleDoc.addPage(copiedPage);
    const singleBytes = await singleDoc.save();
    pages.push({
      pageIndex: i,
      base64: Buffer.from(singleBytes).toString("base64"),
    });
  }

  console.log(`[PDF] Dividido em ${pageCount} paginas individuais`);
  _splitCache.set(absPath, pages);
  return pages;
}

export async function getFilePages(filePath: string, fileType?: string): Promise<Array<{ pageIndex: number; base64: string; mimeType: string }>> {
  const mimeType = getMimeType(filePath, fileType);

  if (mimeType === "application/pdf") {
    const pages = await splitPdfPages(filePath);
    return pages.map(p => ({ ...p, mimeType: "application/pdf" }));
  }

  const buffer = await fs.readFile(filePath);
  return [{ pageIndex: 0, base64: buffer.toString("base64"), mimeType }];
}

export async function classifyPages(filePath: string, fileType?: string): Promise<PageClassification[]> {
  try {
    const pages = await getFilePages(filePath, fileType);
    const allClassifications: PageClassification[] = [];

    for (const page of pages) {
      const prompt = `Voce e um especialista em projetos arquitetonicos. Analise esta pagina e classifique-a.

PENSE PASSO A PASSO antes de classificar:
1. Que elementos visuais existem nesta pagina? (linhas de parede, cotas, tabelas, texto, corte...)
2. Existe uma vista de cima (planta baixa)? Uma vista lateral (corte/fachada)? Uma tabela?
3. Qual pavimento esta representado?

Classificacoes possiveis:
- "planta_baixa": vista superior ORTOGONAL (2D puro) de um pavimento com paredes, portas, janelas, cotas. SEM perspectiva, SEM profundidade visual, SEM sombras 3D.
- "planta_cobertura": planta da cobertura (vista superior ortogonal)
- "corte": vista transversal/longitudinal mostrando alturas e pavimentos empilhados
- "fachada": vista frontal/lateral do edificio (elevacao)
- "vista_3d": qualquer representacao tridimensional — perspectiva, vista isometrica, axonometrica, render fotorrealistico, modelo 3D, vista aerea com volume. Tem profundidade, sombras, ou angulos nao-ortogonais.
- "tabela_quantitativo": tabela com areas, comprimentos, quantidades
- "quadro_esquadrias": tabela com dimensoes de portas e janelas (P1, J1, etc.)
- "detalhe_construtivo": detalhes ampliados de paredes, lajes ou conexoes
- "irrelevante": capa, indice, memorial descritivo puro, sem desenho tecnico

REGRAS:
- ATENCAO: vistas isometricas/axonometricas mostram paredes "vistas de cima" mas COM PROFUNDIDADE 3D — NUNCA classifique como planta_baixa. Use "vista_3d".
- Planta_baixa e SEMPRE 2D puro, ortogonal, sem perspectiva. Se ve sombras de volume, paredes em angulo, ou cantos com profundidade → e vista_3d, nao planta_baixa.
- So marcar irrelevante se NAO houver NENHUM elemento arquitetonico.
- Se a pagina contiver TANTO um desenho quanto uma tabela, marque como o tipo do desenho E indique has_table=true.
- Cortes mostram andares empilhados com linhas de piso e pe-direito. Fachadas mostram a aparencia externa.

EXEMPLO de resposta:
<RACIOCINIO>
Vejo uma vista de cima com paredes, portas marcadas como P1, P2, janelas como J1, J2, cotas dimensionais em centimetros (464, 350, etc.), nomes de comodos (SALA, QUARTO, BWC). Ha um quadro pequeno no canto com areas. E uma planta baixa do pavimento terreo.
</RACIOCINIO>
{ "pages": [ { "page_index": 0, "classificacao": "planta_baixa", "pavimento": "Terreo", "has_table": true, "has_scale": true } ] }

Responda com seu raciocinio entre <RACIOCINIO> e </RACIOCINIO>, e depois APENAS o JSON:
{ "pages": [ { "page_index": ${page.pageIndex}, "classificacao": "...", "pavimento": "Terreo|Superior|Subsolo|Coberta|Outro", "has_table": boolean, "has_scale": boolean } ] }`;

      const text = await callGemini(page.base64, page.mimeType, prompt, 2048);
      console.log(`[ETAPA1] Pag ${page.pageIndex}: ${text.substring(0, 200)}`);

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = repairJSON(jsonMatch[0]);
        if (parsed?.pages && Array.isArray(parsed.pages)) {
          for (const p of parsed.pages) {
            allClassifications.push({
              page_index: page.pageIndex,
              classificacao: p.classificacao || "planta_baixa",
              pavimento: p.pavimento || "Terreo",
              has_table: !!p.has_table,
              has_scale: !!p.has_scale,
            });
          }
          continue;
        }
      }
      allClassifications.push({
        page_index: page.pageIndex,
        classificacao: "planta_baixa",
        pavimento: "Terreo",
        has_table: false,
        has_scale: false,
      });
    }

    return allClassifications;
  } catch (error) {
    console.error("[ETAPA1] Erro na classificacao:", error);
    return [{ page_index: 0, classificacao: "planta_baixa", pavimento: "Terreo", has_table: false, has_scale: false }];
  }
}

export async function extractTables(filePath: string, fileType?: string): Promise<TableData> {
  try {
    const pages = await getFilePages(filePath, fileType);
    const merged: TableData = { paredes_de_tabela: [], esquadrias_de_tabela: [], areas_de_tabela: [] };

    for (const page of pages) {
      const prompt = `Voce e um especialista em interpretacao de projetos arquitetonicos para orcamento de paineis Lightwall.

TAREFA: Extraia TODOS os dados tabulares e quadros desta pagina.

PENSE PASSO A PASSO:
1. Primeiro, identifique todas as tabelas, quadros e listas presentes na pagina.
2. Para cada tabela, identifique as colunas e linhas.
3. Leia cada celula cuidadosamente, prestando atencao em unidades (cm vs m).
4. Classifique os dados nas 3 categorias abaixo.

EXTRAIR:

1. paredes_de_tabela: Se houver tabela/quadro de paredes ou lista de comprimentos de paredes.
   Lista com: id, nivel (Terreo/Superior), classe (externa/interna), comprimento_m, altura_m, espessura_m
   ATENCAO: Se comprimentos estiverem em centimetros (numeros >10 como 464, 350), DIVIDIR por 100.

2. esquadrias_de_tabela: Se houver quadro de esquadrias (tabela de portas e janelas).
   Lista com: codigo (P1, P2, J1, J2...), tipo (porta/janela), largura_m, altura_m, quantidade
   ATENCAO: Cotas em cm devem ser convertidas para m (ex: 80 = 0.80m, 210 = 2.10m, 120 = 1.20m).

3. areas_de_tabela: Se houver quadro de areas dos comodos ou resumo de areas.
   Lista com: nivel (Terreo/Superior), area_m2, tipo (comodo/area_total/area_coberta)
   INCLUIR: areas de comodos individuais (SALA, QUARTO, BWC, etc.) E area total do pavimento.

EXEMPLO de extracao de esquadrias:
Quadro de esquadrias mostrando: P1 80x210cm qtd 5 → extrair como:
{ "codigo": "P1", "tipo": "porta", "largura_m": 0.80, "altura_m": 2.10, "quantidade": 5 }

EXEMPLO de extracao de areas:
Quadro de areas mostrando: SALA 15.57m², QUARTO 12.30m² → extrair como:
[{ "nivel": "Terreo", "area_m2": 15.57, "tipo": "comodo" }, { "nivel": "Terreo", "area_m2": 12.30, "tipo": "comodo" }]

Mesmo que nao exista uma tabela formal, se houver areas escritas ao lado dos nomes dos comodos (ex: "SALA 15.57 m²"), extraia como areas_de_tabela.

Se nao houver nenhum dado tabular nesta pagina, retorne arrays vazios.

Responda com seu raciocinio entre <RACIOCINIO> e </RACIOCINIO>, e depois APENAS o JSON:
{
  "paredes_de_tabela": [],
  "esquadrias_de_tabela": [],
  "areas_de_tabela": []
}`;

      const text = await callGemini(page.base64, page.mimeType, prompt);
      console.log(`[ETAPA2] Pag ${page.pageIndex}: ${text.substring(0, 300)}`);

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = repairJSON(jsonMatch[0]);
        if (parsed) {
          if (Array.isArray(parsed.paredes_de_tabela)) merged.paredes_de_tabela.push(...parsed.paredes_de_tabela);
          if (Array.isArray(parsed.esquadrias_de_tabela)) merged.esquadrias_de_tabela.push(...parsed.esquadrias_de_tabela);
          if (Array.isArray(parsed.areas_de_tabela)) merged.areas_de_tabela.push(...parsed.areas_de_tabela);
        }
      }
    }

    return merged;
  } catch (error) {
    console.error("[ETAPA2] Erro na extracao de tabelas:", error);
    return { paredes_de_tabela: [], esquadrias_de_tabela: [], areas_de_tabela: [] };
  }
}

export interface ClassifyAndExtractResult {
  classifications: PageClassification[];
  tableData: TableData;
  failedPages: number[];
  detectedBuildingType?: string;
}

async function processPageClassifyAndTables(
  page: { pageIndex: number; base64: string; mimeType: string },
  skipBuildingTypeDetection: boolean = false,
): Promise<{ classification: PageClassification; tableData: TableData; detectedBuildingType?: string }> {
  const { BUILDING_TYPE_DETECTION_PROMPT } = await import("./buildingTypePrompts");
  const prompt = `Voce e um especialista em projetos arquitetonicos. Analise esta pagina e faca DUAS tarefas em uma unica resposta:

TAREFA 1 - CLASSIFICACAO:
PENSE PASSO A PASSO antes de classificar:
1. Que elementos visuais existem nesta pagina? (linhas de parede, cotas, tabelas, texto, corte...)
2. Existe uma vista de cima (planta baixa)? Uma vista lateral (corte/fachada)? Uma tabela?
3. Qual pavimento esta representado?

Classificacoes possiveis:
- "planta_baixa": vista superior ORTOGONAL (2D puro) de um pavimento com paredes, portas, janelas, cotas. SEM perspectiva, SEM profundidade visual, SEM sombras 3D.
- "planta_cobertura": planta da cobertura (vista superior ortogonal)
- "corte": vista transversal/longitudinal mostrando alturas e pavimentos empilhados
- "fachada": vista frontal/lateral do edificio (elevacao)
- "vista_3d": qualquer representacao tridimensional — perspectiva, vista isometrica, axonometrica, render fotorrealistico, modelo 3D, vista aerea com volume. Tem profundidade, sombras, ou angulos nao-ortogonais.
- "tabela_quantitativo": tabela com areas, comprimentos, quantidades
- "quadro_esquadrias": tabela com dimensoes de portas e janelas (P1, J1, etc.)
- "detalhe_construtivo": detalhes ampliados de paredes, lajes ou conexoes
- "irrelevante": capa, indice, memorial descritivo puro, sem desenho tecnico

REGRAS DE CLASSIFICACAO:
- ATENCAO: vistas isometricas/axonometricas mostram paredes "vistas de cima" mas COM PROFUNDIDADE 3D — NUNCA classifique como planta_baixa. Use "vista_3d".
- Planta_baixa e SEMPRE 2D puro, ortogonal, sem perspectiva. Se ve sombras de volume, paredes em angulo, ou cantos com profundidade → e vista_3d, nao planta_baixa.
- So marcar irrelevante se NAO houver NENHUM elemento arquitetonico.
- Se a pagina contiver TANTO um desenho quanto uma tabela, marque como o tipo do desenho E indique has_table=true.
- Cortes mostram andares empilhados com linhas de piso e pe-direito. Fachadas mostram a aparencia externa.

TAREFA 2 - EXTRACAO DE TABELAS:
Se houver QUALQUER dado tabular, quadro de areas, quadro de esquadrias ou lista de comprimentos, extraia-os:

1. paredes_de_tabela: tabela/quadro de paredes com: id, nivel (Terreo/Superior), classe (externa/interna), comprimento_m, altura_m, espessura_m
   ATENCAO: Se comprimentos >10 (como 464, 350), DIVIDIR por 100 para converter cm → m.

2. esquadrias_de_tabela: quadro de esquadrias com: codigo (P1, P2, J1, J2...), tipo (porta/janela), largura_m, altura_m, quantidade
   ATENCAO: Cotas em cm devem ser convertidas para m (80 = 0.80m, 210 = 2.10m).

3. areas_de_tabela: quadro de areas com: nivel (Terreo/Superior), area_m2, tipo (comodo/area_total/area_coberta)
   Mesmo areas escritas ao lado dos nomes dos comodos (ex: "SALA 15.57 m²"), extraia.

Se nao houver dados tabulares, retorne arrays vazios para as 3 categorias.

${skipBuildingTypeDetection ? "" : `TAREFA 3 - DETECCAO DO TIPO DE EDIFICACAO:
${BUILDING_TYPE_DETECTION_PROMPT}`}

Responda com seu raciocinio entre <RACIOCINIO> e </RACIOCINIO>, e depois APENAS o JSON:
{
  "classificacao": { "page_index": ${page.pageIndex}, "classificacao": "...", "pavimento": "Terreo|Superior|Subsolo|Coberta|Outro", "has_table": boolean, "has_scale": boolean },
  "tabelas": { "paredes_de_tabela": [], "esquadrias_de_tabela": [], "areas_de_tabela": [] }${skipBuildingTypeDetection ? "" : `,
  "tipo_edificacao": "residencial|comercial|institucional|industrial|outro"`}
}`;

  const text = await callGeminiExtraction(page.base64, page.mimeType, prompt, 8192, 4096);
  console.log(`[ETAPA1+2] Pag ${page.pageIndex}: ${text.substring(0, 300)}`);

  let parsed = tryParseResponse(text);

  if (!parsed) {
    console.log(`[ETAPA1+2] Pag ${page.pageIndex}: JSON parse falhou, tentando retry com prompt simplificado...`);
    const { recordJsonParseRetry } = await import("./client");
    recordJsonParseRetry();
    const retryPrompt = `Analise esta pagina de projeto arquitetonico. Responda SOMENTE com JSON valido, SEM texto antes ou depois:
{"classificacao":{"page_index":${page.pageIndex},"classificacao":"planta_baixa|planta_cobertura|corte|fachada|vista_3d|tabela_quantitativo|quadro_esquadrias|detalhe_construtivo|irrelevante","pavimento":"Terreo|Superior|Subsolo|Coberta","has_table":false,"has_scale":false},"tabelas":{"paredes_de_tabela":[],"esquadrias_de_tabela":[],"areas_de_tabela":[]}}`;
    const retryText = await callGeminiExtraction(page.base64, page.mimeType, retryPrompt, 4096, 4096);
    console.log(`[ETAPA1+2] Pag ${page.pageIndex} retry: ${retryText.substring(0, 300)}`);
    parsed = tryParseResponse(retryText);

    if (!parsed) {
      console.error(`[ETAPA1+2] Pag ${page.pageIndex}: JSON parse falhou mesmo apos retry simplificado`);
      throw new Error(`JSON parse failed for page ${page.pageIndex} after retry`);
    }
  }

  const classification: PageClassification = parsed.classificacao
    ? {
        page_index: page.pageIndex,
        classificacao: parsed.classificacao.classificacao || "planta_baixa",
        pavimento: parsed.classificacao.pavimento || "Terreo",
        has_table: !!parsed.classificacao.has_table,
        has_scale: !!parsed.classificacao.has_scale,
      }
    : {
        page_index: page.pageIndex,
        classificacao: "planta_baixa",
        pavimento: "Terreo",
        has_table: false,
        has_scale: false,
      };

  const tableData: TableData = { paredes_de_tabela: [], esquadrias_de_tabela: [], areas_de_tabela: [] };
  if (parsed.tabelas) {
    if (Array.isArray(parsed.tabelas.paredes_de_tabela)) tableData.paredes_de_tabela = parsed.tabelas.paredes_de_tabela;
    if (Array.isArray(parsed.tabelas.esquadrias_de_tabela)) tableData.esquadrias_de_tabela = parsed.tabelas.esquadrias_de_tabela;
    if (Array.isArray(parsed.tabelas.areas_de_tabela)) tableData.areas_de_tabela = parsed.tabelas.areas_de_tabela;
  }

  const detectedBuildingType = parsed.tipo_edificacao || undefined;

  return { classification, tableData, detectedBuildingType };
}

function tryParseResponse(text: string): any | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return repairJSON(jsonMatch[0]);
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  if (tasks.length === 0) return [];
  const effectiveConcurrency = Math.max(1, Math.min(concurrency, tasks.length));
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const currentIndex = index++;
      try {
        const value = await tasks[currentIndex]();
        results[currentIndex] = { status: "fulfilled", value };
      } catch (reason: any) {
        results[currentIndex] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from({ length: effectiveConcurrency }, () => runNext());
  await Promise.all(workers);
  return results;
}

export async function classifyAndExtractTables(
  filePath: string,
  fileType?: string,
  concurrency: number = 2,
  skipBuildingTypeDetection: boolean = false,
): Promise<ClassifyAndExtractResult> {
  const pages = await getFilePages(filePath, fileType);
  const failedPages: number[] = [];
  const allClassifications: PageClassification[] = [];
  const mergedTableData: TableData = { paredes_de_tabela: [], esquadrias_de_tabela: [], areas_de_tabela: [] };

  const tasks = pages.map((page) => () => processPageClassifyAndTables(page, skipBuildingTypeDetection));
  const results = await runWithConcurrency(tasks, concurrency);

  const buildingTypeVotes: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      allClassifications.push(r.value.classification);
      mergedTableData.paredes_de_tabela.push(...r.value.tableData.paredes_de_tabela);
      mergedTableData.esquadrias_de_tabela.push(...r.value.tableData.esquadrias_de_tabela);
      mergedTableData.areas_de_tabela.push(...r.value.tableData.areas_de_tabela);
      if (r.value.detectedBuildingType) {
        buildingTypeVotes.push(r.value.detectedBuildingType);
      }
    } else {
      console.error(`[ETAPA1+2] Pag ${pages[i].pageIndex} falhou:`, r.reason);
      failedPages.push(pages[i].pageIndex);
      allClassifications.push({
        page_index: pages[i].pageIndex,
        classificacao: "planta_baixa",
        pavimento: "Terreo",
        has_table: false,
        has_scale: false,
      });
    }
  }

  let detectedBuildingType: string | undefined;
  if (buildingTypeVotes.length > 0) {
    const counts = new Map<string, number>();
    for (const vote of buildingTypeVotes) {
      counts.set(vote, (counts.get(vote) || 0) + 1);
    }
    let maxCount = 0;
    for (const [type, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        detectedBuildingType = type;
      }
    }
    console.log(`[ETAPA1] Tipo edificacao detectado: ${detectedBuildingType} (votos: ${JSON.stringify(Object.fromEntries(counts))})`);
  }

  return { classifications: allClassifications, tableData: mergedTableData, failedPages, detectedBuildingType };
}

export async function extractGeometryParallel(
  filePath: string,
  fileType?: string,
  classifications?: PageClassification[],
  concurrency: number = 2,
  buildingType?: string,
  peDireito: number = 3.0,
): Promise<GeometryResult & { failedPages: number[] }> {
  try {
    const pages = await getFilePages(filePath, fileType);
    const classMap = new Map<number, PageClassification>();
    if (classifications) {
      for (const c of classifications) classMap.set(c.page_index, c);
    }

    const plantaPages = pages.filter((page) => {
      const cls = classMap.get(page.pageIndex);
      if (!cls) return true;
      return cls.classificacao === "planta_baixa" || cls.classificacao === "planta_cobertura";
    });

    const cortePages = pages.filter((page) => {
      const cls = classMap.get(page.pageIndex);
      return cls?.classificacao === "corte" || cls?.classificacao === "fachada";
    });

    if (plantaPages.length === 0 && pages.length > 0) {
      // Fallback restrito: NUNCA usar vista_3d, corte, fachada, detalhe ou tabela como
      // planta — extracao de paredes a partir de vistas 3D/perspectiva causa duplicacao.
      const onlyPlantaCandidates = pages.filter((page) => {
        const cls = classMap.get(page.pageIndex);
        if (!cls) return true;
        return cls.classificacao !== "irrelevante" &&
               cls.classificacao !== "vista_3d" &&
               cls.classificacao !== "corte" &&
               cls.classificacao !== "fachada" &&
               cls.classificacao !== "tabela_quantitativo" &&
               cls.classificacao !== "quadro_esquadrias" &&
               cls.classificacao !== "detalhe_construtivo";
      });
      if (onlyPlantaCandidates.length > 0) {
        console.log(`[ETAPA3] Fallback restrito: ${onlyPlantaCandidates.length} pagina(s) sem classificacao explicita usadas como planta (3D/cortes/fachadas/detalhes excluidos)`);
        plantaPages.push(...onlyPlantaCandidates);
      }
    }

    if (plantaPages.length === 0) {
      return { walls: [], slabs: [], corners: [], failedPages: [] };
    }

    // Group pages by pavimento for per-floor extraction
    const floorGroups = new Map<string, typeof plantaPages>();
    for (const page of plantaPages) {
      const cls = classMap.get(page.pageIndex);
      const pav = cls?.pavimento || "Terreo";
      if (!floorGroups.has(pav)) floorGroups.set(pav, []);
      floorGroups.get(pav)!.push(page);
    }

    // Corte/fachada context parts (shared across floors, max 2)
    const corteParts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];
    for (const page of cortePages.slice(0, 2)) {
      corteParts.push({ text: `--- CORTE/FACHADA: Pagina ${page.pageIndex + 1} (use para conferir pe-direito) ---` });
      corteParts.push({ inlineData: { mimeType: page.mimeType, data: page.base64 } });
    }

    const allWalls: ExtractedWall[] = [];
    const allSlabs: ExtractedSlab[] = [];
    const allCorners: ExtractedCorner[] = [];
    const failedPages: number[] = [];

    const { getActiveProvider: _gapEtapa3 } = await import("../ai/provider");
    const _providerLabelEtapa3 = _gapEtapa3() === "openai" ? "OpenAI" : "Gemini Pro";
    console.log(`[ETAPA3] Extraindo ${floorGroups.size} pavimento(s) em PARALELO com ${_providerLabelEtapa3} (${plantaPages.length} paginas + ${cortePages.slice(0, 2).length} cortes)`);

    // Extract all floors in parallel using Flash for speed
    const floorEntries = Array.from(floorGroups.entries());
    const floorResults = await Promise.all(floorEntries.map(async ([pav, floorPages]) => {
      try {
        const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];

        for (const page of floorPages) {
          parts.push({ text: `--- PLANTA BAIXA: Pagina ${page.pageIndex + 1}, Pavimento ${pav} ---` });
          parts.push({ inlineData: { mimeType: page.mimeType, data: page.base64 } });
        }

        // Include corte/fachada for height context
        parts.push(...corteParts);

        const prompt = buildGeometryPrompt([pav], buildingType, peDireito);
        parts.push({ text: prompt });

        console.log(`[ETAPA3] Pavimento "${pav}": ${floorPages.length} pagina(s) via ${_providerLabelEtapa3}`);
        const text = await callGeminiExtractionMultiPart(parts, 16384, 0.1, 8192);
        console.log(`[ETAPA3] "${pav}" resposta: ${text.substring(0, 400)}`);

        const result = parseGeometryResponse(text, pav);
        for (const w of result.walls) {
          if (w.page_index === undefined) w.page_index = floorPages[0]?.pageIndex ?? 0;
        }

        // Quick per-floor verification with Flash
        let verified = result;
        try {
          const verifiedResult = await verifyFloorExtraction(floorPages, corteParts, result, pav, buildingType);
          if (verifiedResult) verified = verifiedResult;
        } catch (vErr: any) {
          console.warn(`[ETAPA3] Verificacao pav "${pav}" falhou: ${vErr.message}`);
        }

        console.log(`[ETAPA3] "${pav}": ${verified.walls.length} paredes, ${verified.slabs.length} lajes, ${verified.corners.length} cantos`);
        return {
          walls: verified.walls,
          slabs: verified.slabs,
          corners: verified.corners,
          failedPages: [] as number[],
        };
      } catch (floorErr: any) {
        console.error(`[ETAPA3] Erro no pav "${pav}": ${floorErr.message}`);
        return {
          walls: [] as ExtractedWall[],
          slabs: [] as ExtractedSlab[],
          corners: [] as ExtractedCorner[],
          failedPages: floorPages.map(p => p.pageIndex),
        };
      }
    }));

    for (const fr of floorResults) {
      allWalls.push(...fr.walls);
      allSlabs.push(...fr.slabs);
      allCorners.push(...fr.corners);
      failedPages.push(...fr.failedPages);
    }

    // Fallback: if 0 walls after per-floor, try raw full file
    if (allWalls.length === 0 && pages.length > 0) {
      console.log("[ETAPA3] 0 paredes apos extracao por pavimento, tentando documento completo raw...");
      const buffer = await fs.readFile(filePath);
      const base64 = buffer.toString("base64");
      const mimeType = getMimeType(filePath, fileType);
      const allPavs = Array.from(floorGroups.keys());
      const fallbackPrompt = buildGeometryPrompt(allPavs.length > 0 ? allPavs : ["Terreo"], buildingType, peDireito);
      const fallbackText = await callGeminiExtraction(base64, mimeType, fallbackPrompt, 16384, 8192);
      const fallbackResult = parseGeometryResponse(fallbackText, "Terreo");
      for (const w of fallbackResult.walls) {
        if (w.page_index === undefined) w.page_index = 0;
      }
      return { walls: fallbackResult.walls, slabs: fallbackResult.slabs, corners: fallbackResult.corners, failedPages: [] };
    }

    return { walls: allWalls, slabs: allSlabs, corners: allCorners, failedPages };
  } catch (error) {
    console.error("[ETAPA3] Erro global na extracao geometrica:", error);
    return { walls: [], slabs: [], corners: [], failedPages: [-1] };
  }
}

export async function extractGeometry(filePath: string, fileType?: string, classifications?: PageClassification[]): Promise<GeometryResult> {
  // Delegate to the parallel version which now sends all pages together
  const result = await extractGeometryParallel(filePath, fileType, classifications, 2);
  return { walls: result.walls, slabs: result.slabs, corners: result.corners };
}

/**
 * Per-floor verification: checks extraction quality and attempts correction.
 * Runs immediately after each floor is extracted (before fusion).
 * Returns corrected result or null if no corrections needed/possible.
 */
async function verifyFloorExtraction(
  floorPages: Array<{ pageIndex: number; base64: string; mimeType: string }>,
  corteParts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }>,
  geometry: GeometryResult,
  pavimento: string,
  buildingType?: string,
): Promise<GeometryResult | null> {
  if (geometry.walls.length === 0) return null;

  const extCount = geometry.walls.filter(w => w.classe === "externa").length;
  const intCount = geometry.walls.filter(w => w.classe === "interna").length;
  const totalEsq = geometry.walls.reduce((sum, w) => sum + (w.esquadrias?.length || 0), 0);

  const btConfig = getBuildingTypeConfig(buildingType);

  const wallsList = geometry.walls.map(w =>
    `${w.id}: ${w.classe}, ${w.comprimento_m}m x ${w.altura_m}m, esquadrias=[${w.esquadrias.map(e => `${e.codigo}(${e.tipo} ${e.largura_m}x${e.altura_m})`).join(", ")}]`
  ).join("\n");
  const slabsList = geometry.slabs.map(s => `${s.id}: ${s.classe}, ${s.area_m2}m²`).join("\n");

  const muroCount = geometry.walls.filter(w => w.classe === "muro").length;

  const prompt = `Voce e um revisor tecnico de plantas arquitetonicas. Verifique a extracao abaixo comparando com a imagem.

${btConfig.verificationHints}

Pavimento: ${pavimento} | ${geometry.walls.length} paredes (${extCount} ext, ${intCount} int, ${muroCount} muros) | ${totalEsq} esquadrias

PAREDES:
${wallsList}

LAJES:
${slabsList || "Nenhuma"}

=== REGRAS DE CLASSIFICACAO (use para verificar) ===
- MURO: limite do TERRENO/LOTE, linhas mais externas, FORA da area construida, sem janelas.
- EXTERNA: envoltoria da CASA, uma face toca exterior (jardim/rua), outra toca ambiente interno.
- INTERNA: divisoria DENTRO da casa, ambas as faces tocam comodos internos.

REGRA TOPOLOGICA: NUNCA existe parede "interna" FORA do poligono das externas.
"Parede dentro de parede" e impossivel — interna esta DENTRO do contorno externo.

VERIFICACAO:
1. CLASSIFICACAO: ${intCount === 0 ? "*** CRITICO: 0 INTERNAS! Paredes que dividem comodos DENTRO da casa devem ser 'interna', nao 'externa'. ***" : ""} ${extCount === 0 ? "*** CRITICO: 0 EXTERNAS! O contorno da casa deve ser 'externa'. ***" : ""}
   - Trace o poligono fechado da casa. Cada parede no contorno = externa; cada parede DENTRO = interna.
   - Se uma "externa" tem ambientes fechados dos dois lados → reclassifique como "interna".
   - Se uma "interna" toca jardim/rua/exterior em um lado → reclassifique como "externa".
   - Se uma "interna" esta FORA do poligono externo → e impossivel; reclassifique ou remova.
   - Muros estao FORA da projecao da casa? Se um "muro" faz parte do contorno da edificacao coberta → "externa".
2. PAREDES FALTANTES? Ha paredes visiveis na imagem nao extraidas?
3. ESQUADRIAS: ${totalEsq === 0 ? "*** 0 ESQUADRIAS! Procure arcos (portas) e tracos paralelos (janelas). ***" : `${totalEsq} encontradas — faltam?`}
4. COMPRIMENTOS: Use as COTAS visiveis na planta (numeros com setas) para validar cada parede. Se a cota mostra 4.64m e voce extraiu 6.20m, corrija.
5. CONTEXTO HOLISTICO: Olhe a edificacao como um todo. O numero de externas faz sentido para uma casa desse tamanho? Externas devem fechar um poligono continuo, sem "buracos" no contorno.

Se TUDO correto: responda "APROVADO"
Se houver correcoes: retorne o JSON COMPLETO corrigido { "walls": [...], "slabs": [...], "corners": [...] }`;

  const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];
  for (const page of floorPages) {
    parts.push({ inlineData: { mimeType: page.mimeType, data: page.base64 } });
  }
  parts.push(...corteParts);
  parts.push({ text: prompt });

  // Try verification, retry once on JSON parse failure
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callGeminiExtractionMultiPart(parts, 16384, 0.1, 8192);

      if (text.includes("APROVADO")) {
        console.log(`[VERIFY] Pav "${pavimento}": APROVADO (tentativa ${attempt + 1})`);
        return null;
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`[VERIFY] Pav "${pavimento}": sem JSON na correcao (tentativa ${attempt + 1})`);
        if (attempt === 0) continue; // retry
        return null;
      }

      const corrected = repairJSON(jsonMatch[0]);
      if (!corrected) {
        console.warn(`[VERIFY] Pav "${pavimento}": JSON invalido na correcao (tentativa ${attempt + 1})`);
        if (attempt === 0) continue;
        return null;
      }

      const result = parseGeometryJSON(corrected, text, pavimento);
      if (result.walls.length === 0 && geometry.walls.length > 0) {
        console.warn(`[VERIFY] Pav "${pavimento}": correcao retornou 0 paredes, mantendo original`);
        return null;
      }

      const diff = result.walls.length - geometry.walls.length;
      console.log(`[VERIFY] Pav "${pavimento}": corrigido ${geometry.walls.length} → ${result.walls.length} paredes (${diff > 0 ? "+" : ""}${diff})`);
      return result;
    } catch (err: any) {
      console.warn(`[VERIFY] Pav "${pavimento}" tentativa ${attempt + 1} erro: ${err.message}`);
      if (attempt === 0) continue;
    }
  }
  return null;
}

function buildGeometryPrompt(pavimentos: string[], buildingType?: string, peDireito: number = 3.0): string {
  const btConfig = getBuildingTypeConfig(buildingType);
  const pavStr = pavimentos.join(", ");
  const isSingle = pavimentos.length === 1;
  const nivelRef = isSingle ? pavimentos[0] : pavStr;

  return `Voce e um engenheiro orcamentista experiente. Analise ${isSingle ? "esta planta baixa" : "estas plantas baixas"} (${nivelRef}) e extraia TODOS os elementos construtivos para orcamento de paineis Lightwall.

=== PRE-TRATAMENTO (IGNORAR ELEMENTOS NAO-ESTRUTURAIS) ===
IGNORE COMPLETAMENTE os seguintes elementos do desenho — eles NAO sao paredes nem elementos construtivos:
- Mobilia e equipamentos: camas, mesas, cadeiras, sofas, fogao, geladeira, pias, vasos sanitarios, chuveiros, armarios, bancadas
- Vegetacao: arvores, arbustos, jardins, grama
- Carros e veiculos estacionados
- Hachuras decorativas internas (piso, revestimento)
- Textos de area (ex: "A=12,50m2"), setas de norte, logos, carimbos
- Cotas de nivel (ex: "+0.15", "-0.30")
- Linhas de projecao pontilhadas (beiral, telhado acima)
Concentre-se APENAS em: paredes (linhas solidas continuas), portas (arcos), janelas (tracos paralelos), cotas dimensionais (numeros com setas), e limites de laje.

${btConfig.fewShotContext}

=== DEFINICOES DE CLASSIFICACAO (OBRIGATORIO SEGUIR) ===

MURO (classe "muro"):
- Vedacao perimetral que delimita o TERRENO/LOTE, NAO a casa.
- Sao as linhas MAIS EXTERNAS de todo o desenho, fora da projecao da edificacao.
- Nao possui janelas nem portas complexas (pode ter portao).
- Fica FORA da area de piso/hachura interna.
- IDs: M1, M2, M3...

PAREDE EXTERNA (classe "externa"):
- Envoltoria da edificacao: separa o INTERIOR da casa do EXTERIOR (jardim/rua/garagem aberta/varanda aberta).
- Forma o contorno fechado (poligono) da area construida coberta.
- Criterio: uma face toca area EXTERNA (jardim, fundo, calcada) e a outra face toca um AMBIENTE INTERNO (sala, quarto, etc).
- Concentra a maioria das janelas e portas de entrada/saida.
- IDs: P1, P2, P3...

PAREDE INTERNA (classe "interna"):
- Divisoria entre ambientes INTERNOS da casa.
- Criterio: AMBAS as faces tocam comodos internos (sala/quarto, quarto/banheiro, etc).
- Esta CONTIDA dentro do poligono formado pelas paredes externas.
- Possui portas internas entre comodos.
- IDs: P seguindo a sequencia apos externas.

=== REGRA TOPOLOGICA ABSOLUTA (NAO VIOLAR) ===
NUNCA pode existir uma parede "interna" FORA do poligono das paredes externas.
Se voce esta prestes a marcar uma parede como "interna" mas ela esta no contorno
da edificacao (uma face para o jardim/rua), ela e EXTERNA, nao interna.
Se voce esta prestes a marcar uma parede como "externa" mas ela tem comodos
fechados dos DOIS lados, ela e INTERNA, nao externa.
"Parede dentro de parede" NAO existe — interna esta dentro do poligono externo.
Antes de classificar qualquer parede:
  1) Trace mentalmente o poligono fechado da casa (Etapa 3).
  2) Para cada parede candidata, pergunte: "Esta parede pertence a esse poligono
     (no contorno) ou esta dentro dele?". Contorno = externa. Dentro = interna.

LAJE DE PISO (classe "piso" ou "radier"):
- Area horizontal na base dos comodos = soma das areas internas fechadas por paredes.
- Terreo = "radier" (fundacao), pavimentos superiores = "piso".

LAJE DE COBERTA (classe "coberta"):
- Projecao TOTAL da edificacao vista de cima (area de todas as paredes externas + internas + beirais se visiveis).
- Apenas no ULTIMO pavimento ou pavimento unico. Telhado de telha NAO e laje.

=== ETAPAS DE EXTRACAO (siga na ordem) ===

ETAPA 1 — IDENTIFICAR COMODOS:
Liste todos os comodos visiveis (nome e area aprox.): salas, quartos, banheiros, cozinha, lavanderia, corredor, hall, garagem, area de servico, varanda, etc.

ETAPA 2 — IDENTIFICAR MUROS (limite do lote):
Procure linhas nas BORDAS EXTREMAS do desenho, fora da casa. Se existirem, sao muros.
Se nao houver linhas de muro visiveis, pule — nao invente muros.

ETAPA 3 — TRACAR O POLIGONO DA ENVOLTORIA (paredes externas):
PRIMEIRO trace o contorno fechado da area construida coberta — siga visualmente as
linhas mais externas das paredes da casa (NAO o muro do lote). Esse contorno deve
ser um POLIGONO FECHADO contínuo. Cada segmento desse poligono e uma PAREDE EXTERNA.
- Uma face toca o exterior (jardim, rua, garagem aberta).
- A outra face toca um ambiente interno.
- Se voce nao consegue fechar o poligono, voce esta perdendo paredes externas.

ETAPA 4 — LISTAR PAREDES INTERNAS (divisorias):
Todas as paredes DENTRO do poligono da Etapa 3 que separam comodos internos.
- AMBOS os lados tocam ambientes (sem face para o exterior).
- Se uma parede separa dois comodos, liste-a apenas UMA vez.
- *** REGRA ABSOLUTA: nenhuma "interna" pode estar FORA do poligono externo. Se
    estiver fora, ou voce errou a classificacao (e externa) ou ela nao existe. ***

ETAPA 5 — COTAS E DIMENSOES (USAR SEMPRE QUE DISPONIVEIS):
Para CADA parede (muro, externa, interna), leia a cota (dimensao) mais proxima:
- Cotas sao numeros com setas/tracos perpendiculares indicando o comprimento real.
- PRIORIDADE: se houver cota visivel para uma parede, USE-A. Nao estime visualmente.
- Numeros > 10 (ex: 464, 350) estao em cm → divida por 100.
- Numeros < 20 (ex: 4.64) ja estao em metros.
- Cadeia de cotas: somar cotas parciais ao longo de uma face deve bater com a
  cota total dessa face. Use isso para validar.

ETAPA 6 — ESQUADRIAS:
Para CADA parede, verifique portas (arcos no desenho) e janelas (tracos paralelos):
- Leia codigos (P1, J1...) e dimensoes.
- Padroes se nao encontrar: porta=0.80x2.10m, janela=1.20x1.00m.
- opening_area_m2 = soma(largura × altura) de cada esquadria na parede.

ETAPA 7 — LAJES:
- Piso: some as areas de todos os comodos internos. Terreo="radier", demais="piso".
- Coberta: projecao total da edificacao (somente no ultimo pavimento).

ETAPA 8 — CANTOS E PE-DIREITO:
- Conte cantos de 90° no contorno externo (Etapa 3).
- Pe-direito PADRAO definido pelo usuario: ${peDireito}m. Use este valor para TODAS as paredes, a menos que o corte/fachada mostre valor diferente.

Escreva seu raciocinio (Etapas 1-8) entre <RACIOCINIO>...</RACIOCINIO>, depois retorne APENAS o JSON:

{
  "walls": [
    {"id": "P1", "nivel": "${pavimentos[0]}", "classe": "externa|interna|muro", "comprimento_m": 8.50, "altura_m": ${peDireito}, "espessura_m": 0.10, "measurement_source": "dimension_text|inferred_from_symbol", "confidence": 0.9, "has_door": true, "has_window": false, "opening_area_m2": 1.68, "esquadrias": [{"tipo": "porta", "codigo": "P1", "largura_m": 0.80, "altura_m": 2.10, "measurement_source": "dimension_text"}], "box_2d": [ymin, xmin, ymax, xmax]}
  ],
  "slabs": [
    {"id": "L1", "nivel": "${pavimentos[0]}", "classe": "radier|piso|coberta", "area_m2": 85.0, "measurement_source": "dimension_text", "confidence": 0.9}
  ],
  "corners": [
    {"id": "C1", "nivel": "${pavimentos[0]}", "qtd_cantos": 8}
  ]
}

box_2d: coordenadas normalizadas 0-1000 [ymin, xmin, ymax, xmax].
IDs: M1,M2... para muros, P1,P2... para externas e internas (sequencial).
NAO omita nenhuma parede — cada segmento e importante para o orcamento.`;
}

function parseGeometryResponse(text: string, defaultNivel: string): GeometryResult {
  const reasoningMatch = text.match(/<RACIOCINIO>([\s\S]*?)<\/RACIOCINIO>/);
  if (reasoningMatch) {
    console.log(`[ETAPA3] Raciocinio da IA: ${reasoningMatch[1].substring(0, 300)}...`);
  }

  const textAfterReasoning = reasoningMatch
    ? text.substring(text.indexOf("</RACIOCINIO>") + "</RACIOCINIO>".length)
    : text;

  const jsonMatch = textAfterReasoning.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    const jsonMatchFull = text.match(/\{[\s\S]*\}/);
    if (!jsonMatchFull) {
      console.error("[ETAPA3] Sem JSON valido");
      return { walls: [], slabs: [], corners: [] };
    }
    return parseGeometryJSON(repairJSON(jsonMatchFull[0]), text, defaultNivel);
  }

  const parsed = repairJSON(jsonMatch[0]);
  return parseGeometryJSON(parsed, text, defaultNivel);
}

function parseGeometryJSON(parsed: any, rawText: string, defaultNivel: string): GeometryResult {
  if (!parsed) {
    const wallMatches = [...rawText.matchAll(/"comprimento_m"\s*:\s*([\d.]+)[\s\S]*?"altura_m"\s*:\s*([\d.]+)[\s\S]*?"classe"\s*:\s*"(externa|interna)"/g)];
    const walls: ExtractedWall[] = wallMatches.map((m, i) => ({
      id: `P${i + 1}`, nivel: defaultNivel, classe: m[3] as "externa" | "interna",
      comprimento_m: parseFloat(m[1]), altura_m: parseFloat(m[2]), espessura_m: 0.10,
      measurement_source: "regex_recovery", confidence: 0.5,
      has_door: false, has_window: false, opening_area_m2: 0, esquadrias: [],
    }));
    console.log(`[ETAPA3] Recuperados ${walls.length} paredes via regex`);
    return { walls, slabs: [], corners: [] };
  }

  const toNum = (v: any, fallback = 0): number => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v.replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  };
  const toNumOrFirst = (...vals: any[]): number => {
    for (const v of vals) {
      const n = toNum(v, NaN);
      if (Number.isFinite(n) && n !== 0) return n;
    }
    return 0;
  };

  const walls: ExtractedWall[] = (parsed.walls || []).map((w: any, i: number) => {
    const rawBox = w.box_2d || w.bbox || w.boundingBox || null;
    let bbox: [number, number, number, number] | undefined;
    if (Array.isArray(rawBox) && rawBox.length === 4 && rawBox.every((n: any) => typeof n === "number" && isFinite(n))) {
      let [ymin, xmin, ymax, xmax] = rawBox as number[];
      if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
      if (xmin > xmax) [xmin, xmax] = [xmax, xmin];
      bbox = [ymin, xmin, ymax, xmax];
    }
    return {
      id: w.id || `P${i + 1}`,
      nivel: w.nivel || defaultNivel,
      classe: (w.classe === "muro" ? "muro" : (w.classe === "interna" ? "interna" : "externa")) as "externa" | "interna" | "muro",
      comprimento_m: toNumOrFirst(w.comprimento_m, w.length),
      altura_m: toNumOrFirst(w.altura_m, w.height) || 3.0,
      espessura_m: toNum(w.espessura_m, 0.10) || 0.10,
      measurement_source: w.measurement_source || "inferred_from_symbol",
      confidence: toNum(w.confidence, 0.7),
      has_door: !!w.has_door,
      has_window: !!w.has_window,
      opening_area_m2: toNum(w.opening_area_m2, 0),
      esquadrias: Array.isArray(w.esquadrias) ? w.esquadrias.map((e: any) => ({
        tipo: e.tipo || "porta",
        codigo: e.codigo || "",
        largura_m: toNum(e.largura_m, 0),
        altura_m: toNum(e.altura_m, 0),
        peitoril_m: e.peitoril_m === undefined || e.peitoril_m === null ? undefined : toNum(e.peitoril_m, 0),
        measurement_source: e.measurement_source || "inferred_from_symbol",
      })) : [],
      bbox,
      page_index: typeof w.page_index === "number" && Number.isFinite(w.page_index) ? w.page_index : undefined,
    };
  });

  const slabs: ExtractedSlab[] = (parsed.slabs || []).map((s: any, i: number) => ({
    id: s.id || `L${i + 1}`,
    nivel: s.nivel || defaultNivel,
    classe: s.classe || (s.nivel?.toLowerCase().includes("coberta") ? "coberta" : "piso"),
    area_m2: toNumOrFirst(s.area_m2, s.area),
    measurement_source: s.measurement_source || "inferred_from_symbol",
    confidence: toNum(s.confidence, 0.7),
  }));

  const corners: ExtractedCorner[] = (parsed.corners || []).map((c: any, i: number) => ({
    id: c.id || `C${i + 1}`,
    nivel: c.nivel || defaultNivel,
    qtd_cantos: Math.round(toNum(c.qtd_cantos, 0)),
  }));

  return { walls, slabs, corners };
}

export async function verifyExtraction(
  filePath: string,
  fileType: string | undefined,
  geometry: GeometryResult,
  tableData: TableData | null,
  buildingType?: string,
): Promise<GeometryResult> {
  try {
    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString("base64");
    const mimeType = getMimeType(filePath, fileType);

    const wallsSummary = geometry.walls.map(w =>
      `${w.id}: ${w.classe}, ${w.comprimento_m}m x ${w.altura_m}m, aberturas=${w.opening_area_m2}m², fonte=${w.measurement_source}, esquadrias=[${w.esquadrias.map(e => `${e.codigo}(${e.tipo} ${e.largura_m}x${e.altura_m})`).join(", ")}]`
    ).join("\n");

    const slabsSummary = geometry.slabs.map(s =>
      `${s.id}: ${s.classe}, ${s.area_m2}m², nivel=${s.nivel}`
    ).join("\n");

    const tableSummary = tableData ? `
Areas de tabela: ${tableData.areas_de_tabela.map(a => `${a.nivel} ${a.tipo}: ${a.area_m2}m²`).join(", ")}
Esquadrias de tabela: ${tableData.esquadrias_de_tabela.map(e => `${e.codigo}: ${e.tipo} ${e.largura_m}x${e.altura_m} qtd=${e.quantidade}`).join(", ")}
` : "Nenhuma tabela extraida.";

    const extCount = geometry.walls.filter(w => w.classe === "externa").length;
    const intCount = geometry.walls.filter(w => w.classe === "interna").length;
    const muroCount = geometry.walls.filter(w => w.classe === "muro").length;
    const totalEsquadrias = geometry.walls.reduce((sum, w) => sum + (w.esquadrias?.length || 0), 0);

    const btConfig = getBuildingTypeConfig(buildingType);

    const prompt = `Voce e um revisor tecnico especialista em plantas arquitetonicas e orcamento de paineis Lightwall.

${btConfig.fewShotContext}

${btConfig.verificationHints}

=== REGRAS DE CLASSIFICACAO (use para verificar) ===
- MURO: limite do TERRENO/LOTE, linhas mais externas do desenho, FORA da projecao da edificacao coberta, sem janelas.
- EXTERNA: envoltoria da CASA, forma o poligono fechado da area construida. Uma face toca exterior (jardim/rua), outra toca ambiente interno.
- INTERNA: divisoria DENTRO da casa, ambas as faces tocam comodos internos. Contida dentro do poligono de externas.
- LAJE PISO/RADIER: soma das areas internas dos comodos. Terreo = radier, superiores = piso.
- LAJE COBERTA: projecao total da edificacao (somente ultimo pavimento). Telhado de telha NAO e laje.

TAREFA: Verifique se a extracao abaixo esta CORRETA comparando com a imagem.

PAREDES (${geometry.walls.length} total: ${extCount} ext, ${intCount} int, ${muroCount} muros):
${wallsSummary || "Nenhuma parede extraida"}

LAJES (${geometry.slabs.length}):
${slabsSummary || "Nenhuma laje extraida"}

ESQUADRIAS TOTAIS: ${totalEsquadrias}

DADOS DE TABELA:
${tableSummary}

VERIFICACAO:
1. CLASSIFICACAO:
   ${intCount === 0 ? "*** CRITICO: 0 INTERNAS! Paredes que dividem comodos DENTRO da casa devem ser 'interna'. ***" : ""}
   ${extCount === 0 ? "*** CRITICO: 0 EXTERNAS! O contorno da casa deve ser 'externa'. ***" : ""}
   ${extCount > intCount && geometry.walls.length > 6 ? `*** ALERTA: Mais externas (${extCount}) que internas (${intCount}) — em residencias tipicas, internas sao maioria. ***` : ""}
   - Externas formam o poligono fechado da casa? Se uma "externa" tem ambientes dos dois lados → "interna".
   - Alguma "interna" tem um lado voltado para jardim/exterior? → "externa".
   - Muros estao FORA da projecao da casa? Se um "muro" faz parte do contorno coberto → "externa".
2. PAREDES FALTANTES? Ha paredes visiveis na imagem nao extraidas?
3. ESQUADRIAS: ${totalEsquadrias === 0 ? "*** 0 ESQUADRIAS! Procure arcos (portas) e tracos paralelos (janelas). ***" : `${totalEsquadrias} encontradas — faltam?`}
4. COMPRIMENTOS: As cotas batem?
5. AREAS DE LAJE: Conferem com soma dos comodos? Classe correta para o pavimento?

Se TUDO correto: responda "APROVADO"
Se houver correcoes: retorne o JSON COMPLETO corrigido { "walls": [...], "slabs": [...], "corners": [...] }`;

    const { createOpenAIProvider, hasOpenAIKey } = await import("../ai/provider");
    const { getCurrentMetrics: getMetrics } = await import("./client");

    let text: string;
    let verificationModel = "gemini-2.5-pro";
    let isCrossModel = false;
    let fallbackUsed = false;
    let fallbackReason: string | undefined;

    const isPdf = mimeType === "application/pdf";
    const canUseOpenAI = hasOpenAIKey();

    if (canUseOpenAI) {
      const openaiProvider = createOpenAIProvider();
      if (openaiProvider) {
        try {
          let openaiImages: Array<{ base64: string; mimeType: string }>;

          if (isPdf) {
            console.log("[VERIFICACAO] Enviando PDF para OpenAI GPT-4o (suporte nativo a PDF)...");
            const pdfPages = await splitPdfPages(filePath);
            openaiImages = pdfPages.map(p => ({ base64: p.base64, mimeType: "application/pdf" }));
            console.log(`[VERIFICACAO] ${openaiImages.length} pagina(s) PDF para OpenAI`);
          } else {
            openaiImages = [{ base64, mimeType }];
          }

          console.log("[VERIFICACAO] Usando OpenAI GPT-4o para verificacao cross-model");
          text = await openaiProvider.generateContent(
            prompt,
            openaiImages,
            { temperature: 0.1, maxOutputTokens: 16384 },
          );
          verificationModel = "gpt-4o";
          isCrossModel = true;
          console.log(`[VERIFICACAO] OpenAI respondeu: ${text.substring(0, 500)}`);
        } catch (openaiError: any) {
          console.warn(`[VERIFICACAO] OpenAI falhou (${openaiError.message}), usando Gemini como fallback`);
          text = await callGemini(base64, mimeType, prompt, 16384);
          fallbackUsed = true;
          fallbackReason = openaiError.message?.substring(0, 100) || "Erro desconhecido";
        }
      } else {
        text = await callGemini(base64, mimeType, prompt, 16384);
      }
    } else {
      text = await callGemini(base64, mimeType, prompt, 16384);
    }

    console.log(`[VERIFICACAO] Resposta (${verificationModel}): ${text.substring(0, 500)}`);

    const hadCorrections = !text.includes("APROVADO");

    const metrics = getMetrics();
    if (metrics) {
      metrics.verification = {
        verificationModel,
        isCrossModel,
        hadCorrections,
        fallbackUsed,
        fallbackReason,
      };
    }

    if (!hadCorrections) {
      console.log("[VERIFICACAO] Extracao aprovada sem correcoes");
      return geometry;
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log("[VERIFICACAO] Sem JSON de correcao, mantendo original");
      return geometry;
    }

    const corrected = repairJSON(jsonMatch[0]);
    if (!corrected) {
      console.log("[VERIFICACAO] JSON de correcao invalido, mantendo original");
      return geometry;
    }

    const result = parseGeometryJSON(corrected, text, geometry.walls[0]?.nivel || "Terreo");

    if (result.walls.length === 0 && geometry.walls.length > 0) {
      console.log("[VERIFICACAO] Correcao retornou 0 paredes, mantendo original");
      return geometry;
    }

    const origWallCount = geometry.walls.length;
    const newWallCount = result.walls.length;
    console.log(`[VERIFICACAO] Corrigido (${verificationModel}): ${origWallCount} → ${newWallCount} paredes, ${geometry.slabs.length} → ${result.slabs.length} lajes`);

    return {
      walls: result.walls.length > 0 ? result.walls : geometry.walls,
      slabs: result.slabs.length > 0 ? result.slabs : geometry.slabs,
      corners: result.corners.length > 0 ? result.corners : geometry.corners,
    };
  } catch (error) {
    console.error("[VERIFICACAO] Erro na verificacao:", error);
    return geometry;
  }
}

export async function describeProject(
  filePaths: Array<{ path: string; fileType: string; name: string }>,
  classifications: PageClassification[],
  geometrySummary: { wallCount: number; slabCount: number; cornerCount: number; floors: string[] },
  budgetSummary: { totalPanels: number; totalCost: number; floors: Array<{ name: string; panels: number }> },
): Promise<string> {
  try {
    const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];

    for (const file of filePaths) {
      const buffer = await fs.readFile(file.path);
      const base64 = buffer.toString("base64");
      const mimeType = getMimeType(file.path, file.fileType);
      parts.push({ inlineData: { mimeType, data: base64 } });
    }

    const classDesc = classifications.map(c =>
      `Pagina ${c.page_index}: ${c.classificacao} (${c.pavimento}), tabela=${c.has_table}, escala=${c.has_scale}`
    ).join("\n");

    const floorDesc = budgetSummary.floors.map(f => `  - ${f.name}: ${f.panels} paineis`).join("\n");

    parts.push({ text: `Voce e um orcamentista especializado em construcao com paineis de concreto Lightwall.

Analise todas as imagens/paginas deste projeto arquitetonico COM FOCO EM ORCAMENTO E QUANTITATIVO. Sua analise deve ser PRATICA e DIRETA, voltada para quem precisa entender o que vai ser orcado.

Retorne a analise em FORMATO DE TOPICOS (bullet points) organizados nas seguintes secoes. Use "## " para titulo de secao e "- " para cada item. Seja direto e objetivo:

## Identificacao do Projeto
- Tipo de edificacao (residencial, comercial, industrial)
- Numero de pavimentos
- Padrao construtivo estimado
- Dimensoes gerais aproximadas (comprimento x largura)

## Quantitativos Identificados
- Numero total de paredes identificadas e metragem linear aproximada
- Numero de lajes identificadas e area aproximada
- Cantoneiras/encontros de paredes
- Esquadrias: quantidade de portas e janelas, tipos visiveis

## Distribuicao por Pavimento
- Para cada pavimento, liste os ambientes identificados e observacoes sobre dimensoes

## Observacoes para Orcamento
- Detalhes que impactam o custo: pe-direito, aberturas grandes, formatos irregulares, acessos dificeis
- Pontos de atencao: areas que podem ter perda maior de material, paredes curvas ou nao-padrao
- Elementos NAO cobertos pelo Lightwall (fundacao, cobertura, acabamentos)

## Resumo dos Dados Extraidos
- Classificacao das paginas analisadas: ${classifications.length} paginas
- Geometria extraida: ${geometrySummary.wallCount} paredes, ${geometrySummary.slabCount} lajes, ${geometrySummary.cornerCount} cantos
- Pavimentos: ${geometrySummary.floors.join(", ")}
- Orcamento calculado: ${budgetSummary.totalPanels} paineis, R$ ${budgetSummary.totalCost.toFixed(2)}
${floorDesc ? `- Distribuicao:\n${floorDesc}` : ""}

## Alertas e Ressalvas
- Liste qualquer ambiguidade, informacao incompleta ou item que pode precisar de revisao manual

IMPORTANTE: Use SOMENTE formato de topicos com "## " para secoes e "- " para itens. NAO escreva paragrafos longos. Seja conciso e direto ao ponto. Escreva em portugues do Brasil.` });

    const text = await callGeminiExtractionMultiPart(parts, 4096, 0.3);
    console.log(`[DESCRICAO] Texto gerado: ${text.substring(0, 200)}...`);
    return text.trim();
  } catch (error) {
    console.error("[DESCRICAO] Erro ao gerar descricao:", error);
    return "Nao foi possivel gerar a descricao automatica do projeto. Tente novamente.";
  }
}

// ===================================================================
// Task #9: Extracao de informacao de cortes (alturas/pe-direito).
// Le paginas classificadas como "corte" e devolve, por pavimento, o
// pe-direito anotado nas cotas verticais. Pulado silenciosamente quando
// nao houver corte (preserva comportamento mono-pavimento sem corte).
// ===================================================================
export async function extractSectionInfo(
  filePath: string,
  fileType: string | undefined,
  classifications: PageClassification[],
): Promise<SectionInfo[]> {
  // Task #9: aceita "corte" e "fachada" (elevacao) — ambos sao vistas verticais
  // com cotas de altura. Fachada normalmente mostra apenas o exterior, mas
  // suficiente para confirmar pe-direito total da edificacao.
  const verticalPages = classifications.filter(c => c.classificacao === "corte" || c.classificacao === "fachada");
  if (verticalPages.length === 0) return [];

  const fileMime = getMimeType(filePath, fileType);
  // Carrega paginas. PDF -> splitPdfPages devolve 1-page PDFs (mime application/pdf).
  // Imagem -> bytes brutos no mime real do arquivo.
  let pageImages: Array<{ pageIndex: number; base64: string; mimeType: string }>;
  if (fileMime === "application/pdf") {
    const pdfPages = await splitPdfPages(filePath);
    pageImages = pdfPages.map(p => ({ ...p, mimeType: "application/pdf" }));
  } else {
    const buf = await fs.readFile(filePath);
    pageImages = [{ pageIndex: 0, base64: buf.toString("base64"), mimeType: fileMime }];
  }

  const results: SectionInfo[] = [];
  for (const c of verticalPages) {
    const page = pageImages.find(p => p.pageIndex === c.page_index);
    if (!page) continue;
    const pavHint = c.pavimento || "Terreo";
    const prompt = `Voce esta vendo um CORTE arquitetonico (vista vertical). Extraia o PE-DIREITO (altura piso-a-teto) de cada pavimento visivel no corte. Use as cotas verticais anotadas no desenho.

Regras:
- Se o desenho mostrar uma cota em metros (ex: "2,80 m", "3.0 m", "2700"), use ESSA cota.
- Cotas em mm/cm devem ser convertidas para metros.
- "Pe-direito" = distancia do piso acabado ao teto/laje superior do mesmo pavimento.
- Se ha multiplos pavimentos no corte, retorne UM item por pavimento.
- Se o corte nao tem cotas claras, retorne array vazio.
- NAO invente: melhor retornar vazio do que chutar.

Pavimento associado a este corte (sugestao da classificacao): "${pavHint}". Use o nome real do pavimento se vier marcado no corte (ex: "Terreo", "1 Pavimento", "Cobertura"). Caso contrario, use "${pavHint}".

Responda APENAS com JSON neste formato (sem markdown, sem texto extra):
{
  "sections": [
    { "pavimento": "Terreo", "pe_direito_m": 2.80, "confidence": 0.9, "observacao": "cota '2.80m' lida ao lado da escada" }
  ]
}`;
    try {
      const text = await callGeminiExtraction(page.base64, page.mimeType, prompt, 2048, 2048);
      const parsed = repairJSON(text);
      const sections: any[] = parsed?.sections || [];
      for (const s of sections) {
        const pd = num(s.pe_direito_m, 0);
        const conf = num(s.confidence, 0);
        if (pd <= 1.5 || pd > 8) continue; // sanidade
        results.push({
          pavimento: String(s.pavimento || pavHint).trim() || pavHint,
          pe_direito_m: pd,
          confidence: Math.max(0, Math.min(1, conf)),
          page_index: c.page_index,
          observacao: s.observacao ? String(s.observacao).slice(0, 200) : undefined,
        });
      }
    } catch (err: any) {
      console.warn(`[CORTE] Falha extraindo corte pg ${c.page_index}: ${err?.message || err}`);
    }
  }

  console.log(`[CORTE] ${results.length} pavimento(s) com pe-direito extraido de ${verticalPages.length} vista(s) vertical(is) (cortes/fachadas)`);
  return results;
}

function num(v: any, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}
