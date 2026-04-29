import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import {
  IfcAPI,
  IFCWALL,
  IFCWALLSTANDARDCASE,
  IFCWALLELEMENTEDCASE,
  IFCSLAB,
  IFCSLABSTANDARDCASE,
  IFCSLABELEMENTEDCASE,
  IFCDOOR,
  IFCDOORSTANDARDCASE,
  IFCWINDOW,
  IFCWINDOWSTANDARDCASE,
  IFCBUILDINGSTOREY,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
  IFCRELDEFINESBYPROPERTIES,
  IFCRELAGGREGATES,
  IFCRELVOIDSELEMENT,
  IFCRELFILLSELEMENT,
} from "web-ifc";
import type { GeometryResult, ExtractedWall, ExtractedSlab, WallEsquadria } from "../gemini/planAnalyzer";

const WALL_TYPES = [IFCWALL, IFCWALLSTANDARDCASE, IFCWALLELEMENTEDCASE];
const SLAB_TYPES = [IFCSLAB, IFCSLABSTANDARDCASE, IFCSLABELEMENTEDCASE];
const DOOR_TYPES = [IFCDOOR, IFCDOORSTANDARDCASE];
const WINDOW_TYPES = [IFCWINDOW, IFCWINDOWSTANDARDCASE];

let apiSingleton: IfcAPI | null = null;
let apiInitPromise: Promise<IfcAPI> | null = null;

async function getApi(): Promise<IfcAPI> {
  if (apiSingleton) return apiSingleton;
  if (apiInitPromise) return apiInitPromise;
  apiInitPromise = (async () => {
    const api = new IfcAPI();
    const localRequire = createRequire(import.meta.url);
    const wasmDir = path.dirname(localRequire.resolve("web-ifc")) + path.sep;
    api.SetWasmPath(wasmDir, true);
    await api.Init(undefined, true);
    apiSingleton = api;
    return api;
  })();
  return apiInitPromise;
}

function vecToArray<T>(vec: { size(): number; get(i: number): T }): T[] {
  const out: T[] = [];
  const n = vec.size();
  for (let i = 0; i < n; i++) out.push(vec.get(i));
  return out;
}

function getStringValue(v: any): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "object" && "value" in v) {
    const inner = (v as any).value;
    if (typeof inner === "string") return inner;
    if (inner !== undefined && inner !== null) return String(inner);
  }
  return undefined;
}

function getNumberValue(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v === "object" && "value" in v) {
    const inner = (v as any).value;
    if (typeof inner === "number") return Number.isFinite(inner) ? inner : undefined;
    if (typeof inner === "string") {
      const n = parseFloat(inner);
      return Number.isFinite(n) ? n : undefined;
    }
  }
  return undefined;
}

function getBoolValue(v: any): boolean | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  const s = getStringValue(v);
  if (s === undefined) return undefined;
  const upper = s.toUpperCase();
  if (upper === "T" || upper === "TRUE" || upper === ".T.") return true;
  if (upper === "F" || upper === "FALSE" || upper === ".F.") return false;
  return undefined;
}

function pickRef(ref: any): number | undefined {
  if (!ref) return undefined;
  if (typeof ref === "number") return ref;
  if (typeof ref === "object") {
    if ("value" in ref && typeof (ref as any).value === "number") return (ref as any).value;
    if ("expressID" in ref && typeof (ref as any).expressID === "number") return (ref as any).expressID;
  }
  return undefined;
}

interface ParsedProps {
  isExternal?: boolean;
  loadBearing?: boolean;
  length?: number;
  width?: number;
  height?: number;
  netArea?: number;
  grossArea?: number;
}

function parsePropertySet(propSet: any): ParsedProps {
  const out: ParsedProps = {};
  if (!propSet) return out;

  const psetName = getStringValue(propSet.Name) || "";

  if (Array.isArray(propSet.HasProperties)) {
    for (const prop of propSet.HasProperties) {
      if (!prop) continue;
      const name = getStringValue(prop.Name);
      if (!name) continue;
      const nominal = prop.NominalValue;
      const upper = name.toUpperCase();
      if (upper === "ISEXTERNAL") {
        const b = getBoolValue(nominal);
        if (b !== undefined) out.isExternal = b;
      } else if (upper === "LOADBEARING") {
        const b = getBoolValue(nominal);
        if (b !== undefined) out.loadBearing = b;
      }
    }
  }

  if (Array.isArray(propSet.Quantities)) {
    for (const q of propSet.Quantities) {
      if (!q) continue;
      const name = getStringValue(q.Name);
      if (!name) continue;
      const upper = name.toUpperCase();
      const lengthVal = getNumberValue(q.LengthValue);
      const areaVal = getNumberValue(q.AreaValue);
      if (upper === "LENGTH" && lengthVal !== undefined) out.length = lengthVal;
      else if (upper === "WIDTH" && lengthVal !== undefined) out.width = lengthVal;
      else if (upper === "HEIGHT" && lengthVal !== undefined) out.height = lengthVal;
      else if (upper === "NETAREA" && areaVal !== undefined) out.netArea = areaVal;
      else if (upper === "GROSSAREA" && areaVal !== undefined) out.grossArea = areaVal;
      else if (upper === "NETSIDEAREA" && areaVal !== undefined) out.netArea = out.netArea ?? areaVal;
      else if (upper === "GROSSSIDEAREA" && areaVal !== undefined) out.grossArea = out.grossArea ?? areaVal;
    }
  }

  if (psetName) {
    // No-op: Pset name is used by web-ifc to differentiate Psets vs Qto
    // Both flow through HasProperties / Quantities above.
  }

  return out;
}

function mergeProps(a: ParsedProps, b: ParsedProps): ParsedProps {
  return {
    isExternal: a.isExternal ?? b.isExternal,
    loadBearing: a.loadBearing ?? b.loadBearing,
    length: a.length ?? b.length,
    width: a.width ?? b.width,
    height: a.height ?? b.height,
    netArea: a.netArea ?? b.netArea,
    grossArea: a.grossArea ?? b.grossArea,
  };
}

interface ModelMaps {
  storeyName: Map<number, string>;
  storeyElevation: Map<number, number>;
  elementToStorey: Map<number, number>;
  elementToProps: Map<number, ParsedProps>;
  openingToHost: Map<number, number>;
  fillToOpening: Map<number, number>;
}

function buildModelMaps(api: IfcAPI, modelID: number): ModelMaps {
  const storeyName = new Map<number, number | string>() as Map<number, string>;
  const storeyElevation = new Map<number, number>();
  const elementToStorey = new Map<number, number>();
  const elementToProps = new Map<number, ParsedProps>();
  const openingToHost = new Map<number, number>();
  const fillToOpening = new Map<number, number>();

  // 1) Storeys
  const storeyIds = vecToArray(api.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY));
  for (const id of storeyIds) {
    const line = api.GetLine(modelID, id, true);
    if (!line) continue;
    const name = getStringValue(line.Name) || getStringValue(line.LongName) || `Storey ${id}`;
    const elev = getNumberValue(line.Elevation);
    storeyName.set(id, name);
    if (elev !== undefined) storeyElevation.set(id, elev);
  }

  // 2) Spatial containment: which element is on which storey
  const containmentIds = vecToArray(api.GetLineIDsWithType(modelID, IFCRELCONTAINEDINSPATIALSTRUCTURE));
  for (const id of containmentIds) {
    const rel = api.GetLine(modelID, id, true);
    if (!rel) continue;
    const structureRef = pickRef(rel.RelatingStructure);
    if (structureRef === undefined || !storeyName.has(structureRef)) continue;
    const elements = Array.isArray(rel.RelatedElements) ? rel.RelatedElements : [];
    for (const e of elements) {
      const eid = pickRef(e);
      if (eid !== undefined) elementToStorey.set(eid, structureRef);
    }
  }

  // 3) Property/Quantity sets
  const propRelIds = vecToArray(api.GetLineIDsWithType(modelID, IFCRELDEFINESBYPROPERTIES));
  for (const id of propRelIds) {
    const rel = api.GetLine(modelID, id, true);
    if (!rel) continue;
    const propSet = rel.RelatingPropertyDefinition;
    if (!propSet) continue;
    const parsed = parsePropertySet(propSet);
    const objs = Array.isArray(rel.RelatedObjects) ? rel.RelatedObjects : [];
    for (const o of objs) {
      const oid = pickRef(o);
      if (oid === undefined) continue;
      const existing = elementToProps.get(oid);
      elementToProps.set(oid, existing ? mergeProps(existing, parsed) : parsed);
    }
  }

  // 4) Openings (voids in walls)
  const voidsRelIds = vecToArray(api.GetLineIDsWithType(modelID, IFCRELVOIDSELEMENT));
  for (const id of voidsRelIds) {
    const rel = api.GetLine(modelID, id, true);
    if (!rel) continue;
    const hostId = pickRef(rel.RelatingBuildingElement);
    const openId = pickRef(rel.RelatedOpeningElement);
    if (hostId !== undefined && openId !== undefined) openingToHost.set(openId, hostId);
  }

  // 5) Fills (door/window in opening)
  const fillsRelIds = vecToArray(api.GetLineIDsWithType(modelID, IFCRELFILLSELEMENT));
  for (const id of fillsRelIds) {
    const rel = api.GetLine(modelID, id, true);
    if (!rel) continue;
    const openId = pickRef(rel.RelatingOpeningElement);
    const fillId = pickRef(rel.RelatedBuildingElement);
    if (openId !== undefined && fillId !== undefined) fillToOpening.set(fillId, openId);
  }

  return { storeyName, storeyElevation, elementToStorey, elementToProps, openingToHost, fillToOpening };
}

function inferStoreyName(maps: ModelMaps, expressID: number): string {
  const storeyId = maps.elementToStorey.get(expressID);
  if (storeyId !== undefined) {
    const name = maps.storeyName.get(storeyId);
    if (name) return name;
  }
  return "Terreo";
}

function classifyWall(props: ParsedProps): "externa" | "interna" | "muro" {
  if (props.isExternal === true) return "externa";
  return "interna";
}

interface BBoxExtents {
  dx: number;
  dy: number;
  dz: number;
}

/**
 * Compute the axis-aligned bounding box extents of an element's mesh,
 * combining all PlacedGeometry vertices (after applying their flatTransformation).
 * Returns extents in world space along each axis.
 *
 * Notes:
 * - Each vertex stride is 6 floats: x,y,z,nx,ny,nz.
 * - flatTransformation is a flat 4x4 matrix in row-major order.
 */
function computeBBoxFromMesh(api: IfcAPI, modelID: number, expressID: number): BBoxExtents | null {
  let mesh: any;
  try {
    mesh = api.GetFlatMesh(modelID, expressID);
  } catch {
    return null;
  }
  if (!mesh || !mesh.geometries) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let any = false;

  const placedCount = mesh.geometries.size();
  for (let i = 0; i < placedCount; i++) {
    const placed = mesh.geometries.get(i);
    const t = placed.flatTransformation as number[];
    let geom: any;
    try {
      geom = api.GetGeometry(modelID, placed.geometryExpressID);
    } catch {
      continue;
    }
    if (!geom) continue;
    const vPtr = geom.GetVertexData();
    const vSize = geom.GetVertexDataSize();
    if (!vSize) continue;
    const verts = api.GetVertexArray(vPtr, vSize);
    // Each vertex: x,y,z,nx,ny,nz (6 floats)
    for (let j = 0; j < verts.length; j += 6) {
      const x = verts[j];
      const y = verts[j + 1];
      const z = verts[j + 2];
      // Apply 4x4 transformation (row-major, w=1):
      // wx = m0*x + m1*y + m2*z + m3
      // wy = m4*x + m5*y + m6*z + m7
      // wz = m8*x + m9*y + m10*z + m11
      let wx: number, wy: number, wz: number;
      if (t && t.length >= 16) {
        wx = t[0] * x + t[1] * y + t[2] * z + t[3];
        wy = t[4] * x + t[5] * y + t[6] * z + t[7];
        wz = t[8] * x + t[9] * y + t[10] * z + t[11];
      } else {
        wx = x; wy = y; wz = z;
      }
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wz < minZ) minZ = wz;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
      if (wz > maxZ) maxZ = wz;
      any = true;
    }
  }

  if (!any) return null;
  return { dx: maxX - minX, dy: maxY - minY, dz: maxZ - minZ };
}

/**
 * Infer wall length, thickness and height from a bounding box.
 * Robust to any axis convention by sorting extents:
 *   - smallest extent = thickness (always the thinnest dim of a wall)
 *   - largest of the remaining two = length
 *   - smaller of the remaining two = height
 * This works because real walls are usually longer than they are tall,
 * and far thinner than either.
 */
function wallDimsFromBBox(b: BBoxExtents): { length: number; thickness: number; height: number } {
  const sorted = [b.dx, b.dy, b.dz].sort((a, c) => a - c); // [min, mid, max]
  return {
    thickness: sorted[0],
    height: sorted[1],
    length: sorted[2],
  };
}

/**
 * Infer slab area from bounding box. Uses the two largest extents (the
 * horizontal projection). The smallest extent is treated as slab thickness.
 */
function slabAreaFromBBox(b: BBoxExtents): number {
  const sorted = [b.dx, b.dy, b.dz].sort((a, c) => a - c); // [min, mid, max]
  return sorted[1] * sorted[2];
}

function classifySlab(predefinedType: string | undefined): "coberta" | "piso" | "radier" {
  const t = (predefinedType || "").toUpperCase();
  if (t === "ROOF") return "coberta";
  if (t === "BASESLAB" || t === "FOUNDATION") return "radier";
  return "piso";
}

export interface IfcParseResult extends GeometryResult {
  storeyCount: number;
  wallCount: number;
  slabCount: number;
  doorCount: number;
  windowCount: number;
  warnings: string[];
}

export async function parseIfcFile(filePath: string, peDireitoDefault: number = 3.0): Promise<IfcParseResult> {
  const api = await getApi();
  const buf = fs.readFileSync(filePath);
  const data = new Uint8Array(buf);
  const modelID = api.OpenModel(data);

  const warnings: string[] = [];
  const walls: ExtractedWall[] = [];
  const slabs: ExtractedSlab[] = [];

  try {
    const maps = buildModelMaps(api, modelID);

    // Doors and windows by host wall
    const wallEsquadrias = new Map<number, WallEsquadria[]>();
    let doorCount = 0;
    let windowCount = 0;

    const collectFill = (expressId: number, line: any, tipo: "porta" | "janela") => {
      const openId = maps.fillToOpening.get(expressId);
      if (openId === undefined) return;
      const hostId = maps.openingToHost.get(openId);
      if (hostId === undefined) return;

      const props = maps.elementToProps.get(expressId) || {};
      const overallWidth = getNumberValue(line?.OverallWidth);
      const overallHeight = getNumberValue(line?.OverallHeight);
      const codigo = getStringValue(line?.Name) || getStringValue(line?.Tag) || `${tipo === "porta" ? "P" : "J"}${expressId}`;

      const largura = overallWidth ?? props.width ?? props.length ?? (tipo === "porta" ? 0.8 : 1.2);
      const altura = overallHeight ?? props.height ?? (tipo === "porta" ? 2.1 : 1.2);

      const arr = wallEsquadrias.get(hostId) ?? [];
      arr.push({
        tipo,
        codigo: String(codigo),
        largura_m: largura,
        altura_m: altura,
        peitoril_m: tipo === "janela" ? 1.0 : undefined,
        measurement_source: "ifc",
      });
      wallEsquadrias.set(hostId, arr);
      if (tipo === "porta") doorCount++;
      else windowCount++;
    };

    for (const tipoIfc of DOOR_TYPES) {
      for (const id of vecToArray(api.GetLineIDsWithType(modelID, tipoIfc))) {
        const line = api.GetLine(modelID, id, true);
        collectFill(id, line, "porta");
      }
    }
    for (const tipoIfc of WINDOW_TYPES) {
      for (const id of vecToArray(api.GetLineIDsWithType(modelID, tipoIfc))) {
        const line = api.GetLine(modelID, id, true);
        collectFill(id, line, "janela");
      }
    }

    // Walls
    let wallSeq = 0;
    let wallsFromGeometry = 0;
    for (const tipoIfc of WALL_TYPES) {
      for (const id of vecToArray(api.GetLineIDsWithType(modelID, tipoIfc))) {
        const line = api.GetLine(modelID, id, true);
        if (!line) continue;
        wallSeq++;
        const props = maps.elementToProps.get(id) || {};
        let length = props.length;
        let width = props.width;
        let height = props.height;
        const codigo = getStringValue(line.Name) || getStringValue(line.Tag) || `W${id}`;

        // Fallback to geometry bounding box if quantities missing
        if (length === undefined || width === undefined || height === undefined) {
          const bbox = computeBBoxFromMesh(api, modelID, id);
          if (bbox) {
            const dims = wallDimsFromBBox(bbox);
            if (length === undefined) length = dims.length;
            if (width === undefined) width = dims.thickness;
            if (height === undefined) height = dims.height;
            wallsFromGeometry++;
          } else {
            warnings.push(`Parede ${codigo}: dimensoes ausentes e geometria nao disponivel.`);
          }
        }

        const classe = classifyWall(props);
        const nivel = inferStoreyName(maps, id);

        const esqs = wallEsquadrias.get(id) || [];
        const opening_area_m2 = esqs.reduce((acc, e) => acc + e.largura_m * e.altura_m, 0);

        walls.push({
          id: `IFC-W${wallSeq}`,
          nivel,
          classe,
          comprimento_m: length ?? 0,
          altura_m: height ?? peDireitoDefault,
          espessura_m: width ?? 0.10,
          measurement_source: "ifc",
          confidence: length !== undefined && height !== undefined ? 0.95 : 0.6,
          has_door: esqs.some(e => e.tipo === "porta"),
          has_window: esqs.some(e => e.tipo === "janela"),
          opening_area_m2,
          esquadrias: esqs,
        });
      }
    }
    if (wallsFromGeometry > 0) {
      console.log(`[IFC] ${wallsFromGeometry} paredes dimensionadas via geometria (Qto ausente).`);
    }

    // Slabs
    let slabSeq = 0;
    let slabsFromGeometry = 0;
    for (const tipoIfc of SLAB_TYPES) {
      for (const id of vecToArray(api.GetLineIDsWithType(modelID, tipoIfc))) {
        const line = api.GetLine(modelID, id, true);
        if (!line) continue;
        slabSeq++;
        const props = maps.elementToProps.get(id) || {};
        const predefined = getStringValue(line.PredefinedType);
        const classe = classifySlab(predefined);
        const nivel = inferStoreyName(maps, id);
        let area = props.netArea ?? props.grossArea;
        const codigo = getStringValue(line.Name) || getStringValue(line.Tag) || `S${id}`;

        if (area === undefined) {
          // Fallback: use horizontal projection of bounding box (two largest extents)
          const bbox = computeBBoxFromMesh(api, modelID, id);
          if (bbox) {
            area = slabAreaFromBBox(bbox);
            slabsFromGeometry++;
          } else {
            warnings.push(`Laje ${codigo}: area ausente e geometria nao disponivel. Pulada.`);
            continue;
          }
        }

        slabs.push({
          id: `IFC-S${slabSeq}`,
          nivel,
          classe,
          area_m2: area,
          measurement_source: "ifc",
          confidence: props.netArea !== undefined || props.grossArea !== undefined ? 0.95 : 0.7,
        });
      }
    }
    if (slabsFromGeometry > 0) {
      console.log(`[IFC] ${slabsFromGeometry} lajes dimensionadas via geometria (Qto ausente).`);
    }

    return {
      walls,
      slabs,
      corners: [],
      storeyCount: maps.storeyName.size,
      wallCount: walls.length,
      slabCount: slabs.length,
      doorCount,
      windowCount,
      warnings,
    };
  } finally {
    try { api.CloseModel(modelID); } catch {}
  }
}
