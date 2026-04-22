import traceback

from fastapi import APIRouter, HTTPException

from app.models import AnnotateRequest, AnnotateResponse
from app.modules.preprocessing import pdf_to_image
from app.modules.renderer import render_annotated_image
from app.utils.image_utils import decode_base64_image, bytes_to_cv2, cv2_to_base64_dataurl

router = APIRouter()


@router.post("/annotate", response_model=AnnotateResponse)
async def annotate_floor_plan(request: AnnotateRequest):
    """Render-only endpoint: draw annotations on image without re-running CV detection.

    Use this for fast re-annotation after user edits walls in the frontend.
    """
    try:
        image_bytes = decode_base64_image(request.image_base64)
        if request.mime_type == "application/pdf":
            image = pdf_to_image(image_bytes)
        else:
            image = bytes_to_cv2(image_bytes)

        annotated = render_annotated_image(image, request.walls, request.slabs)
        annotated_b64 = cv2_to_base64_dataurl(annotated)

        return AnnotateResponse(annotated_image_base64=annotated_b64)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Annotation error: {str(e)[:300]}")
