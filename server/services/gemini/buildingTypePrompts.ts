import type { BuildingType } from "@shared/schema";

export type { BuildingType };

export interface BuildingTypeConfig {
  label: string;
  fewShotContext: string;
  verificationHints: string;
  fusionHeuristics: {
    minInternalWallRatio: number;
    maxExternalWallRatio: number;
    minEsquadriasExpected: number;
    perimeterWallFraction: number;
    maxPerimeterWalls: number;
  };
}

const CONFIGS: Record<BuildingType, BuildingTypeConfig> = {
  residencial: {
    label: "Residencial",
    fewShotContext: `TIPO DE EDIFICACAO: RESIDENCIAL (casa, apartamento, sobrado)
CARACTERISTICAS TIPICAS:
- Muitas paredes internas dividindo comodos (quartos, sala, cozinha, banheiros, corredor)
- Tipicamente 4-8 paredes externas (perimetro) e 8-20 paredes internas
- Muitas esquadrias: 4-8 portas internas, 1-2 portas externas, 3-6 janelas
- Comodos pequenos a medios (8-25 m² cada)
- Pe-direito tipico: 2.80-3.00m
- Area total tipica: 50-300 m²

EXEMPLOS RESIDENCIAIS:
- Uma casa de 3 quartos tipica: ~4-6 ext, ~12-16 int, ~8-12 portas, ~5-8 janelas
- Um apartamento de 2 quartos: ~4 ext, ~8-10 int, ~6-8 portas, ~3-5 janelas`,
    verificationHints: `VALIDACAO RESIDENCIAL:
- Em residencias, DEVE haver MAIS paredes internas que externas (tipicamente 2x-3x mais).
- Espere pelo menos 4 portas (entrada, quartos, banheiros) e 3 janelas.
- Se houver 0 paredes internas, isso e CERTAMENTE ERRADO para uma residencia.
- Se houver 0 esquadrias, isso e CERTAMENTE ERRADO para uma residencia.
- Comodos residenciais tipicos: SALA, QUARTO, BWC, COZINHA, LAVANDERIA, CORREDOR, HALL.`,
    fusionHeuristics: {
      minInternalWallRatio: 0.55,
      maxExternalWallRatio: 0.45,
      minEsquadriasExpected: 6,
      perimeterWallFraction: 0.35,
      maxPerimeterWalls: 8,
    },
  },

  comercial: {
    label: "Comercial",
    fewShotContext: `TIPO DE EDIFICACAO: COMERCIAL (escritorio, loja, sala comercial, shopping)
CARACTERISTICAS TIPICAS:
- Areas abertas maiores (open space, salao)
- Menos paredes internas que residencial, mas ainda significativas
- Esquadrias podem ser maiores (vitrines, portas de vidro)
- Banheiros coletivos, copa, areas tecnicas
- Pe-direito pode ser maior: 3.00-4.00m
- Area total tipica: 100-1000 m²

EXEMPLOS COMERCIAIS:
- Sala comercial 100m²: ~4 ext, ~4-6 int (divisorias, banheiro, copa)
- Loja 200m²: ~4 ext, ~3-5 int (deposito, banheiro, escritorio)`,
    verificationHints: `VALIDACAO COMERCIAL:
- Comerciais podem ter grandes vaos abertos — menos paredes internas e aceitavel.
- Portas podem ser maiores (1.00-2.00m de largura).
- Janelas/vitrines podem ser muito grandes.
- Espere pelo menos 2-3 portas e 1-2 janelas no minimo.
- Se o projeto e um salao com poucas divisorias, poucos paredes internas e normal.`,
    fusionHeuristics: {
      minInternalWallRatio: 0.30,
      maxExternalWallRatio: 0.70,
      minEsquadriasExpected: 3,
      perimeterWallFraction: 0.40,
      maxPerimeterWalls: 10,
    },
  },

  institucional: {
    label: "Institucional",
    fewShotContext: `TIPO DE EDIFICACAO: INSTITUCIONAL (creche, escola, posto de saude, clinica, igreja)
CARACTERISTICAS TIPICAS:
- Salas amplas (salas de aula, refeitorio, auditorio)
- Grandes vaos abertos em algumas areas
- Muitos banheiros (especialmente em escolas/creches)
- Corredores largos e acessiveis
- Pe-direito pode variar: 3.00-5.00m
- Area total tipica: 200-2000 m²

EXEMPLOS INSTITUCIONAIS:
- Creche 400m²: ~6-8 ext, ~10-15 int (salas, banheiros, cozinha, admin)
- Escola: ~8-12 ext, ~20-30 int (salas de aula, banheiros, secretaria)`,
    verificationHints: `VALIDACAO INSTITUCIONAL:
- Institucional pode ter salas muito grandes (30-80m²) — areas maiores sao normais.
- Espere muitos banheiros (3-6 ou mais) com muitas portas.
- Corredores largos e normais.
- Portas de acesso podem ser mais largas (1.00-1.20m) para acessibilidade.
- A proporcao interna/externa depende do layout — pode ter muitas internas em escolas.`,
    fusionHeuristics: {
      minInternalWallRatio: 0.40,
      maxExternalWallRatio: 0.60,
      minEsquadriasExpected: 8,
      perimeterWallFraction: 0.30,
      maxPerimeterWalls: 12,
    },
  },

  industrial: {
    label: "Industrial",
    fewShotContext: `TIPO DE EDIFICACAO: INDUSTRIAL (galpao, fabrica, deposito, armazem)
CARACTERISTICAS TIPICAS:
- Grandes vaos sem paredes internas (galpao aberto)
- Poucas divisorias (escritorio, vestiario, deposito)
- Pe-direito alto: 4.00-8.00m ou mais
- Paredes externas longas
- Poucas esquadrias residenciais — pode ter portoes industriais
- Area total tipica: 500-5000 m²

EXEMPLOS INDUSTRIAIS:
- Galpao 1000m²: ~4-6 ext (paredes longas), ~2-4 int (escritorio, wc, vestiario)
- Deposito 500m²: ~4 ext, ~1-2 int`,
    verificationHints: `VALIDACAO INDUSTRIAL:
- Galpoes podem ter POUCAS ou NENHUMA parede interna — isso e NORMAL para industrial.
- Paredes externas podem ser muito longas (20-50m+).
- Pe-direito alto (4-8m) e esperado.
- Esquadrias podem ser poucas — portoes industriais contam.
- NÃO force paredes internas se o projeto for claramente um galpao aberto.
- 0 paredes internas PODE ser correto para um galpao simples.`,
    fusionHeuristics: {
      minInternalWallRatio: 0.10,
      maxExternalWallRatio: 0.90,
      minEsquadriasExpected: 1,
      perimeterWallFraction: 0.60,
      maxPerimeterWalls: 6,
    },
  },

  outro: {
    label: "Outro",
    fewShotContext: `TIPO DE EDIFICACAO: NAO ESPECIFICADO
Analise a planta sem assumir um tipo especifico de edificacao. Use heuristicas genericas.`,
    verificationHints: `VALIDACAO GENERICA:
- Verifique a proporcao interna/externa — em geral, espera-se pelo menos algumas paredes internas.
- Verifique se ha esquadrias — a maioria dos edificios tem portas e janelas.
- Use bom senso para o tipo de edificacao que parece ser.`,
    fusionHeuristics: {
      minInternalWallRatio: 0.35,
      maxExternalWallRatio: 0.65,
      minEsquadriasExpected: 4,
      perimeterWallFraction: 0.35,
      maxPerimeterWalls: 8,
    },
  },
};

export function getBuildingTypeConfig(buildingType?: string | null): BuildingTypeConfig {
  if (buildingType && buildingType in CONFIGS) {
    return CONFIGS[buildingType];
  }
  return CONFIGS.outro;
}

export function getBuildingTypeLabel(buildingType?: string | null): string {
  return getBuildingTypeConfig(buildingType).label;
}

export const BUILDING_TYPE_DETECTION_PROMPT = `
Alem da classificacao da pagina, DETECTE o tipo de edificacao a partir dos elementos visuais:
- "residencial": casa, apartamento, sobrado — muitos quartos, banheiros, cozinha, sala
- "comercial": escritorio, loja, sala comercial — areas abertas, poucos comodos
- "institucional": creche, escola, clinica, igreja — salas amplas, corredores, muitos banheiros
- "industrial": galpao, fabrica, deposito — grandes vaos, pe-direito alto, poucas divisorias
- "outro": nao se encaixa nas categorias acima

Inclua no JSON: "tipo_edificacao": "residencial|comercial|institucional|industrial|outro"
`;
