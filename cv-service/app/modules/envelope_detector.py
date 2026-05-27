"""Envelope detector — Fase E.2 da metodologia Lightwall.

Detecta o polígono externo da edificação coberta usando:
  - multi-scale morphological closing (resolve Gap 4: tamanho de kernel).
  - findContours(RETR_EXTERNAL) na máscara consolidada.
  - alpha shape (concave hull) ao invés de convex hull (Gap 2).
  - watershed-from-text-seeds quando OCR já identificou cômodos (Gap 5).

STUB inicial. Implementação real em sessão dedicada.
"""
from typing import List, Tuple, Optional
from dataclasses import dataclass

import numpy as np


@dataclass
class EnvelopeResult:
    polygon: List[Tuple[float, float]]
    confidence: float
    lot_polygon: Optional[List[Tuple[float, float]]] = None
    notes: List[str] = None


def detect_envelope_multiscale(
    wall_mask: np.ndarray,
    kernel_sizes: tuple = (5, 9, 15),
) -> EnvelopeResult:
    """Multi-scale morphological closing → contour externo.

    Roda cv2.morphologyEx(MORPH_CLOSE) com 3 kernels e combina:
      - small kernel: walls + janelas detectadas (gaps pequenos preservados).
      - large kernel: envelope (gaps grandes — portas — fechados).
      - diff (medium - large): localização aproximada das portas.

    Args:
        wall_mask: uint8 (0/255), shape (H, W).
        kernel_sizes: 3 tamanhos pequeno/médio/grande.

    Returns:
        EnvelopeResult com polygon do contorno externo.
    """
    # TODO Fase E.2.
    _ = wall_mask, kernel_sizes
    return EnvelopeResult(polygon=[], confidence=0.0, notes=["stub"])


def watershed_from_text_seeds(
    wall_mask: np.ndarray,
    text_centroids: List[Tuple[int, int]],
) -> List[List[Tuple[float, float]]]:
    """Watershed usando centroides de texto de cômodo como sementes.

    Robusto contra paredes com pequenas falhas (que quebrariam flood fill).
    Cada região fechada vira um polígono.
    """
    # TODO Fase E.2.
    _ = wall_mask, text_centroids
    return []
