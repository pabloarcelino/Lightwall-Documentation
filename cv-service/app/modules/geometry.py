from typing import List

import cv2
import numpy as np

from app.config import (
    HOUGH_THRESHOLD, HOUGH_MIN_LINE_LENGTH, HOUGH_MAX_LINE_GAP,
    WALL_ANGLE_TOLERANCE,
)
from app.utils.coordinate_utils import bbox_pixel_to_normalized


def detect_wall_lines(binary_image: np.ndarray, min_length: int | None = None) -> List[dict]:
    """Detect wall line segments using probabilistic Hough Transform.

    Filters for mostly horizontal or vertical lines (architectural walls).
    Returns list of dicts with: x1, y1, x2, y2, length_px, angle_deg, orientation
    """
    if min_length is None:
        min_length = HOUGH_MIN_LINE_LENGTH

    edges = cv2.Canny(binary_image, 50, 150, apertureSize=3)

    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=HOUGH_THRESHOLD,
        minLineLength=min_length,
        maxLineGap=HOUGH_MAX_LINE_GAP,
    )

    segments: List[dict] = []
    if lines is None:
        return segments

    for line in lines:
        x1, y1, x2, y2 = line[0]
        length_px = np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        angle = np.degrees(np.arctan2(abs(y2 - y1), abs(x2 - x1)))

        # Keep only lines that are mostly horizontal or vertical
        is_horizontal = angle < WALL_ANGLE_TOLERANCE
        is_vertical = angle > (90 - WALL_ANGLE_TOLERANCE)

        if not (is_horizontal or is_vertical):
            continue

        segments.append({
            "x1": int(x1), "y1": int(y1),
            "x2": int(x2), "y2": int(y2),
            "length_px": float(length_px),
            "angle_deg": float(angle),
            "orientation": "horizontal" if is_horizontal else "vertical",
        })

    return merge_collinear_segments(segments)


def merge_collinear_segments(segments: List[dict], gap_tolerance: int = 15, align_tolerance: int = 8) -> List[dict]:
    """Merge collinear line segments that are close together.

    This handles cases where a single wall is detected as multiple fragmented segments.
    """
    if not segments:
        return segments

    horizontal = [s for s in segments if s["orientation"] == "horizontal"]
    vertical = [s for s in segments if s["orientation"] == "vertical"]

    merged = []
    merged.extend(_merge_group(horizontal, axis="horizontal", gap_tolerance=gap_tolerance, align_tolerance=align_tolerance))
    merged.extend(_merge_group(vertical, axis="vertical", gap_tolerance=gap_tolerance, align_tolerance=align_tolerance))

    return merged


def _merge_group(segments: List[dict], axis: str, gap_tolerance: int, align_tolerance: int) -> List[dict]:
    """Merge segments within a single orientation group."""
    if not segments:
        return []

    # Sort by alignment axis position, then by start position
    if axis == "horizontal":
        segments.sort(key=lambda s: (min(s["y1"], s["y2"]), min(s["x1"], s["x2"])))
    else:
        segments.sort(key=lambda s: (min(s["x1"], s["x2"]), min(s["y1"], s["y2"])))

    merged: List[dict] = []
    current = segments[0].copy()

    for seg in segments[1:]:
        if axis == "horizontal":
            # Check alignment (similar Y position)
            cur_y = (current["y1"] + current["y2"]) / 2
            seg_y = (seg["y1"] + seg["y2"]) / 2
            if abs(cur_y - seg_y) > align_tolerance:
                merged.append(current)
                current = seg.copy()
                continue
            # Check gap
            cur_end = max(current["x1"], current["x2"])
            seg_start = min(seg["x1"], seg["x2"])
            if seg_start - cur_end > gap_tolerance:
                merged.append(current)
                current = seg.copy()
                continue
            # Merge: extend current segment
            current["x1"] = min(current["x1"], seg["x1"])
            current["x2"] = max(current["x2"], seg["x2"])
            current["y1"] = int(cur_y)
            current["y2"] = int(cur_y)
        else:
            cur_x = (current["x1"] + current["x2"]) / 2
            seg_x = (seg["x1"] + seg["x2"]) / 2
            if abs(cur_x - seg_x) > align_tolerance:
                merged.append(current)
                current = seg.copy()
                continue
            cur_end = max(current["y1"], current["y2"])
            seg_start = min(seg["y1"], seg["y2"])
            if seg_start - cur_end > gap_tolerance:
                merged.append(current)
                current = seg.copy()
                continue
            current["y1"] = min(current["y1"], seg["y1"])
            current["y2"] = max(current["y2"], seg["y2"])
            current["x1"] = int(cur_x)
            current["x2"] = int(cur_x)

        # Recalculate length
        current["length_px"] = float(np.sqrt(
            (current["x2"] - current["x1"]) ** 2 +
            (current["y2"] - current["y1"]) ** 2
        ))

    merged.append(current)
    return merged


def compute_wall_bboxes(
    segments: List[dict], img_width: int, img_height: int, wall_thickness_px: int = 8
) -> List[dict]:
    """Convert line segments to bounding boxes with normalized coordinates.

    Each wall segment gets a bbox that accounts for wall thickness.
    Returns segments with added 'bbox_normalized' field: [ymin, xmin, ymax, xmax] in 0-1000.
    """
    result = []
    for seg in segments:
        x1, y1, x2, y2 = seg["x1"], seg["y1"], seg["x2"], seg["y2"]
        half_t = wall_thickness_px // 2

        if seg["orientation"] == "horizontal":
            px_ymin = min(y1, y2) - half_t
            px_ymax = max(y1, y2) + half_t
            px_xmin = min(x1, x2)
            px_xmax = max(x1, x2)
        else:
            px_ymin = min(y1, y2)
            px_ymax = max(y1, y2)
            px_xmin = min(x1, x2) - half_t
            px_xmax = max(x1, x2) + half_t

        bbox_norm = bbox_pixel_to_normalized(
            max(0, px_ymin), max(0, px_xmin),
            min(img_height, px_ymax), min(img_width, px_xmax),
            img_width, img_height,
        )

        enriched = seg.copy()
        enriched["bbox_normalized"] = bbox_norm
        enriched["bbox_pixel"] = (px_ymin, px_xmin, px_ymax, px_xmax)
        result.append(enriched)

    return result
