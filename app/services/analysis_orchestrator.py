from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path

from app.core.config import Settings
from app.core.exceptions import RepoLensError
from app.schemas.ingestion import IngestionResult
from app.services.analysis_store import AnalysisRecord, InMemoryAnalysisStore
from app.services.ingestion import RepositoryIngestionService

logger = logging.getLogger(__name__)


class AnalysisOrchestrator:
    """Runs the complete backend analysis pipeline and records real stage transitions."""

    def __init__(self, settings: Settings, store: InMemoryAnalysisStore | None = None) -> None:
        self.settings = settings
        self.store = store or InMemoryAnalysisStore()
        self.ingestion = RepositoryIngestionService(settings)

    def create_analysis(self, repository_url: str) -> AnalysisRecord:
        record = self.store.create(str(uuid.uuid4()), repository_url)
        self._release_superseded_workspaces()
        return record

    def _release_superseded_workspaces(self) -> None:
        """Delete extraction workspaces for analyses that fell outside the retention window."""
        for stale in self.store.evict_finished_beyond(self.settings.max_retained_analyses):
            self.release_workspace(stale)

    @staticmethod
    def release_workspace(record: AnalysisRecord) -> None:
        if record.results is None:
            return
        # root_path is <workspace>/extracted, so the workspace is its parent directory.
        workspace = Path(record.results.root_path).parent
        shutil.rmtree(workspace, ignore_errors=True)

    def run(self, analysis_id: str) -> None:
        record = self.store.get(analysis_id)
        if record is None:
            return
        try:
            self.store.update(analysis_id, status="running", stage="ingesting")
            result = self.ingestion.ingest(
                record.repository_url,
                preserve_workspace=True,
                on_stage=lambda stage: self.store.update(analysis_id, stage=stage),
            )
            self.store.update(analysis_id, status="completed", stage="completed", results=result)
        except RepoLensError as exc:
            logger.info("Repository analysis failed: %s", exc.__class__.__name__)
            self.store.update(
                analysis_id,
                status="failed",
                error={"type": exc.__class__.__name__, "message": str(exc)},
            )
        except Exception:
            logger.exception("Unexpected repository analysis failure")
            self.store.update(
                analysis_id,
                status="failed",
                error={"type": "AnalysisError", "message": "Repository analysis failed."},
            )

    @staticmethod
    def result(record: AnalysisRecord) -> IngestionResult:
        if record.results is None:
            raise ValueError("Analysis has no completed result")
        return record.results
