"""Scale calibrator — Fase E.2 / Gap 7.

Deriva pixelsPerMeter da planta usando três estratégias em ordem:
  1. Texto de escala no carimbo ("1:50", "1:75") + DPI do raster.
  2. Primeira cota numérica reconhecida + comprimento dela em pixels.
  3. Heurística (parede mediana = ~3-5m em residências).

STUB inicial.
"""
from typing import Optional, List, Tuple
from dataclasses import dataclass


@dataclass
class ScaleResult:
    pixels_per_meter: float
    method: str  # "title_block" | "cota_inference" | "heuristic"
    confidence: float
    notes: List[str] = None


def calibrate_from_title_block(ocr_text_with_bbox: List[dict], image_dpi: int = 300) -> Optional[ScaleResult]:
    """Procura padrão '1:NN' em textos OCR-ados (típico no carimbo)."""
    # TODO Fase E.2.
    _ = ocr_text_with_bbox, image_dpi
    return None


def calibrate_from_first_cota(
    ocr_text_with_bbox: List[dict],
    image_shape: Tuple[int, int],
) -> Optional[ScaleResult]:
    """Pega a primeira cota numérica detectada e mede comprimento em pixels."""
    # TODO Fase E.2.
    _ = ocr_text_with_bbox, image_shape
    return None


def calibrate_heuristic(wall_segments: List[object]) -> ScaleResult:
    """Fallback final: assume comprimento mediano de parede ~3.5m."""
    # TODO Fase E.2.
    return ScaleResult(pixels_per_meter=50.0, method="heuristic", confidence=0.3, notes=["fallback"])
