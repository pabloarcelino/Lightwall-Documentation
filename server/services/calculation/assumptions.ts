export interface Assumption {
  field: string;
  value: number;
  unit: string;
  description: string;
  appliedTo: string[];
}

export const DEFAULT_ASSUMPTIONS = {
  wallHeight: {
    value: 3.0,
    unit: "m",
    description: "Altura padrao de paredes (pe-direito)",
  },
  doorWidth: {
    value: 0.8,
    unit: "m",
    description: "Largura padrao de portas",
  },
  doorHeight: {
    value: 2.1,
    unit: "m",
    description: "Altura padrao de portas",
  },
  windowWidth: {
    value: 1.2,
    unit: "m",
    description: "Largura padrao de janelas comuns",
  },
  windowHeight: {
    value: 1.0,
    unit: "m",
    description: "Altura padrao de janelas comuns",
  },
  windowSillHeight: {
    value: 1.1,
    unit: "m",
    description: "Altura padrao de peitoril de janelas comuns",
  },
  highWindowSillHeight: {
    value: 1.5,
    unit: "m",
    description: "Altura padrao de peitoril de janelas altas",
  },
  highWindowHeight: {
    value: 0.6,
    unit: "m",
    description: "Altura padrao de janelas altas",
  },
  groundFloorType: {
    value: "radier",
    unit: "",
    description: "Tipo de fundacao no terreo (radier por padrao)",
  },
};

export interface ElementWithAssumptions {
  element: any;
  appliedAssumptions: Assumption[];
  hasAssumption: boolean;
}

export function applyWallAssumptions(wall: {
  id: string;
  length?: number;
  height?: number;
  type: "interna" | "externa";
  hasCorner90?: boolean;
}): ElementWithAssumptions {
  const appliedAssumptions: Assumption[] = [];
  const element = { ...wall };

  if (!element.height || element.height <= 0) {
    element.height = DEFAULT_ASSUMPTIONS.wallHeight.value;
    appliedAssumptions.push({
      field: "height",
      value: DEFAULT_ASSUMPTIONS.wallHeight.value,
      unit: DEFAULT_ASSUMPTIONS.wallHeight.unit,
      description: DEFAULT_ASSUMPTIONS.wallHeight.description,
      appliedTo: [wall.id],
    });
  }

  return {
    element,
    appliedAssumptions,
    hasAssumption: appliedAssumptions.length > 0,
  };
}

export function applyWindowDoorAssumptions(opening: {
  id: string;
  type: "porta" | "janela";
  width?: number;
  height?: number;
  sillHeight?: number;
}): ElementWithAssumptions {
  const appliedAssumptions: Assumption[] = [];
  const element = { ...opening };

  if (element.type === "porta") {
    if (!element.width || element.width <= 0) {
      element.width = DEFAULT_ASSUMPTIONS.doorWidth.value;
      appliedAssumptions.push({
        field: "width",
        value: DEFAULT_ASSUMPTIONS.doorWidth.value,
        unit: DEFAULT_ASSUMPTIONS.doorWidth.unit,
        description: DEFAULT_ASSUMPTIONS.doorWidth.description,
        appliedTo: [opening.id],
      });
    }

    if (!element.height || element.height <= 0) {
      element.height = DEFAULT_ASSUMPTIONS.doorHeight.value;
      appliedAssumptions.push({
        field: "height",
        value: DEFAULT_ASSUMPTIONS.doorHeight.value,
        unit: DEFAULT_ASSUMPTIONS.doorHeight.unit,
        description: DEFAULT_ASSUMPTIONS.doorHeight.description,
        appliedTo: [opening.id],
      });
    }
  } else if (element.type === "janela") {
    const isHighWindow = element.sillHeight && element.sillHeight > 1.3;

    if (!element.width || element.width <= 0) {
      element.width = DEFAULT_ASSUMPTIONS.windowWidth.value;
      appliedAssumptions.push({
        field: "width",
        value: DEFAULT_ASSUMPTIONS.windowWidth.value,
        unit: DEFAULT_ASSUMPTIONS.windowWidth.unit,
        description: DEFAULT_ASSUMPTIONS.windowWidth.description,
        appliedTo: [opening.id],
      });
    }

    if (!element.height || element.height <= 0) {
      if (isHighWindow) {
        element.height = DEFAULT_ASSUMPTIONS.highWindowHeight.value;
        appliedAssumptions.push({
          field: "height",
          value: DEFAULT_ASSUMPTIONS.highWindowHeight.value,
          unit: DEFAULT_ASSUMPTIONS.highWindowHeight.unit,
          description: DEFAULT_ASSUMPTIONS.highWindowHeight.description,
          appliedTo: [opening.id],
        });
      } else {
        element.height = DEFAULT_ASSUMPTIONS.windowHeight.value;
        appliedAssumptions.push({
          field: "height",
          value: DEFAULT_ASSUMPTIONS.windowHeight.value,
          unit: DEFAULT_ASSUMPTIONS.windowHeight.unit,
          description: DEFAULT_ASSUMPTIONS.windowHeight.description,
          appliedTo: [opening.id],
        });
      }
    }

    if (!element.sillHeight || element.sillHeight <= 0) {
      element.sillHeight = DEFAULT_ASSUMPTIONS.windowSillHeight.value;
      appliedAssumptions.push({
        field: "sillHeight",
        value: DEFAULT_ASSUMPTIONS.windowSillHeight.value,
        unit: DEFAULT_ASSUMPTIONS.windowSillHeight.unit,
        description: DEFAULT_ASSUMPTIONS.windowSillHeight.description,
        appliedTo: [opening.id],
      });
    }
  }

  return {
    element,
    appliedAssumptions,
    hasAssumption: appliedAssumptions.length > 0,
  };
}

export function applySlabAssumptions(slab: {
  id: string;
  type: "piso" | "cobertura";
  area?: number;
  level?: string;
}): ElementWithAssumptions {
  const appliedAssumptions: Assumption[] = [];
  const element = { ...slab };

  if (
    element.type === "piso" &&
    (!element.level ||
      element.level.toLowerCase().includes("terreo") ||
      element.level.toLowerCase().includes("térreo"))
  ) {
    appliedAssumptions.push({
      field: "foundationType",
      value: DEFAULT_ASSUMPTIONS.groundFloorType.value as any,
      unit: "",
      description: DEFAULT_ASSUMPTIONS.groundFloorType.description,
      appliedTo: [slab.id],
    });
  }

  return {
    element,
    appliedAssumptions,
    hasAssumption: appliedAssumptions.length > 0,
  };
}

export function getAllAppliedAssumptions(
  walls: any[],
  windowsDoors: any[],
  slabs: any[],
): Assumption[] {
  const allAssumptions: Assumption[] = [];

  for (const wall of walls) {
    const result = applyWallAssumptions(wall);
    allAssumptions.push(...result.appliedAssumptions);
  }

  for (const opening of windowsDoors) {
    const result = applyWindowDoorAssumptions(opening);
    allAssumptions.push(...result.appliedAssumptions);
  }

  for (const slab of slabs) {
    const result = applySlabAssumptions(slab);
    allAssumptions.push(...result.appliedAssumptions);
  }

  return allAssumptions;
}
