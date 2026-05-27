"""Wall extractor — Fase E.2 da metodologia Lightwall.

Extrai paredes como segmentos (p1, p2, thickness) usando:
  - skeletonization (medial axis) da mask de paredes,
  - Harris corners no skeleton pra detectar JUNCOES,
  - quebra do skeleton em segmentos entre junções,
  - merge de segmentos colineares próximos.

STUB inicial: retorna estrutura tipada vazia. Implementacao real virá em
sessão dedicada da Fase E.2 (quando CubiCasa5K estiver integrado e a mask
de paredes vier dele).
"""
from typing import List
from dataclasses import dataclass

import numpy as np


@dataclass
class WallSegment:
    id: str
    p1: tuple  # (x, y) em pixels
    p2: tuple
    thickness_px: float
    has_door_gap: bool = False
    has_window_gap: bool = False
    confidence: float = 0.7


def extract_walls_from_mask(
    wall_mask: np.ndarray,
    min_segment_len_px: int = 20,
) -> List[WallSegment]:
    """Extrai segmentos de parede a partir de uma máscara binária.

    Etapas:
      1. skimage.morphology.medial_axis → skeleton
      2. cv2.cornerHarris no skeleton → junções
      3. break skeleton em segmentos entre junções
      4. cv2.fitLine para cada segmento → reta ajustada
      5. merge segmentos colineares com gap pequeno

    Args:
        wall_mask: uint8 (0/255), shape (H, W). Pixels brancos = parede.
        min_segment_len_px: descarta segmentos menores que isso.

    Returns:
        Lista de WallSegment ordenada por comprimento decrescente.
    """
    # TODO Fase E.2: implementação real.
    # Por enquanto retorna lista vazia (não cria paredes mock — risco de
    # confundir o pipeline). Caller deve fallback pra Gemini.
    _ = wall_mask, min_segment_len_px
    return []


def merge_collinear_segments(
    segments: List[WallSegment],
    angle_tolerance_deg: float = 5.0,
    gap_px: float = 8.0,
) -> List[WallSegment]:
    """Funde segmentos colineares com gap pequeno (resolve quebra de
    janela/porta detectada como múltiplos segmentos)."""
    # TODO Fase E.2.
    _ = angle_tolerance_deg, gap_px
    return segments
