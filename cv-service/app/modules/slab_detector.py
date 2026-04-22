from typing import List

import cv2
import numpy as np

from app.config import SLAB_MIN_AREA_RATIO, SLAB_MAX_AREA_RATIO
from app.utils.coordinate_utils import bbox_pixel_to_normalized


def detect_enclosed_regions(
    binary_image: np.ndarray,
    img_width: int,
    img_height: int,
) -> List[dict]:
    """Find enclosed rooms using connected components on inverted binary image.

    Returns list of dicts with: label, area_px, bbox_pixel, bbox_normalized, centroid
    """
    # Invert: walls become background, rooms become foreground
    inverted = cv2.bitwise_not(binary_image)

    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        inverted, connectivity=4
    )

    total_area = img_height * img_width
    regions: List[dict] = []

    for i in range(1, num_labels):  # skip background (label 0)
        area = stats[i, cv2.CC_STAT_AREA]
        ratio = area / total_area

        # Skip too small (noise) or too large (background)
        if ratio < SLAB_MIN_AREA_RATIO or ratio > SLAB_MAX_AREA_RATIO:
            continue

        x = stats[i, cv2.CC_STAT_LEFT]
        y = stats[i, cv2.CC_STAT_TOP]
        bw = stats[i, cv2.CC_STAT_WIDTH]
        bh = stats[i, cv2.CC_STAT_HEIGHT]

        bbox_norm = bbox_pixel_to_normalized(
            y, x, y + bh, x + bw,
            img_width, img_height,
        )

        regions.append({
            "label": int(i),
            "area_px": int(area),
            "area_ratio": round(ratio, 4),
            "bbox_pixel": (y, x, y + bh, x + bw),
            "bbox_normalized": bbox_norm,
            "centroid": (round(float(centroids[i][0]), 1), round(float(centroids[i][1]), 1)),
        })

    return regions
