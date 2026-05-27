"""Wall extractor — Fase E.2 da metodologia Lightwall.

Implementacao REAL usando:
  - skimage.morphology.medial_axis pra skeletonization (eixo central da parede),
  - cv2.cornerHarris pra detectar JUNCOES,
  - particao do skeleton em segmentos retos entre junções,
  - cv2.fitLine pra obter (p1, p2) precisos de cada segmento.

Saida: lista de WallSegment com endpoints em PIXELS da imagem original.
"""
from typing import List, Tuple
from dataclasses import dataclass, field

import cv2
import numpy as np
from skimage.morphology import medial_axis


@dataclass
class WallSegment:
    id: str
    p1: Tuple[int, int]  # (x, y) em pixels
    p2: Tuple[int, int]
    thickness_px: float
    length_px: float
    has_door_gap: bool = False
    has_window_gap: bool = False
    confidence: float = 0.7
    neighbors: List[str] = field(default_factory=list)


def extract_walls_from_mask(
    wall_mask: np.ndarray,
    min_segment_len_px: int = 25,
) -> List[WallSegment]:
    """Extrai segmentos de parede a partir de uma mascara binaria.

    Args:
        wall_mask: uint8 (0/255), shape (H, W). Pixels brancos = parede.
        min_segment_len_px: descarta segmentos menores que isso.

    Returns:
        Lista de WallSegment ordenada por length_px descrescente.
    """
    if wall_mask is None or wall_mask.size == 0:
        return []

    # Binariza (caso ainda nao esteja).
    _, binary = cv2.threshold(wall_mask, 127, 255, cv2.THRESH_BINARY)

    # 1. Skeletonization: medial axis devolve o eixo central + distance transform
    #    (raio do maior circulo inscrito em cada pixel do skeleton — usado como
    #    estimativa de espessura da parede naquele ponto).
    skel, distance = medial_axis(binary > 0, return_distance=True)
    skel_uint8 = (skel.astype(np.uint8)) * 255

    # 2. Detectar junções: pontos no skeleton que tem 3+ vizinhos.
    junctions = _detect_skeleton_junctions(skel_uint8)

    # 3. Quebrar skeleton em segmentos entre junções.
    raw_segments = _split_skeleton_into_segments(skel_uint8, junctions, min_len=min_segment_len_px)

    # 4. Pra cada segmento, ajusta uma linha reta (fitLine) e estima espessura
    #    a partir do distance transform.
    walls: List[WallSegment] = []
    for idx, pts in enumerate(raw_segments):
        if len(pts) < 2:
            continue
        # fitLine: vx,vy,x0,y0 (direcao + ponto)
        pts_np = np.array(pts, dtype=np.float32).reshape(-1, 1, 2)
        vx, vy, x0, y0 = cv2.fitLine(pts_np, cv2.DIST_L2, 0, 0.01, 0.01).flatten()
        # Projeta pontos extremos na reta
        ts = [(p[0] - x0) * vx + (p[1] - y0) * vy for p in pts]
        t_min, t_max = min(ts), max(ts)
        x1 = int(round(x0 + vx * t_min))
        y1 = int(round(y0 + vy * t_min))
        x2 = int(round(x0 + vx * t_max))
        y2 = int(round(y0 + vy * t_max))
        length = float(np.hypot(x2 - x1, y2 - y1))
        if length < min_segment_len_px:
            continue
        # Espessura: media do distance transform ao longo do segmento (* 2 = diametro).
        thickness = float(np.mean([distance[p[1], p[0]] for p in pts])) * 2.0
        walls.append(WallSegment(
            id=f"WS{idx+1:03d}",
            p1=(x1, y1),
            p2=(x2, y2),
            thickness_px=thickness,
            length_px=length,
            confidence=0.85,
        ))

    walls.sort(key=lambda w: w.length_px, reverse=True)

    # 5. Merge segmentos colineares com gap pequeno (resolve quebra de janela).
    walls = merge_collinear_segments(walls)
    return walls


def _detect_skeleton_junctions(skel_uint8: np.ndarray) -> np.ndarray:
    """Detecta pixels no skeleton que tem 3+ vizinhos (junções).

    Usa um kernel 3x3 para contar vizinhos brancos. Pixel central com >= 3
    vizinhos no skeleton e classificado como junção.
    """
    sk_bin = (skel_uint8 > 0).astype(np.uint8)
    # Conta vizinhos via filtragem (8-conexão).
    kernel = np.array([
        [1, 1, 1],
        [1, 0, 1],
        [1, 1, 1],
    ], dtype=np.uint8)
    neighbor_count = cv2.filter2D(sk_bin, ddepth=cv2.CV_8U, kernel=kernel)
    junctions = (sk_bin == 1) & (neighbor_count >= 3)
    return junctions.astype(np.uint8) * 255


def _split_skeleton_into_segments(
    skel_uint8: np.ndarray,
    junctions: np.ndarray,
    min_len: int,
) -> List[List[Tuple[int, int]]]:
    """Quebra o skeleton em "ramos" entre junções, retornando lista de pontos."""
    # Remove junções do skeleton — vira N componentes conectados (cada um e um ramo).
    skel_no_junctions = cv2.subtract(skel_uint8, junctions)
    n_components, labels = cv2.connectedComponents(skel_no_junctions, connectivity=8)
    segments: List[List[Tuple[int, int]]] = []
    for label_id in range(1, n_components):
        ys, xs = np.where(labels == label_id)
        if len(xs) < min_len:
            continue
        # Ordena pontos pra formar uma sequencia coerente (NN-greedy).
        pts = list(zip(xs.tolist(), ys.tolist()))
        ordered = _order_points_nn(pts)
        segments.append(ordered)
    return segments


def _order_points_nn(pts: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
    """Ordena pontos por vizinho-mais-proximo, começando da extremidade
    (ponto com menos vizinhos próximos)."""
    if len(pts) <= 2:
        return pts
    # Encontra ponto extremidade: o que tem maior distancia ao centroide.
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    start_idx = max(range(len(pts)), key=lambda i: (pts[i][0] - cx) ** 2 + (pts[i][1] - cy) ** 2)
    visited = {start_idx}
    ordered = [pts[start_idx]]
    current = pts[start_idx]
    remaining_idx = list(range(len(pts)))
    remaining_idx.remove(start_idx)
    while remaining_idx:
        # Próximo: o mais perto do current.
        best_i = min(
            remaining_idx,
            key=lambda i: (pts[i][0] - current[0]) ** 2 + (pts[i][1] - current[1]) ** 2,
        )
        ordered.append(pts[best_i])
        current = pts[best_i]
        remaining_idx.remove(best_i)
        visited.add(best_i)
    return ordered


def merge_collinear_segments(
    segments: List[WallSegment],
    angle_tolerance_deg: float = 8.0,
    gap_px: float = 12.0,
) -> List[WallSegment]:
    """Funde segmentos colineares com gap pequeno.

    Util para casos onde uma parede com janela aparece como 2 segmentos.
    """
    if len(segments) <= 1:
        return segments

    used = [False] * len(segments)
    merged: List[WallSegment] = []
    for i, s in enumerate(segments):
        if used[i]:
            continue
        cur = s
        used[i] = True
        # Tenta achar mais segmentos pra fundir
        changed = True
        while changed:
            changed = False
            for j, t in enumerate(segments):
                if used[j]:
                    continue
                if _can_merge(cur, t, angle_tolerance_deg, gap_px):
                    cur = _merge_two(cur, t)
                    used[j] = True
                    changed = True
        merged.append(cur)
    return merged


def _angle_deg(seg: WallSegment) -> float:
    dx = seg.p2[0] - seg.p1[0]
    dy = seg.p2[1] - seg.p1[1]
    return float(np.degrees(np.arctan2(dy, dx))) % 180.0


def _can_merge(a: WallSegment, b: WallSegment, angle_tol: float, gap_tol: float) -> bool:
    a_ang = _angle_deg(a)
    b_ang = _angle_deg(b)
    diff = abs(a_ang - b_ang)
    if diff > 90:
        diff = 180 - diff
    if diff > angle_tol:
        return False
    # Distancia mais curta entre os endpoints.
    dists = [
        np.hypot(a.p1[0] - b.p1[0], a.p1[1] - b.p1[1]),
        np.hypot(a.p1[0] - b.p2[0], a.p1[1] - b.p2[1]),
        np.hypot(a.p2[0] - b.p1[0], a.p2[1] - b.p1[1]),
        np.hypot(a.p2[0] - b.p2[0], a.p2[1] - b.p2[1]),
    ]
    return min(dists) < gap_tol


def _merge_two(a: WallSegment, b: WallSegment) -> WallSegment:
    """Funde a e b reescolhendo p1/p2 pelos pontos mais distantes."""
    pts = [a.p1, a.p2, b.p1, b.p2]
    max_d = 0
    best_i, best_j = 0, 1
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            d = np.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])
            if d > max_d:
                max_d = d
                best_i, best_j = i, j
    return WallSegment(
        id=a.id,
        p1=pts[best_i],
        p2=pts[best_j],
        thickness_px=(a.thickness_px + b.thickness_px) / 2,
        length_px=float(max_d),
        has_door_gap=a.has_door_gap or b.has_door_gap,
        has_window_gap=a.has_window_gap or b.has_window_gap,
        confidence=min(a.confidence, b.confidence),
    )
