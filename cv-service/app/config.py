import os

# Color scheme matching the existing TypeScript system
COLORS = {
    "externa": {"hex": "#dc2626", "bgr": (38, 38, 220),  "rgb": (220, 38, 38)},
    "interna": {"hex": "#16a34a", "bgr": (74, 163, 22),  "rgb": (22, 163, 74)},
    "muro":    {"hex": "#1d4ed8", "bgr": (216, 78, 29),  "rgb": (29, 78, 216)},
    "piso":    {"hex": "#10b981", "bgr": (129, 185, 16), "rgb": (16, 185, 129)},
    "coberta": {"hex": "#f97316", "bgr": (22, 115, 249), "rgb": (249, 115, 22)},
    "radier":  {"hex": "#10b981", "bgr": (129, 185, 16), "rgb": (16, 185, 129)},
}

BBOX_NORMALIZE_RANGE = 1000

GEMINI_MODEL = "gemini-2.5-pro"

OVERLAY_ALPHA = 0.35
BORDER_THICKNESS = 3
FONT_SCALE = 0.5
FONT_THICKNESS = 2

# Hough Transform parameters
HOUGH_THRESHOLD = 80
HOUGH_MIN_LINE_LENGTH = 50
HOUGH_MAX_LINE_GAP = 10
WALL_ANGLE_TOLERANCE = 15  # degrees from horizontal/vertical

# OCR
OCR_CM_THRESHOLD = 20  # values above this are assumed centimeters

# Slab detection
SLAB_MIN_AREA_RATIO = 0.005
SLAB_MAX_AREA_RATIO = 0.80

def get_gemini_api_key(override: str | None = None) -> str:
    key = override or os.getenv("GEMINI_API_KEY", "")
    if not key:
        raise ValueError("No Gemini API key available")
    return key
