from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.analysis import router as analysis_router
from app.api.ingestion import router as ingestion_router
from app.core.config import get_settings


settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0", docs_url="/docs", redoc_url="/redoc")
allowed_origins = [item.strip() for item in settings.cors_allowed_origins.split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(ingestion_router)
app.include_router(analysis_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
