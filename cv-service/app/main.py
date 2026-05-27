from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import health, analyze, annotate, extraction

app = FastAPI(title="Lightwall CV Pipeline", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(analyze.router)
app.include_router(annotate.router)
# Fase E: novos endpoints CV/ML focados (classify_pages, full_extraction).
# Retornam status="stub" ate as implementacoes reais ficarem prontas;
# o Node consome com fallback automatico pro pipeline Gemini atual.
app.include_router(extraction.router)
