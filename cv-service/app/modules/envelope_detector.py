"""Envelope detector — Fase E.2 da metodologia Lightwall.

Detecta o poligono externo da edificacao coberta usando:
  - multi-scale morphological closing (3 kernels: small/medium/large),
  - findContours(RETR_EXTERNAL) na mascara consolidada,
  - cv2.approxPolyDP pra simplificar,
  - alpha shape (concave hull) se contorno for ruidoso,
  - watershed-from-seeds quando OCR identificou comodos.

Importante: a logica padrao usa MULTI-SCALE pra resolver o gap "que kernel
usar?" — o closing pequeno preserva detalhes; o grande fecha portas e da
o envelope.
"""
from typing import List, Tuple, Optional
from dataclasses import dataclass, field

import cv2
import numpy as np

try:
    import alphashape
    from shapely.geometry import Polygon
    HAS_ALPHASHAPE = True
except ImportError:
    HAS_ALPHASHAPE = False


@dataclass
class EnvelopeResult:
    polygon: List[Tuple[float, float]]
    confidence: float
    lot_polygon: Optional[List[Tuple[float, float]]] = None
    notes: List[str] = field(default_factory=list)


def detect_envelope_multiscale(
    wall_mask: np.ndarray,
    kernel_sizes: Tuple[int, int, int] = (5, 11, 19),
    approx_epsilon_ratio: float = 0.005,
) -> EnvelopeResult:
    """Multi-scale morphological closing → contour externo.

    Estrategia:
     - Closing kernel_sizes[0]: preserva janelas, fecha falhas pequenas.
     - Closing kernel_sizes[1]: fecha janelas; aberturas grandes (portas) abertas.
     - Closing kernel_sizes[2]: fecha portas tambem -> mascara de envelope.

    Aplica findContours(RETR_EXTERNAL) na mascara mais agressiva e pega o
    contorno externo maior (a edificacao coberta).

    Returns:
        EnvelopeResult com polygon do contorno externo em pixels (lista
        de tuplas (x, y) flutuantes apos approxPolyDP).
    """
    if wall_mask is None or wall_mask.size == 0:
        return EnvelopeResult(polygon=[], confidence=0.0, notes=["mascara vazia"])

    _, binary = cv2.threshold(wall_mask, 127, 255, cv2.THRESH_BINARY)

    # Aplica os 3 closings empilhados — o resultado final tem TODAS as
    # aberturas (janelas + portas) fechadas.
    closed = binary
    for k in kernel_sizes:
        ker = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
        closed = cv2.morphologyEx(closed, cv2.MORPH_CLOSE, ker, iterations=1)

    # Dilatacao leve pra garantir contorno fechado (margem 2-3px).
    dilate = cv2.dilate(closed, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=1)

    contours, _ = cv2.findContours(dilate, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return EnvelopeResult(polygon=[], confidence=0.0, notes=["nenhum contorno externo"])

    # Maior contorno por area = envelope.
    main = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(main)
    perim = cv2.arcLength(main, closed=True)

    if area < 500:  # super pequeno = ruido
        return EnvelopeResult(polygon=[], confidence=0.0, notes=["contorno muito pequeno"])

    # Simplificacao via approxPolyDP — escala epsilon pelo perimetro.
    epsilon = approx_epsilon_ratio * perim
    approx = cv2.approxPolyDP(main, epsilon, closed=True)
    polygon = [(float(p[0][0]), float(p[0][1])) for p in approx]

    # Avalia qualidade: solidez (area / area do convex hull).
    hull = cv2.convexHull(main)
    hull_area = cv2.contourArea(hull)
    solidity = area / hull_area if hull_area > 0 else 0.0

    notes: List[str] = []
    confidence = 0.85
    if solidity < 0.6:
        # Forma muito concava — alpha shape funciona melhor.
        notes.append(f"solidez baixa ({solidity:.2f}), tentando alpha shape")
        ashape = _try_alpha_shape(main)
        if ashape:
            polygon = ashape
            confidence = 0.75
            notes.append("alpha shape aplicado")
    elif len(polygon) < 4:
        notes.append(f"poligono muito simples ({len(polygon)} vertices)")
        confidence = 0.55

    return EnvelopeResult(
        polygon=polygon,
        confidence=confidence,
        notes=notes,
    )


def _try_alpha_shape(contour: np.ndarray) -> Optional[List[Tuple[float, float]]]:
    """Tenta gerar concave hull (alpha shape) do contorno.

    Useful quando a casa tem reentrancias (varandas, recuos) e convex hull
    incluiria area que nao e parte da edificacao. Alpha shape preserva
    concavidades.
    """
    if not HAS_ALPHASHAPE:
        return None
    try:
        pts = [(float(p[0][0]), float(p[0][1])) for p in contour]
        # Sub-sample se houver muitos pontos (alpha shape pode ser lento).
        if len(pts) > 500:
            step = len(pts) // 500
            pts = pts[::step]
        # Alpha pequeno = mais concavo; alpha grande = convex hull.
        alpha = 0.005
        shape = alphashape.alphashape(pts, alpha)
        if shape is None or not hasattr(shape, "exterior"):
            return None
        coords = list(shape.exterior.coords)
        return [(float(x), float(y)) for x, y in coords]
    except Exception:
        return None


def watershed_from_text_seeds(
    wall_mask: np.ndarray,
    text_centroids: List[Tuple[int, int]],
) -> List[List[Tuple[float, float]]]:
    """Watershed usando centroides de texto de comodo como sementes.

    Robusto contra paredes com pequenas falhas (que quebrariam flood fill).
    Cada regiao fechada vira um poligono.

    Args:
        wall_mask: uint8 (0/255).
        text_centroids: lista de (x, y) em pixels — centroides de texto OCR.

    Returns:
        Lista de poligonos (cada um e uma lista de (x, y)).
    """
    if wall_mask is None or wall_mask.size == 0:
        return []
    if not text_centroids:
        return []

    # Cria mapa de marcadores: 0 = unknown, 1+ = seeds (cada centroide = 1 marker), -1 = barreira (parede).
    h, w = wall_mask.shape[:2]
    markers = np.zeros((h, w), dtype=np.int32)
    for i, (cx, cy) in enumerate(text_centroids):
        if 0 <= cy < h and 0 <= cx < w:
            cv2.circle(markers, (int(cx), int(cy)), radius=5, color=i + 2, thickness=-1)

    # Marca paredes como background (label 1) — vira borda.
    _, wall_binary = cv2.threshold(wall_mask, 127, 255, cv2.THRESH_BINARY)
    markers[wall_binary > 0] = 1

    # Roda watershed (precisa de imagem BGR).
    img_bgr = cv2.cvtColor(wall_binary, cv2.COLOR_GRAY2BGR)
    cv2.watershed(img_bgr, markers)

    # Pra cada marker (>1), extrai contorno.
    polygons: List[List[Tuple[float, float]]] = []
    for label_id in range(2, markers.max() + 1):
        mask = (markers == label_id).astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        biggest = max(contours, key=cv2.contourArea)
        if cv2.contourArea(biggest) < 200:
            continue
        epsilon = 0.005 * cv2.arcLength(biggest, True)
        approx = cv2.approxPolyDP(biggest, epsilon, True)
        polygons.append([(float(p[0][0]), float(p[0][1])) for p in approx])

    return polygons
