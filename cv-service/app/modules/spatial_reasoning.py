import json
import re
from typing import List

from google import genai

from app.config import GEMINI_MODEL, get_gemini_api_key
from app.models import GeometryResult, ExtractedWall, ExtractedSlab, ExtractedCorner, WallEsquadria


async def classify_with_gemini(
    original_image_base64: str,
    mime_type: str,
    wall_lines: List[dict],
    ocr_dimensions: List[dict],
    enclosed_regions: List[dict],
    img_width: int,
    img_height: int,
    pavimento: str,
    building_type: str,
    api_key_override: str | None = None,
) -> GeometryResult:
    """Send CV-extracted structured data + original image to Gemini for spatial reasoning.

    The key advantage: Gemini receives pre-extracted data (lines, texts, regions)
    so it can focus on classification and correlation instead of raw detection.
    """
    api_key = get_gemini_api_key(api_key_override)

    # Prepare structured CV data for the prompt
    # Limit arrays to avoid token overflow
    cv_data = {
        "image_size": {"width": img_width, "height": img_height},
        "detected_wall_segments": wall_lines[:100],
        "ocr_dimensions": ocr_dimensions[:80],
        "enclosed_regions": [
            {"label": r["label"], "area_px": r["area_px"], "bbox": r["bbox_normalized"], "centroid": r["centroid"]}
            for r in enclosed_regions[:30]
        ],
    }

    structured_json = json.dumps(cv_data, indent=2, ensure_ascii=False)

    prompt = f"""Voce e um engenheiro orcamentista analisando uma planta baixa arquitetonica.

DADOS EXTRAIDOS POR COMPUTER VISION (OpenCV + EasyOCR):
{structured_json}

Com base na imagem E nos dados CV acima, faca:

1. PAREDES: Correlacione os segmentos de linha detectados com as cotas OCR mais proximas para determinar comprimentos reais em metros. Classifique cada parede:
   - "externa": forma o contorno externo da edificacao coberta
   - "interna": divide comodos DENTRO do contorno
   - "muro": fora da edificacao (divisa de terreno, jardim)

2. ESQUADRIAS: Identifique portas (arcos) e janelas (tracos paralelos) na imagem. Associe a parede correspondente. Se nao encontrar dimensoes, use padroes: porta 0.80x2.10m, janela 1.20x1.00m.

3. LAJES: Use as regioes fechadas (enclosed_regions) para calcular a area total do pavimento.
   - Terreo: "radier" (fundacao)
   - Ultimo pav: "coberta" (se laje concreto, nao telhado)
   - Intermediario: "piso"

4. CANTOS: Conte cantos de 90 graus no perimetro externo.

Pavimento: {pavimento} | Tipo: {building_type}

Retorne APENAS o JSON (sem explicacao):
{{
  "walls": [
    {{"id": "P1", "nivel": "{pavimento}", "classe": "externa|interna|muro", "comprimento_m": 0.0, "altura_m": 3.0, "espessura_m": 0.10, "measurement_source": "cv_ocr|cv_inferred", "confidence": 0.9, "has_door": false, "has_window": false, "opening_area_m2": 0.0, "esquadrias": [], "box_2d": [ymin, xmin, ymax, xmax]}}
  ],
  "slabs": [
    {{"id": "L1", "nivel": "{pavimento}", "classe": "radier|piso|coberta", "area_m2": 0.0, "measurement_source": "cv_area", "confidence": 0.9}}
  ],
  "corners": [
    {{"id": "C1", "nivel": "{pavimento}", "qtd_cantos": 0}}
  ]
}}

box_2d: coordenadas normalizadas 0-1000 [ymin, xmin, ymax, xmax]."""

    client = genai.Client(api_key=api_key)

    response = await client.aio.models.generate_content(
        model=GEMINI_MODEL,
        contents=[
            {"inline_data": {"mime_type": mime_type, "data": original_image_base64}},
            {"text": prompt},
        ],
        config={
            "temperature": 0.1,
            "max_output_tokens": 65536,
            "thinking_config": {"thinking_budget": 32768},
        },
    )

    return _parse_geometry_response(response.text or "", pavimento)


def _parse_geometry_response(text: str, default_nivel: str) -> GeometryResult:
    """Parse Gemini's JSON response into GeometryResult, with repair logic."""
    # Strip reasoning tags if present
    reasoning_match = re.search(r"<RACIOCINIO>[\s\S]*?</RACIOCINIO>", text)
    if reasoning_match:
        text = text[reasoning_match.end():]

    # Find JSON
    json_match = re.search(r"\{[\s\S]*\}", text)
    if not json_match:
        return GeometryResult()

    try:
        parsed = json.loads(json_match.group())
    except json.JSONDecodeError:
        parsed = _repair_json(json_match.group())
        if parsed is None:
            return GeometryResult()

    walls = []
    for w in parsed.get("walls", []):
        bbox = w.get("box_2d") or w.get("bbox") or None
        if isinstance(bbox, list) and len(bbox) == 4:
            bbox = tuple(int(v) for v in bbox)
        else:
            bbox = None

        esquadrias = []
        for e in w.get("esquadrias", []):
            esquadrias.append(WallEsquadria(
                tipo=e.get("tipo", "porta"),
                codigo=e.get("codigo", ""),
                largura_m=float(e.get("largura_m", 0)),
                altura_m=float(e.get("altura_m", 0)),
                peitoril_m=e.get("peitoril_m"),
                measurement_source=e.get("measurement_source", "cv_pipeline"),
            ))

        classe = w.get("classe", "externa")
        if classe not in ("externa", "interna", "muro"):
            classe = "externa"

        walls.append(ExtractedWall(
            id=w.get("id", f"P{len(walls)+1}"),
            nivel=w.get("nivel", default_nivel),
            classe=classe,
            comprimento_m=float(w.get("comprimento_m", 0)),
            altura_m=float(w.get("altura_m", 3.0)),
            espessura_m=float(w.get("espessura_m", 0.10)),
            measurement_source=w.get("measurement_source", "cv_pipeline"),
            confidence=float(w.get("confidence", 0.7)),
            has_door=bool(w.get("has_door", False)),
            has_window=bool(w.get("has_window", False)),
            opening_area_m2=float(w.get("opening_area_m2", 0)),
            esquadrias=esquadrias,
            bbox=bbox,
        ))

    slabs = []
    for s in parsed.get("slabs", []):
        classe = s.get("classe", "piso")
        if classe not in ("coberta", "piso", "radier"):
            classe = "piso"
        slabs.append(ExtractedSlab(
            id=s.get("id", f"L{len(slabs)+1}"),
            nivel=s.get("nivel", default_nivel),
            classe=classe,
            area_m2=float(s.get("area_m2", 0)),
            measurement_source=s.get("measurement_source", "cv_pipeline"),
            confidence=float(s.get("confidence", 0.7)),
        ))

    corners = []
    for c in parsed.get("corners", []):
        corners.append(ExtractedCorner(
            id=c.get("id", f"C{len(corners)+1}"),
            nivel=c.get("nivel", default_nivel),
            qtd_cantos=int(c.get("qtd_cantos", 0)),
        ))

    return GeometryResult(walls=walls, slabs=slabs, corners=corners)


def _repair_json(json_str: str):
    """Attempt to repair truncated or malformed JSON."""
    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        pass

    try:
        # Remove trailing comma before closing brackets
        repaired = re.sub(r",\s*\]", "]", json_str)
        repaired = re.sub(r",\s*\}", "}", repaired)

        # Balance braces
        open_braces = repaired.count("{") - repaired.count("}")
        open_brackets = repaired.count("[") - repaired.count("]")
        repaired += "]" * max(0, open_brackets)
        repaired += "}" * max(0, open_braces)

        return json.loads(repaired)
    except (json.JSONDecodeError, Exception):
        return None
