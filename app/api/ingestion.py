from fastapi import APIRouter, HTTPException

from app.core.config import get_settings
from app.core.exceptions import RepoLensError
from app.schemas.api import IngestResponse
from app.schemas.ingestion import RepositoryRequest
from app.services.ingestion import RepositoryIngestionService

router = APIRouter(prefix="/api", tags=["ingestion"])


def _status_for(exc: RepoLensError) -> int:
    name = exc.__class__.__name__
    if name == "RepositoryNotFound":
        return 404
    if name == "GitHubRateLimited":
        return 429
    if name == "RepositorySizeExceeded":
        return 413
    return 400


@router.post("/ingest", response_model=IngestResponse)
def ingest_repository(request: RepositoryRequest) -> IngestResponse:
    service = RepositoryIngestionService(get_settings())
    try:
        result = service.ingest(request.url)
    except RepoLensError as exc:
        raise HTTPException(
            status_code=_status_for(exc),
            detail={"type": exc.__class__.__name__, "message": str(exc)},
        ) from None
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={"type": "IngestionError", "message": "Repository ingestion failed"},
        ) from None
    return IngestResponse(**result.model_dump(exclude={"root_path"}))
