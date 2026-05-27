"""Router de Extração (Fase E) — endpoints CV+ML pra detecção de envelope,
paredes e classificação semântica.

Pipeline REAL: preprocessing → wall mask → wall extraction → envelope
detection → semantic OCR → topology classification.

Falhas em qualquer etapa fazem o endpoint retornar status="degraded" com
listas vazias nos campos que falharam. Node detecta isso e faz fallback
parcial pro pipeline Gemini.
"""
import base64
import time
from typing import List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

import cv2
import numpy as np

from app.modules.preprocessing import preprocess, pdf_to_image
from app.modules.wall_extractor import extract_walls_from_mask, WallSegment
from app.modules.envelope_detector import detect_envelope_multiscale, watershed_from_text_seeds
from app.modules.semantic_ocr import extract_semantic_texts
from app.modules.classifier import build_zones, classify_walls

router = APIRouter(prefix="/extraction", tags=["extraction"])


# ============================================================
# Schemas
# ============================================================

class Point(BaseModel):
    x: float = Field(..., ge=0, le=1000)
    y: float = Field(..., ge=0, le=1000)


class Endpoints(BaseModel):
    p1: Point
    p2: Point


class WallOut(BaseModel):
    id: str
    classe: str
    endpoints: Optional[Endpoints] = None
    bbox: Optional[List[float]] = None
    thickness_norm: float
    has_door: bool = False
    has_window: bool = False
    confidence: float = 0.5
    reason: Optional[str] = None
    needs_review: bool = False


class SlabOut(BaseModel):
    id: str
    classe: str
    polygon: List[Point]
    area_norm: float
    confidence: float = 0.5


class EnvelopeOut(BaseModel):
    pavimento: str
    polygon: List[Point]
    lot_polygon: Optional[List[Point]] = None
    confidence: float


class RoomOut(BaseModel):
    label: str
    type: str
    polygon: List[Point]
    confidence: float


class CotaOut(BaseModel):
    text: str
    value_m: float
    x: float
    y: float
    orientation: str
    confidence: float


class PageClassificationOut(BaseModel):
    page_index: int
    classe: str
    confidence: float
    pavimentos: List[dict] = []


# ============================================================
# Requests
# ============================================================

class ClassifyPagesRequest(BaseModel):
    pdf_base64: str
    dpi: int = 300


class FullExtractionRequest(BaseModel):
    image_base64: str
    mime_type: str = "image/png"
    pavimento: str = "Terreo"
    envelope_hint: Optional[List[Point]] = None


class FullExtractionResponse(BaseModel):
    status: str  # "ok" | "degraded" | "stub" | "failed"
    pixels_per_meter: Optional[float] = None
    walls: List[WallOut] = []
    slabs: List[SlabOut] = []
    envelope: Optional[EnvelopeOut] = None
    rooms: List[RoomOut] = []
    cotas: List[CotaOut] = []
    notes: List[str] = []
    inference_ms: int = 0


# ============================================================
# Helpers de conversao pixel → normalizado 0-1000
# ============================================================

def _px_to_norm(x: float, y: float, w: int, h: int) -> Point:
    return Point(
        x=max(0.0, min(1000.0, (x / max(w, 1)) * 1000)),
        y=max(0.0, min(1000.0, (y / max(h, 1)) * 1000)),
    )


def _polygon_to_norm(poly_px: List, w: int, h: int) -> List[Point]:
    return [_px_to_norm(p[0], p[1], w, h) for p in poly_px]


def _decode_image(image_base64: str, mime_type: str) -> Optional[np.ndarray]:
    """Decodifica base64 → numpy BGR. PDFs viram raster da primeira pagina."""
    try:
        raw = base64.b64decode(image_base64)
    except Exception:
        return None
    if mime_type == "application/pdf":
        try:
            return pdf_to_image(raw, dpi=300)
        except Exception:
            return None
    arr = np.frombuffer(raw, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


# ============================================================
# Endpoints
# ============================================================

@router.post("/classify_pages", response_model=List[PageClassificationOut])
async def classify_pages(req: ClassifyPagesRequest):
    """Recebe um PDF base64, retorna classificacao de cada pagina + multi-tile detection.

    STUB inicial — a classificacao de paginas continua via Gemini no Node
    (classifyAndExtractTables ja funciona bem). Futuro: substituir por
    classificador leve no cv-service.
    """
    _ = req
    return []


@router.post("/full_extraction", response_model=FullExtractionResponse)
async def full_extraction(req: FullExtractionRequest):
    """Extracao completa de uma planta_baixa:
      envelope + paredes + comodos + cotas + classificacao topologica.
    """
    t0 = time.time()
    notes: List[str] = []

    # 1. Decode da imagem.
    img = _decode_image(req.image_base64, req.mime_type)
    if img is None:
        return FullExtractionResponse(
            status="failed",
            notes=["nao foi possivel decodificar a imagem"],
            inference_ms=int((time.time() - t0) * 1000),
        )
    h, w = img.shape[:2]

    # 2. Preprocessing.
    try:
        prep = preprocess(img)
        wall_mask = prep["cleaned"]
    except Exception as e:
        return FullExtractionResponse(
            status="failed",
            notes=[f"preprocess falhou: {e}"],
            inference_ms=int((time.time() - t0) * 1000),
        )

    # 3. Envelope detection.
    envelope_out: Optional[EnvelopeOut] = None
    try:
        env_result = detect_envelope_multiscale(wall_mask)
        if env_result.polygon:
            envelope_out = EnvelopeOut(
                pavimento=req.pavimento,
                polygon=_polygon_to_norm(env_result.polygon, w, h),
                lot_polygon=None,
                confidence=env_result.confidence,
            )
            notes.extend(env_result.notes)
        else:
            notes.append("envelope nao detectado (CV)")
    except Exception as e:
        notes.append(f"envelope_detector erro: {e}")

    # 4. OCR semantico.
    semantic_texts = []
    try:
        semantic_texts = extract_semantic_texts(img)
    except Exception as e:
        notes.append(f"OCR semantico erro: {e}")

    rooms_out: List[RoomOut] = []
    cotas_out: List[CotaOut] = []
    room_seeds_px: List[tuple] = []

    for st in semantic_texts:
        if st.category == "dimension" and st.dimension_value_m is not None:
            cotas_out.append(CotaOut(
                text=st.text,
                value_m=st.dimension_value_m,
                x=(st.x / max(w, 1)) * 1000,
                y=(st.y / max(h, 1)) * 1000,
                orientation="unknown",
                confidence=st.confidence,
            ))
        elif st.category == "room_label" and st.room_type:
            room_seeds_px.append((st.x, st.y))
            # rooms reais sao geradas pela watershed abaixo; aqui salvamos
            # texto+tipo para casar depois.

    # 5. Watershed pra extrair poligonos dos comodos a partir dos seeds.
    try:
        if room_seeds_px:
            room_polys_px = watershed_from_text_seeds(wall_mask, room_seeds_px)
            # Casa cada poligono com o texto mais proximo do seu centroide.
            for i, ppx in enumerate(room_polys_px):
                if not ppx:
                    continue
                cx = sum(p[0] for p in ppx) / len(ppx)
                cy = sum(p[1] for p in ppx) / len(ppx)
                # Texto mais proximo.
                best_txt = None
                best_d = float("inf")
                for st in semantic_texts:
                    if st.category != "room_label":
                        continue
                    d = (st.x - cx) ** 2 + (st.y - cy) ** 2
                    if d < best_d:
                        best_d = d
                        best_txt = st
                if best_txt is None or best_txt.room_type is None:
                    continue
                rooms_out.append(RoomOut(
                    label=best_txt.text,
                    type=best_txt.room_type,
                    polygon=_polygon_to_norm(ppx, w, h),
                    confidence=best_txt.confidence,
                ))
    except Exception as e:
        notes.append(f"watershed comodos erro: {e}")

    # 6. Wall extraction (skeletonize + segmentos).
    walls_segments: List[WallSegment] = []
    try:
        walls_segments = extract_walls_from_mask(wall_mask, min_segment_len_px=25)
    except Exception as e:
        notes.append(f"wall_extractor erro: {e}")

    # 7. Topology classification (Shapely buffer/intersect).
    walls_out: List[WallOut] = []
    try:
        # Constroi zones em PIXELS (mesmo espaco das walls).
        envelope_px = env_result.polygon if envelope_out else []
        rooms_for_zones = []
        if room_seeds_px:
            # Re-monta usando poligonos brutos pixel (rooms_out ja esta normalizado).
            room_polys_px = watershed_from_text_seeds(wall_mask, room_seeds_px)
            for i, ppx in enumerate(room_polys_px):
                if not ppx:
                    continue
                # Acha texto mais proximo de novo
                cx = sum(p[0] for p in ppx) / len(ppx)
                cy = sum(p[1] for p in ppx) / len(ppx)
                best_txt = None
                best_d = float("inf")
                for st in semantic_texts:
                    if st.category != "room_label":
                        continue
                    d = (st.x - cx) ** 2 + (st.y - cy) ** 2
                    if d < best_d:
                        best_d = d
                        best_txt = st
                if best_txt is None or best_txt.room_type is None:
                    continue
                rooms_for_zones.append({
                    "polygon": ppx,
                    "room_type": best_txt.room_type,
                    "label": best_txt.text,
                })

        zones = build_zones(envelope=envelope_px, rooms=rooms_for_zones, lot=None)

        walls_dict = [{
            "id": ws.id,
            "p1": ws.p1,
            "p2": ws.p2,
            "thickness_px": ws.thickness_px,
        } for ws in walls_segments]
        classifications = classify_walls(walls_dict, zones)
        cls_by_id = {c.wall_id: c for c in classifications}

        for ws in walls_segments:
            cls = cls_by_id.get(ws.id)
            classe = cls.classe if cls else "externa"
            reason = cls.reason if cls else None
            needs_review = cls.needs_review if cls else False
            walls_out.append(WallOut(
                id=ws.id,
                classe=classe,
                endpoints=Endpoints(
                    p1=_px_to_norm(ws.p1[0], ws.p1[1], w, h),
                    p2=_px_to_norm(ws.p2[0], ws.p2[1], w, h),
                ),
                thickness_norm=(ws.thickness_px / max(w, h)) * 1000,
                has_door=ws.has_door_gap,
                has_window=ws.has_window_gap,
                confidence=ws.confidence,
                reason=reason,
                needs_review=needs_review,
            ))
    except Exception as e:
        notes.append(f"classify_walls erro: {e}")
        # Sem classificacao, devolve walls com classe default "externa".
        for ws in walls_segments:
            walls_out.append(WallOut(
                id=ws.id,
                classe="externa",
                endpoints=Endpoints(
                    p1=_px_to_norm(ws.p1[0], ws.p1[1], w, h),
                    p2=_px_to_norm(ws.p2[0], ws.p2[1], w, h),
                ),
                thickness_norm=(ws.thickness_px / max(w, h)) * 1000,
                confidence=ws.confidence,
                needs_review=True,
            ))

    # 8. Status: tudo OK se tem walls + envelope; degradado caso contrario.
    if walls_out and envelope_out:
        status = "ok"
    elif walls_out or envelope_out:
        status = "degraded"
    else:
        status = "failed"

    return FullExtractionResponse(
        status=status,
        pixels_per_meter=None,  # E.2 stretch: scale_calibrator real.
        walls=walls_out,
        slabs=[],  # E.4 stretch: slabs via watershed.
        envelope=envelope_out,
        rooms=rooms_out,
        cotas=cotas_out,
        notes=notes,
        inference_ms=int((time.time() - t0) * 1000),
    )
