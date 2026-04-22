import base64
import numpy as np
import cv2


def decode_base64_image(b64_string: str) -> bytes:
    """Decode base64 string to raw bytes."""
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]
    return base64.b64decode(b64_string)


def bytes_to_cv2(image_bytes: bytes) -> np.ndarray:
    """Convert raw image bytes to OpenCV BGR numpy array."""
    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Failed to decode image bytes")
    return image


def cv2_to_base64_dataurl(image: np.ndarray, fmt: str = ".png") -> str:
    """Convert OpenCV image to base64 data URL."""
    success, buffer = cv2.imencode(fmt, image)
    if not success:
        raise ValueError("Failed to encode image")
    b64 = base64.b64encode(buffer).decode("utf-8")
    mime = "image/png" if fmt == ".png" else "image/jpeg"
    return f"data:{mime};base64,{b64}"


def cv2_to_base64(image: np.ndarray, fmt: str = ".png") -> str:
    """Convert OpenCV image to raw base64 string (no data URL prefix)."""
    success, buffer = cv2.imencode(fmt, image)
    if not success:
        raise ValueError("Failed to encode image")
    return base64.b64encode(buffer).decode("utf-8")
