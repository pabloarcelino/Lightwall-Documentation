import re
from typing import List

import numpy as np
import easyocr

from app.config import OCR_CM_THRESHOLD

# Lazy singleton — EasyOCR model loading takes several seconds
_reader: easyocr.Reader | None = None


def get_ocr_reader() -> easyocr.Reader:
    """Get or initialize the EasyOCR reader (cached singleton)."""
    global _reader
    if _reader is None:
        _reader = easyocr.Reader(["pt", "en"], gpu=False)
    return _reader


def extract_dimensions(image: np.ndarray) -> List[dict]:
    """Extract dimension texts and their [x, y] pixel coordinates from the image.

    Filters for numeric values (dimensions like 464, 3.50, 0.80).
    Auto-detects cm vs m based on OCR_CM_THRESHOLD.

    Returns list of dicts with: text, value_m, unit_detected, x, y, confidence, bbox_pts
    """
    reader = get_ocr_reader()
    results = reader.readtext(image, detail=1)

    dimensions: List[dict] = []
    for bbox_pts, text, conf in results:
        cleaned = text.strip().replace(",", ".").replace(" ", "")
        # Match numeric values: integers or decimals
        if not re.match(r"^\d+\.?\d*$", cleaned):
            continue

        try:
            value = float(cleaned)
        except ValueError:
            continue

        if value <= 0:
            continue

        # Calculate centroid of the text bounding box
        cx = int(np.mean([p[0] for p in bbox_pts]))
        cy = int(np.mean([p[1] for p in bbox_pts]))

        # Auto-detect unit: values > threshold are likely in centimeters
        if value > OCR_CM_THRESHOLD:
            value_m = value / 100.0
            unit = "cm"
        else:
            value_m = value
            unit = "m"

        dimensions.append({
            "text": text,
            "value_m": round(value_m, 3),
            "unit_detected": unit,
            "x": cx,
            "y": cy,
            "confidence": round(conf, 3),
            "bbox_pts": [[int(p[0]), int(p[1])] for p in bbox_pts],
        })

    return dimensions
