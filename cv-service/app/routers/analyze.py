import asyncio
import traceback

from fastapi import APIRouter, HTTPException

from app.models import AnalyzeRequest, AnalyzeResponse, GeometryResult
from app.modules.preprocessing import pdf_to_image, preprocess
from app.modules.ocr import extract_dimensions
from app.modules.geometry import detect_wall_lines, compute_wall_bboxes
from app.modules.slab_detector import detect_enclosed_regions
from app.modules.spatial_reasoning import classify_with_gemini
from app.modules.renderer import render_annotated_image
from app.utils.image_utils import decode_base64_image, bytes_to_cv2, cv2_to_base64_dataurl

router = APIRouter()


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_floor_plan(request: AnalyzeRequest):
    """Full CV pipeline: preprocess → OCR → Hough → Gemini reasoning → render."""
    try:
        # 1. Decode image
        image_bytes = decode_base64_image(request.image_base64)
        if request.mime_type == "application/pdf":
            image = pdf_to_image(image_bytes)
        else:
            image = bytes_to_cv2(image_bytes)

        h, w = image.shape[:2]
        print(f"[CV] Image size: {w}x{h}, pavimento: {request.pavimento}")

        # 2. Preprocess (binarize, enhance contrast)
        processed = preprocess(image)

        # 3. OCR — extract dimension texts (run in thread to not block async)
        loop = asyncio.get_event_loop()
        ocr_results = await loop.run_in_executor(
            None, extract_dimensions, processed["enhanced"]
        )
        print(f"[CV] OCR found {len(ocr_results)} dimension texts")

        # 4. Detect wall lines via Hough Transform
        wall_lines = detect_wall_lines(processed["cleaned"])
        wall_lines = compute_wall_bboxes(wall_lines, w, h)
        print(f"[CV] Hough detected {len(wall_lines)} wall segments")

        # 5. Detect enclosed regions (rooms/slabs)
        regions = detect_enclosed_regions(processed["binary"], w, h)
        print(f"[CV] Connected components found {len(regions)} enclosed regions")

        # 6. Send structured CV data + image to Gemini for classification
        # Use raw base64 (without data URL prefix) for Gemini
        raw_b64 = request.image_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]

        geometry = await classify_with_gemini(
            original_image_base64=raw_b64,
            mime_type=request.mime_type,
            wall_lines=wall_lines,
            ocr_dimensions=ocr_results,
            enclosed_regions=regions,
            img_width=w,
            img_height=h,
            pavimento=request.pavimento,
            building_type=request.building_type,
            api_key_override=request.gemini_api_key,
        )
        print(f"[CV] Gemini returned {len(geometry.walls)} walls, {len(geometry.slabs)} slabs, {len(geometry.corners)} corners")

        # 7. Render annotated image deterministically
        annotated = render_annotated_image(image.copy(), geometry.walls, geometry.slabs)
        annotated_b64 = cv2_to_base64_dataurl(annotated)

        return AnalyzeResponse(
            geometry=geometry,
            annotated_image_base64=annotated_b64,
            cv_metadata={
                "ocr_count": len(ocr_results),
                "line_count": len(wall_lines),
                "region_count": len(regions),
                "image_size": {"width": w, "height": h},
                "ocr_sample": ocr_results[:5],
            },
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Pipeline error: {str(e)[:300]}")
