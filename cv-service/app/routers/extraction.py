"""Router de Extração (Fase E) — endpoints CV+ML pra detecção de envelope,
paredes e classificação semântica.

Todos os endpoints retornam um shape ESTÁVEL: o Node consome os mesmos
campos antes (mock) e depois (real). Implementações reais virão em
sessões dedicadas; por enquanto, retornam estrutura vazia + status="stub"
pra o Node poder fazer fallback automático pro pipeline Gemini atual.
"""
from typing import List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/extraction", tags=["extraction"])


# ============================================================
# Schemas (Pydantic — refletem ExtractedWall do Node)
# ============================================================

class Point(BaseModel):
    x: float = Field(..., ge=0, le=1000)
    y: float = Field(..., ge=0, le=1000)


class Endpoints(BaseModel):
    p1: Point
    p2: Point


class WallOut(BaseModel):
    id: str
    classe: str  # "externa" | "interna" | "muro"
    endpoints: Optional[Endpoints] = None
    bbox: Optional[List[float]] = None  # [ymin, xmin, ymax, xmax] 0-1000
    thickness_norm: float
    has_door: bool = False
    has_window: bool = False
    confidence: float = 0.5


class SlabOut(BaseModel):
    id: str
    classe: str  # "piso" | "coberta" | "radier"
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
    type: str  # "interno" | "externo_coberto" | "externo_descoberto" | "indeterminado"
    polygon: List[Point]
    confidence: float


class CotaOut(BaseModel):
    text: str
    value_m: float
    x: float
    y: float
    orientation: str  # "horizontal" | "vertical" | "unknown"
    confidence: float


class PageClassificationOut(BaseModel):
    page_index: int
    classe: str  # "planta_baixa" | "corte" | "fachada" | "vista_3d" | etc.
    confidence: float
    pavimentos: List[dict] = []  # [{tileIndex, pavimento, bbox}]


# ============================================================
# Request models
# ============================================================

class ClassifyPagesRequest(BaseModel):
    pdf_base64: str
    dpi: int = 300


class FullExtractionRequest(BaseModel):
    image_base64: str
    mime_type: str = "image/png"
    pavimento: str = "Terreo"
    # Quando o Node ja tem o envelope da Fase A (Gemini), passa aqui pro
    # CV usar como bootstrap; senao o CV detecta sozinho.
    envelope_hint: Optional[List[Point]] = None


class FullExtractionResponse(BaseModel):
    status: str  # "ok" | "stub" | "failed"
    pixels_per_meter: Optional[float] = None
    walls: List[WallOut] = []
    slabs: List[SlabOut] = []
    envelope: Optional[EnvelopeOut] = None
    rooms: List[RoomOut] = []
    cotas: List[CotaOut] = []
    notes: List[str] = []
    inference_ms: int = 0


# ============================================================
# Endpoints
# ============================================================

@router.post("/classify_pages", response_model=List[PageClassificationOut])
async def classify_pages(req: ClassifyPagesRequest):
    """Recebe um PDF base64, retorna classificacao de cada pagina + multi-tile detection.

    Fase E.0 STUB: retorna lista vazia com aviso. Node faz fallback pra
    classifyAndExtractTables atual (Gemini).
    """
    _ = req
    return []


@router.post("/full_extraction", response_model=FullExtractionResponse)
async def full_extraction(req: FullExtractionRequest):
    """Extração completa de uma planta_baixa: envelope + paredes + comodos + cotas.

    Fase E.2+ STUB: retorna status="stub". Node detecta isso e usa fallback.
    """
    _ = req
    return FullExtractionResponse(
        status="stub",
        notes=[
            "cv-service endpoint /extraction/full_extraction nao implementado ainda. "
            "Use pipeline Gemini (Fases A+B+D) ate Fase E.2 ficar pronta."
        ],
    )
