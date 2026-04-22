from pydantic import BaseModel
from typing import List, Optional, Literal, Tuple, Any


class WallEsquadria(BaseModel):
    tipo: Literal["porta", "janela"]
    codigo: str = ""
    largura_m: float = 0.0
    altura_m: float = 0.0
    peitoril_m: Optional[float] = None
    measurement_source: str = "cv_pipeline"


class ExtractedWall(BaseModel):
    id: str
    nivel: str
    classe: Literal["externa", "interna", "muro"]
    comprimento_m: float
    altura_m: float = 3.0
    espessura_m: float = 0.10
    measurement_source: str = "cv_pipeline"
    confidence: float = 0.7
    has_door: bool = False
    has_window: bool = False
    opening_area_m2: float = 0.0
    esquadrias: List[WallEsquadria] = []
    bbox: Optional[Tuple[int, int, int, int]] = None  # [ymin, xmin, ymax, xmax] 0-1000
    page_index: Optional[int] = None


class ExtractedSlab(BaseModel):
    id: str
    nivel: str
    classe: Literal["coberta", "piso", "radier"]
    area_m2: float
    measurement_source: str = "cv_pipeline"
    confidence: float = 0.7


class ExtractedCorner(BaseModel):
    id: str
    nivel: str
    qtd_cantos: int


class GeometryResult(BaseModel):
    walls: List[ExtractedWall] = []
    slabs: List[ExtractedSlab] = []
    corners: List[ExtractedCorner] = []


class AnalyzeRequest(BaseModel):
    image_base64: str
    mime_type: str = "image/png"
    pavimento: str = "Terreo"
    building_type: str = "residencial"
    gemini_api_key: Optional[str] = None
    page_index: int = 0


class AnalyzeResponse(BaseModel):
    geometry: GeometryResult
    annotated_image_base64: str
    cv_metadata: dict = {}


class AnnotateRequest(BaseModel):
    image_base64: str
    mime_type: str = "image/png"
    walls: List[ExtractedWall] = []
    slabs: List[ExtractedSlab] = []


class AnnotateResponse(BaseModel):
    annotated_image_base64: str
