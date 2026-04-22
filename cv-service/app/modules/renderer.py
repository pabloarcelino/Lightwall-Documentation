from typing import List

import cv2
import numpy as np

from app.config import COLORS, OVERLAY_ALPHA, BORDER_THICKNESS, FONT_SCALE, FONT_THICKNESS
from app.models import ExtractedWall, ExtractedSlab
from app.utils.coordinate_utils import bbox_normalized_to_pixel


def render_annotated_image(
    original_image: np.ndarray,
    walls: List[ExtractedWall],
    slabs: List[ExtractedSlab],
) -> np.ndarray:
    """Draw colored rectangles on the original image using wall/slab coordinates.

    Deterministic rendering — same input always produces same output.
    ~100ms execution, zero API cost.
    """
    h, w = original_image.shape[:2]
    result = original_image.copy()
    overlay = original_image.copy()

    # Draw walls
    for wall in walls:
        if wall.bbox is None:
            continue

        ymin, xmin, ymax, xmax = wall.bbox
        py1, px1, py2, px2 = bbox_normalized_to_pixel(ymin, xmin, ymax, xmax, w, h)

        # Clamp to image bounds
        px1, py1 = max(0, px1), max(0, py1)
        px2, py2 = min(w, px2), min(h, py2)

        color_key = wall.classe if wall.classe in COLORS else "externa"
        bgr = COLORS[color_key]["bgr"]

        # Semi-transparent fill on overlay
        cv2.rectangle(overlay, (px1, py1), (px2, py2), bgr, -1)

        # Solid border on result
        cv2.rectangle(result, (px1, py1), (px2, py2), bgr, BORDER_THICKNESS)

        # Label with wall ID
        label = wall.id
        label_y = py1 - 5 if py1 > 20 else py2 + 15
        cv2.putText(
            result, label, (px1 + 2, label_y),
            cv2.FONT_HERSHEY_SIMPLEX, FONT_SCALE, bgr, FONT_THICKNESS,
        )

    # Blend overlay for transparency effect
    result = cv2.addWeighted(overlay, OVERLAY_ALPHA, result, 1 - OVERLAY_ALPHA, 0)

    # Draw legend at bottom
    result = _draw_legend(result, walls, slabs)

    return result


def _draw_legend(image: np.ndarray, walls: List[ExtractedWall], slabs: List[ExtractedSlab]) -> np.ndarray:
    """Draw a color legend bar at the bottom of the image."""
    h, w = image.shape[:2]
    legend_height = 40
    legend = np.ones((legend_height, w, 3), dtype=np.uint8) * 255  # white background

    categories = []
    ext_count = sum(1 for w_ in walls if w_.classe == "externa")
    int_count = sum(1 for w_ in walls if w_.classe == "interna")
    muro_count = sum(1 for w_ in walls if w_.classe == "muro")
    piso_count = sum(1 for s in slabs if s.classe in ("piso", "radier"))
    coberta_count = sum(1 for s in slabs if s.classe == "coberta")

    if ext_count:
        categories.append(("Externa", ext_count, COLORS["externa"]["bgr"]))
    if int_count:
        categories.append(("Interna", int_count, COLORS["interna"]["bgr"]))
    if muro_count:
        categories.append(("Muro", muro_count, COLORS["muro"]["bgr"]))
    if piso_count:
        categories.append(("Piso", piso_count, COLORS["piso"]["bgr"]))
    if coberta_count:
        categories.append(("Coberta", coberta_count, COLORS["coberta"]["bgr"]))

    x_offset = 10
    for label, count, bgr in categories:
        # Color dot
        cv2.circle(legend, (x_offset + 8, legend_height // 2), 6, bgr, -1)
        # Text
        text = f"{label}: {count}"
        cv2.putText(legend, text, (x_offset + 20, legend_height // 2 + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1)
        x_offset += len(text) * 10 + 40

    return np.vstack([image, legend])
