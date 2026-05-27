"""CubiCasa5K wrapper — Fase E.2 da metodologia Lightwall.

Carrega o modelo pré-treinado CubiCasa5K (Kalervo et al., 2019, MIT) e
roda inferência em uma imagem rasterizada de planta baixa. Retorna masks
de walls / rooms / doors / windows + room types.

Repositório de referência: https://github.com/CubiCasa/CubiCasa5k

Os pesos do modelo (~95MB) NÃO entram no repo. São baixados sob demanda
para `cv-service/models/cubicasa5k.pkl` na primeira chamada.

STUB inicial. Implementação real quando o download dos pesos + import do
torch estiverem habilitados no requirements (comentado por padrão).
"""
from typing import Dict, Optional
from dataclasses import dataclass

import numpy as np


@dataclass
class CubicasaResult:
    wall_mask: np.ndarray            # uint8 (0/255)
    room_mask: np.ndarray            # uint8 com label por cômodo (cores diferentes)
    door_mask: np.ndarray
    window_mask: np.ndarray
    room_labels: Dict[int, str]      # cor → tipo de cômodo (Sala, Quarto, Banho, etc.)
    inference_ms: int


_MODEL_CACHE: Optional[object] = None


def load_model(weights_path: str = "cv-service/models/cubicasa5k.pkl"):
    """Carrega pesos do CubiCasa5K. Lazy + cached."""
    global _MODEL_CACHE
    if _MODEL_CACHE is not None:
        return _MODEL_CACHE
    # TODO Fase E.2:
    #   1. Verifica se weights_path existe; se não, baixar do release oficial.
    #   2. import torch; model = HourglassNet(num_classes=...); model.load_state_dict(...)
    #   3. model.eval(); _MODEL_CACHE = model; return _MODEL_CACHE.
    raise NotImplementedError(
        "CubiCasa5K nao habilitado. Descomente torch/torchvision em requirements.txt "
        "e implemente o loader. Veja https://github.com/CubiCasa/CubiCasa5k."
    )


def infer(image: np.ndarray) -> CubicasaResult:
    """Roda forward pass na imagem rasterizada da planta."""
    _ = image
    # TODO Fase E.2.
    raise NotImplementedError("cubicasa_inference.infer ainda nao implementado (Fase E.2 stub).")
