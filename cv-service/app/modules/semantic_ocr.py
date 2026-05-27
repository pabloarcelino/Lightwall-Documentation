"""Semantic OCR — Fase E.3 da metodologia Lightwall.

Roda OCR (EasyOCR primary; PaddleOCR opcional) e CLASSIFICA cada texto
extraido em categorias usando dicionario de tipologia residencial
brasileira:

  - room_label: nome de comodo (Sala, Quarto, Banho, etc).
  - dimension: cota numerica (4,64m; 350; 0.80).
  - door_window_code: codigo P1, J2, JV3 do quadro de esquadrias.
  - title_block: textos do carimbo/legenda (ESCALA, PRANCHA, etc).
  - other: irrelevante para a pipeline.

Cada room_label e classificado em type:
  - interno: paredes ao redor sao 100% internas (sala, quarto, banho, ...).
  - externo_coberto: contribui pra envelope mas TOCA externo (varanda, garagem).
  - externo_descoberto: NAO ENTRA no envelope (jardim, piscina).

Princípio: o LLM le formas (OCR), o codigo classifica semantica.
"""
import re
from typing import List, Optional, Tuple
from dataclasses import dataclass, field

import numpy as np

from app.modules.ocr import get_ocr_reader


# ============================================================
# Dicionario de tipologia residencial brasileira
# ============================================================

INTERNAL_ROOMS = {
    "sala", "estar", "jantar", "tv", "sala de estar", "sala de jantar", "sala de tv",
    "quarto", "dormitorio", "dormitório", "suite", "suíte", "ste",
    "cozinha", "copa",
    "banho", "banheiro", "bwc", "wc", "lavabo", "sanitario", "sanitário",
    "lavanderia", "area de servico", "área de serviço", "as",
    "dispensa", "despensa",
    "hall", "corredor", "circulacao", "circulação", "passagem",
    "escritorio", "escritório", "office", "home office",
    "closet", "vestiario", "vestiário",
    "biblioteca", "estudio", "estúdio",
    "deposito", "depósito", "storage",
    "escada", "escadas",
    "elevador",
    "shaft",
}

EXTERNAL_COVERED_ROOMS = {
    # Estes espaços ENTRAM no envelope da edificacao coberta, mas tocam
    # exterior (variavel termico, agua, vento).
    "varanda", "sacada", "balcao", "balcão", "terraco coberto", "terraço coberto",
    "garagem", "abrigo", "carport",
    "santuario", "santuário",  # mencionado pelo usuario
    "alpendre", "varandao", "varandão",
    "pergolado coberto", "passarela coberta",
}

EXTERNAL_UNCOVERED_ROOMS = {
    # NAO entram no envelope.
    "jardim", "quintal", "patio", "pátio",
    "piscina", "espelho dagua", "espelho d'água",
    "churrasqueira", "deck",
    "estacionamento", "estacionamento externo",
    "horta", "canteiro",
    "rua", "calcada", "calçada", "acesso",
}

TITLE_BLOCK_KEYWORDS = {
    "escala", "data", "prancha", "projeto", "obra", "responsavel", "responsável",
    "arquiteto", "engenheiro", "cliente", "endereco", "endereço",
    "norte", "n", "n.",
}

DOOR_WINDOW_PATTERN = re.compile(r"^[PJ][A-Z]?\s*\d{1,3}$", re.IGNORECASE)
# Aceita "P1", "J2", "JV3", "PR4", etc.


# ============================================================
# Resultado tipado
# ============================================================

@dataclass
class SemanticText:
    text: str
    text_normalized: str
    category: str  # "room_label" | "dimension" | "door_window_code" | "title_block" | "other"
    room_type: Optional[str] = None  # "interno" | "externo_coberto" | "externo_descoberto"
    dimension_value_m: Optional[float] = None
    x: int = 0
    y: int = 0
    bbox: List[Tuple[int, int]] = field(default_factory=list)
    confidence: float = 0.0


# ============================================================
# Classificacao
# ============================================================

def normalize_text(text: str) -> str:
    """Lowercase, remove acentos, colapsa espacos."""
    import unicodedata
    nfkd = unicodedata.normalize("NFKD", text.lower().strip())
    no_accents = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", no_accents)


def classify_text(text: str) -> Tuple[str, Optional[str], Optional[float]]:
    """Classifica um texto extraido em (category, room_type, dimension_value_m).

    Retorna 3-tupla:
      category in {"room_label", "dimension", "door_window_code", "title_block", "other"}.
      room_type in {"interno", "externo_coberto", "externo_descoberto", None}.
      dimension_value_m: float ou None.
    """
    if not text or not text.strip():
        return "other", None, None

    normalized = normalize_text(text)

    # 1. Cota numerica (4.64m, 350, 0.80, "4,64")
    cleaned = normalized.replace(",", ".").replace(" ", "").replace("m", "")
    if re.match(r"^\d+(\.\d+)?$", cleaned):
        try:
            value = float(cleaned)
            if value <= 0 or value > 50:
                return "other", None, None
            # cm vs m: > 30 e cm
            value_m = value / 100.0 if value > 30 else value
            return "dimension", None, value_m
        except ValueError:
            pass

    # 2. Codigo de esquadria
    if DOOR_WINDOW_PATTERN.match(normalized.replace(" ", "")):
        return "door_window_code", None, None

    # 3. Comodo interno
    for kw in INTERNAL_ROOMS:
        if kw in normalized:
            return "room_label", "interno", None

    # 4. Comodo externo coberto
    for kw in EXTERNAL_COVERED_ROOMS:
        if kw in normalized:
            return "room_label", "externo_coberto", None

    # 5. Comodo externo descoberto
    for kw in EXTERNAL_UNCOVERED_ROOMS:
        if kw in normalized:
            return "room_label", "externo_descoberto", None

    # 6. Carimbo
    for kw in TITLE_BLOCK_KEYWORDS:
        if kw in normalized:
            return "title_block", None, None

    return "other", None, None


def extract_semantic_texts(image: np.ndarray) -> List[SemanticText]:
    """Roda OCR + classificacao semantica.

    Returns:
        Lista de SemanticText com category preenchida.
    """
    reader = get_ocr_reader()
    raw_results = reader.readtext(image, detail=1)
    semantic: List[SemanticText] = []
    for bbox_pts, text, conf in raw_results:
        cx = int(np.mean([p[0] for p in bbox_pts]))
        cy = int(np.mean([p[1] for p in bbox_pts]))
        category, room_type, dim_value = classify_text(text)
        semantic.append(SemanticText(
            text=text,
            text_normalized=normalize_text(text),
            category=category,
            room_type=room_type,
            dimension_value_m=dim_value,
            x=cx,
            y=cy,
            bbox=[(int(p[0]), int(p[1])) for p in bbox_pts],
            confidence=float(conf),
        ))
    return semantic
