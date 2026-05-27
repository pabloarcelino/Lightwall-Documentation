"""Wall classifier — Fase E.4 da metodologia Lightwall.

Implementa o Passo 5 do algoritmo original do usuario com Shapely:
buffer + intersect booleano contra zonas mapeadas semanticamente.

Zonas:
  - Internas: uniao dos poligonos com room_type="interno".
  - Externas_Cobertas: room_type="externo_coberto" (varanda, garagem).
  - Externas_Descobertas: regiao FORA do envelope mas DENTRO do lote
    (jardim implicito, recuo, calcada).
  - Lote: poligono externo (muros de divisa) se houver.

Regra de classificacao por parede:
  - intersects(Externas_Descobertas) OR fora do envelope → externa.
  - intersects(Externas_Cobertas) → externa (varanda/garagem).
  - intersects(Internas) e dentro do envelope → interna.
  - Fora do envelope mas dentro do lote → muro.
  - Caso limítrofe (toca duas zonas em proporcao similar) → needs_review.
"""
from typing import List, Optional, Tuple, Dict
from dataclasses import dataclass, field

from shapely.geometry import LineString, Polygon, MultiPolygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union


@dataclass
class ClassifierZone:
    """Zona logica derivada de poligonos com mesmo type."""
    type: str  # "interno" | "externo_coberto" | "externo_descoberto"
    geometry: BaseGeometry


@dataclass
class WallClassification:
    wall_id: str
    classe: str  # "externa" | "interna" | "muro"
    reason: str
    needs_review: bool = False
    evidence: Dict[str, float] = field(default_factory=dict)


def build_zones(
    envelope: List[Tuple[float, float]],
    rooms: List[Dict],  # cada item: {polygon: [(x,y)...], room_type: str, label: str}
    lot: Optional[List[Tuple[float, float]]] = None,
) -> Dict[str, BaseGeometry]:
    """Constroi zonas Shapely a partir de envelope + rooms classificados.

    Returns:
        Dict com chaves: "envelope", "lot", "internas", "externas_cobertas",
        "externas_descobertas", "externo_absoluto".
    """
    zones: Dict[str, BaseGeometry] = {}
    if envelope and len(envelope) >= 3:
        env_poly = Polygon(envelope).buffer(0)  # buffer(0) repara invalidos
        zones["envelope"] = env_poly
    if lot and len(lot) >= 3:
        zones["lot"] = Polygon(lot).buffer(0)

    internas: List[Polygon] = []
    cobertas: List[Polygon] = []
    descobertas: List[Polygon] = []
    for r in rooms:
        poly_pts = r.get("polygon", [])
        if len(poly_pts) < 3:
            continue
        try:
            poly = Polygon(poly_pts).buffer(0)
            if not poly.is_valid or poly.is_empty:
                continue
        except Exception:
            continue
        t = r.get("room_type") or r.get("type")
        if t == "interno":
            internas.append(poly)
        elif t == "externo_coberto":
            cobertas.append(poly)
        elif t == "externo_descoberto":
            descobertas.append(poly)

    if internas:
        zones["internas"] = unary_union(internas)
    if cobertas:
        zones["externas_cobertas"] = unary_union(cobertas)
    if descobertas:
        zones["externas_descobertas"] = unary_union(descobertas)

    # Externo absoluto = fora do envelope (e fora do lote se houver).
    if "envelope" in zones:
        # Bounding box generoso (workaround pq Shapely nao tem "complemento absoluto").
        env = zones["envelope"]
        minx, miny, maxx, maxy = env.bounds
        margin = max(maxx - minx, maxy - miny) * 0.5
        big_box = Polygon([
            (minx - margin, miny - margin),
            (maxx + margin, miny - margin),
            (maxx + margin, maxy + margin),
            (minx - margin, maxy + margin),
        ])
        zones["externo_absoluto"] = big_box.difference(env)

    return zones


def classify_walls(
    walls: List[Dict],  # cada: {id, p1: (x,y), p2: (x,y), thickness_px}
    zones: Dict[str, BaseGeometry],
    buffer_multiplier: float = 1.5,
) -> List[WallClassification]:
    """Classifica cada parede testando buffer + intersect contra zonas.

    Args:
        walls: lista de paredes com endpoints em pixels.
        zones: dict de zonas Shapely (de build_zones).
        buffer_multiplier: multiplicador da espessura pra zona de contato.
            Default 1.5 = 75% da espessura de cada lado.

    Returns:
        Lista de WallClassification.
    """
    results: List[WallClassification] = []
    envelope = zones.get("envelope")
    externas_descobertas = zones.get("externas_descobertas")
    externas_cobertas = zones.get("externas_cobertas")
    internas = zones.get("internas")
    lot = zones.get("lot")
    externo_absoluto = zones.get("externo_absoluto")

    for w in walls:
        wall_id = w["id"]
        p1 = w["p1"]
        p2 = w["p2"]
        thickness = max(w.get("thickness_px", 8.0), 3.0)
        line = LineString([p1, p2])
        buf = line.buffer(thickness * buffer_multiplier)
        if not buf.is_valid or buf.is_empty:
            results.append(WallClassification(
                wall_id=wall_id, classe="externa",
                reason="buffer invalido — default externa", needs_review=True,
            ))
            continue

        # Calcula areas de intersecao por zona.
        evidence: Dict[str, float] = {}
        for name, geom in [
            ("externo_absoluto", externo_absoluto),
            ("externas_descobertas", externas_descobertas),
            ("externas_cobertas", externas_cobertas),
            ("internas", internas),
            ("envelope", envelope),
            ("lot", lot),
        ]:
            if geom is None or geom.is_empty:
                continue
            try:
                inter = buf.intersection(geom)
                area = float(inter.area) if not inter.is_empty else 0.0
                evidence[name] = area
            except Exception:
                evidence[name] = 0.0

        # Decide pela hierarquia.
        # 1. Toca externo absoluto (fora do envelope) — externa clara.
        if evidence.get("externo_absoluto", 0) > thickness * 5:
            # Se TAMBEM esta fora do envelope completamente: pode ser muro.
            line_outside_env = envelope is not None and not envelope.intersects(line)
            inside_lot = lot is not None and lot.contains(line)
            if line_outside_env and inside_lot:
                results.append(WallClassification(
                    wall_id=wall_id, classe="muro",
                    reason="fora do envelope, dentro do lote",
                    evidence=evidence,
                ))
            else:
                results.append(WallClassification(
                    wall_id=wall_id, classe="externa",
                    reason="toca exterior absoluto",
                    evidence=evidence,
                ))
            continue

        # 2. Toca externa descoberta (jardim, recuo).
        if evidence.get("externas_descobertas", 0) > thickness * 3:
            results.append(WallClassification(
                wall_id=wall_id, classe="externa",
                reason="toca zona externa descoberta",
                evidence=evidence,
            ))
            continue

        # 3. Toca externa coberta (varanda, garagem) — ainda e externa para
        # fins de carga termica/impermeabilizacao.
        if evidence.get("externas_cobertas", 0) > thickness * 3:
            results.append(WallClassification(
                wall_id=wall_id, classe="externa",
                reason="toca zona externa coberta (varanda/garagem)",
                evidence=evidence,
            ))
            continue

        # 4. Dentro do envelope e so toca zonas internas — interna.
        if evidence.get("internas", 0) > thickness * 3:
            results.append(WallClassification(
                wall_id=wall_id, classe="interna",
                reason="ambos lados em zonas internas",
                evidence=evidence,
            ))
            continue

        # 5. Caso default: dentro do envelope mas sem informacao de zonas —
        # provavel parede interna sem texto identificado no comodo.
        if envelope is not None and envelope.contains(line):
            results.append(WallClassification(
                wall_id=wall_id, classe="interna",
                reason="dentro do envelope, sem zonas externas tocadas",
                needs_review=True,
                evidence=evidence,
            ))
            continue

        # 6. Fora de tudo conhecido: externa por seguranca, marcada review.
        results.append(WallClassification(
            wall_id=wall_id, classe="externa",
            reason="fora de todas as zonas conhecidas",
            needs_review=True,
            evidence=evidence,
        ))

    return results
