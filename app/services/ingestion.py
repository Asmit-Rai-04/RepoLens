import logging
import tempfile
from collections.abc import Callable
from pathlib import Path

from app.core.config import Settings
from app.schemas.ingestion import AnalysisCompleteness, IngestionResult, SkippedContent
from app.analyzers.source_analyzer import SourceAnalyzer
from app.graph.graph_builder import DependencyGraphBuilder
from app.architecture.detector import ArchitectureDetector
from app.services.discovery import FileDiscoverer
from app.services.downloader import RepositoryDownloader
from app.services.extractor import SafeTarExtractor
from app.services.github_client import GitHubClient

logger = logging.getLogger(__name__)


class RepositoryIngestionService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.github = GitHubClient(settings)
        self.downloader = RepositoryDownloader(settings)
        self.extractor = SafeTarExtractor(settings)
        self.discoverer = FileDiscoverer(settings)
        self.source_analyzer = SourceAnalyzer()
        self.graph_builder = DependencyGraphBuilder()
        self.architecture_detector = ArchitectureDetector()

    def ingest(
        self,
        repository_url: str,
        preserve_workspace: bool = False,
        on_stage: Callable[[str], None] | None = None,
    ) -> IngestionResult:
        metadata = self.github.get_repository_metadata(repository_url)
        temp_manager: tempfile.TemporaryDirectory[str] | None = None
        if preserve_workspace:
            # The workspace must outlive this call so later file/source requests can read it.
            # Callers that retain a workspace are responsible for deleting it; see
            # AnalysisOrchestrator, which bounds how many are kept.
            temp_dir = tempfile.mkdtemp(prefix="repelens-analysis-")
        else:
            temp_manager = tempfile.TemporaryDirectory(prefix="repelens-")
            temp_dir = temp_manager.name
        try:
            temp_root = Path(temp_dir)
            archive = self.downloader.download(metadata.repository, temp_root)
            extraction = self.extractor.extract_with_report(archive, temp_root / "extracted")
            if extraction.skipped_entries:
                logger.warning(
                    "Rejected %d unsafe archive entr%s while extracting %s/%s",
                    len(extraction.skipped_entries),
                    "y" if len(extraction.skipped_entries) == 1 else "ies",
                    metadata.repository.owner,
                    metadata.repository.name,
                )
            extracted_root = extraction.root
            discovered = self.discoverer.discover(extracted_root)
            source_files = [item for item in discovered if item.kind == "source"]
            if on_stage:
                on_stage("parsing")
            source_analyses = self.source_analyzer.analyze(extracted_root, source_files)
            if on_stage:
                on_stage("building_graph")
            dependency_graph = self.graph_builder.build(source_analyses)
            if on_stage:
                on_stage("detecting_architecture")
            architecture_report = self.architecture_detector.detect(source_analyses, dependency_graph)

            # Completeness reflects what the extraction actually covered: partial only
            # when safe content had to be left out of the extraction. Ignored directories
            # are the normal discovery policy and do not count. GitHub's metadata size is
            # informational only (it includes .git history, which the archive we analyze
            # does not contain), so it is logged but never changes the label.
            skipped = SkippedContent(reasons=extraction.budget_skipped)
            partial = extraction.partial
            if partial:
                logger.info(
                    "Partial analysis for %s/%s: %d entr%s skipped",
                    metadata.repository.owner,
                    metadata.repository.name,
                    skipped.total_skipped,
                    "y" if skipped.total_skipped == 1 else "ies",
                )
            if metadata.oversized_reported:
                logger.info(
                    "GitHub reports %s/%s larger than the repository budget; analyzed the "
                    "main-branch tree only",
                    metadata.repository.owner,
                    metadata.repository.name,
                )
            completeness = AnalysisCompleteness(
                status="partial" if partial else "complete",
                reason="Repository content beyond the configured analysis budget was skipped." if partial else None,
                skipped=skipped,
            )
            return IngestionResult(
                repository=metadata.repository,
                root_path=str(extracted_root),
                discovered_files=discovered,
                source_file_analyses=source_analyses,
                dependency_graph=dependency_graph,
                architecture_report=architecture_report,
                total_files=len(discovered),
                source_files=len(source_files),
                source_bytes=sum(item.size_bytes for item in source_files),
                completeness=completeness,
            )
        finally:
            if temp_manager is not None:
                temp_manager.cleanup()
