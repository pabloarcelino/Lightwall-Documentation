from app.config import BBOX_NORMALIZE_RANGE


def pixel_to_normalized(x: int, y: int, img_width: int, img_height: int) -> tuple[int, int]:
    """Convert pixel coordinates to normalized 0-1000 range."""
    nx = int(x / img_width * BBOX_NORMALIZE_RANGE)
    ny = int(y / img_height * BBOX_NORMALIZE_RANGE)
    return min(max(nx, 0), BBOX_NORMALIZE_RANGE), min(max(ny, 0), BBOX_NORMALIZE_RANGE)


def normalized_to_pixel(nx: int, ny: int, img_width: int, img_height: int) -> tuple[int, int]:
    """Convert normalized 0-1000 coordinates to pixel coordinates."""
    x = int(nx / BBOX_NORMALIZE_RANGE * img_width)
    y = int(ny / BBOX_NORMALIZE_RANGE * img_height)
    return x, y


def bbox_pixel_to_normalized(
    ymin: int, xmin: int, ymax: int, xmax: int,
    img_width: int, img_height: int,
) -> tuple[int, int, int, int]:
    """Convert pixel bbox [ymin, xmin, ymax, xmax] to normalized 0-1000."""
    nxmin, nymin = pixel_to_normalized(xmin, ymin, img_width, img_height)
    nxmax, nymax = pixel_to_normalized(xmax, ymax, img_width, img_height)
    return nymin, nxmin, nymax, nxmax


def bbox_normalized_to_pixel(
    ymin: int, xmin: int, ymax: int, xmax: int,
    img_width: int, img_height: int,
) -> tuple[int, int, int, int]:
    """Convert normalized bbox [ymin, xmin, ymax, xmax] to pixel coordinates."""
    px_xmin, px_ymin = normalized_to_pixel(xmin, ymin, img_width, img_height)
    px_xmax, px_ymax = normalized_to_pixel(xmax, ymax, img_width, img_height)
    return px_ymin, px_xmin, px_ymax, px_xmax
