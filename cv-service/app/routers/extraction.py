"""Router de Extração (Fase E) — endpoints CV+ML pra detecção de envelope,
paredes e classificação semântica.

Pipeline REAL: preprocessing → wall mask → wall extraction → envelope
detection → semantic OCR → topology classification.

Falhas em qualquer etapa fazem o endpoint retornar status="degraded" com
listas vazias nos campos que falharam. Node detecta isso e faz fallback
parcial pro pipeline Gemini.
"""
import asyncio
import base64
import json
import time
from typing import Callable, List, Optional
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import cv2
import numpy as np

from app.modules.preprocessing import preprocess, pdf_to_image
from app.modules.wall_extractor import extract_walls_from_mask, WallSegment
from app.modules.envelope_detector import detect_envelope_multiscale, watershed_from_text_seeds
from app.modules.semantic_ocr import extract_semantic_texts
from app.modules.classifier import build_zones, classify_walls

router = APIRouter(prefix="/extraction", tags=["extraction"])

# Callback opcional pra reportar progresso sub-etapa por sub-etapa quando
# rodando em modo streaming. Recebe (substep, phase, **extra_fields).
# Em modo sincrono o callback e None e o pipeline corre sem reportar.
ProgressCallback = Optional[Callable[..., None]]


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


def _run_full_extraction(
    req: FullExtractionRequest,
    progress: ProgressCallback = None,
) -> FullExtractionResponse:
    """Core do pipeline CV. Quando `progress` e definido, reporta cada sub-etapa
    via callback `(substep, phase, **extra)`. Usado tanto pelo endpoint sincrono
    quanto pelo streaming."""
    def emit(substep: str, phase: str, **extra):
        if progress is not None:
            try:
                progress(substep, phase, **extra)
            except Exception:
                pass

    t0 = time.time()
    notes: List[str] = []

    # 1. Decode da imagem.
    emit("preprocess", "started")
    img = _decode_image(req.image_base64, req.mime_type)
    if img is None:
        emit("preprocess", "failed", error="decode falhou")
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
        emit("preprocess", "completed", width=w, height=h)
    except Exception as e:
        emit("preprocess", "failed", error=str(e))
        return FullExtractionResponse(
            status="failed",
            notes=[f"preprocess falhou: {e}"],
            inference_ms=int((time.time() - t0) * 1000),
        )

    # 3. Envelope detection.
    emit("envelope", "started")
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
        emit(
            "envelope",
            "completed",
            detected=envelope_out is not None,
            vertices=len(env_result.polygon) if env_result.polygon else 0,
        )
    except Exception as e:
        notes.append(f"envelope_detector erro: {e}")
        emit("envelope", "failed", error=str(e))

    # 4. OCR semantico.
    emit("ocr", "started")
    semantic_texts = []
    try:
        semantic_texts = extract_semantic_texts(img)
        emit("ocr", "completed", text_count=len(semantic_texts))
    except Exception as e:
        notes.append(f"OCR semantico erro: {e}")
        emit("ocr", "failed", error=str(e))

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
    emit("wall_detect", "started")
    walls_segments: List[WallSegment] = []
    try:
        walls_segments = extract_walls_from_mask(wall_mask, min_segment_len_px=25)
        emit("wall_detect", "completed", segment_count=len(walls_segments))
    except Exception as e:
        notes.append(f"wall_extractor erro: {e}")
        emit("wall_detect", "failed", error=str(e))

    # 7. Topology classification (Shapely buffer/intersect).
    emit("classify", "started")
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

    emit("classify", "completed", wall_count=len(walls_out))

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


@router.post("/full_extraction", response_model=FullExtractionResponse)
async def full_extraction(req: FullExtractionRequest):
    """Extracao completa de uma planta_baixa:
      envelope + paredes + comodos + cotas + classificacao topologica.
    """
    return _run_full_extraction(req)


@router.post("/full_extraction/stream")
async def full_extraction_stream(req: FullExtractionRequest):
    """Variante SSE de /full_extraction. Emite eventos por sub-etapa via
    text/event-stream, e termina com um evento "result" contendo o JSON
    completo (mesmo shape de FullExtractionResponse).

    Formato:
      event: substep
      data: {"substep": "preprocess", "phase": "started", ...}

      event: result
      data: {...FullExtractionResponse...}

    Cliente Node escuta os eventos "substep" e ecoa como `cv_substep` no
    canal SSE do projeto; usa o "result" como output final, equivalente a
    /full_extraction sincrono.
    """
    queue: asyncio.Queue = asyncio.Queue()

    def progress(substep: str, phase: str, **extra):
        # Coloca evento na fila sem bloquear (loop async drena depois).
        try:
            queue.put_nowait({"substep": substep, "phase": phase, **extra})
        except Exception:
            pass

    async def run_pipeline_and_finish():
        loop = asyncio.get_event_loop()
        try:
            # Pipeline e CPU-bound: roda num thread pra nao bloquear o event loop.
            result = await loop.run_in_executor(None, _run_full_extraction, req, progress)
            await queue.put({"__final__": result.dict()})
        except Exception as e:
            await queue.put({"__error__": str(e)})

    async def event_stream():
        task = asyncio.create_task(run_pipeline_and_finish())
        try:
            while True:
                msg = await queue.get()
                if "__final__" in msg:
                    yield f"event: result\ndata: {json.dumps(msg['__final__'])}\n\n"
                    break
                if "__error__" in msg:
                    yield f"event: error\ndata: {json.dumps({'error': msg['__error__']})}\n\n"
                    break
                yield f"event: substep\ndata: {json.dumps(msg)}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
