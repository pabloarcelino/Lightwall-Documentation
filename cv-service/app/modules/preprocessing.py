import cv2
import numpy as np
import fitz  # PyMuPDF


def pdf_to_image(pdf_bytes: bytes, dpi: int = 300) -> np.ndarray:
    """Convert a single PDF page to a high-DPI OpenCV BGR image using PyMuPDF."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, 3)
    doc.close()
    return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)


def preprocess(image: np.ndarray) -> dict:
    """Return multiple processed versions of the image for different pipeline stages.

    Returns dict with keys: original, gray, enhanced, binary, cleaned
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # CLAHE for contrast enhancement (helps with faded drawings)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # Adaptive threshold for binarization (handles uneven lighting)
    binary = cv2.adaptiveThreshold(
        enhanced, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        11, 2,
    )

    # Morphological cleanup to close small gaps in wall lines
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    cleaned = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)

    return {
        "original": image,
        "gray": gray,
        "enhanced": enhanced,
        "binary": binary,
        "cleaned": cleaned,
    }
