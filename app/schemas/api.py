from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.architecture.models import ArchitectureReport
from app.graph.models import DependencyGraphResult
from app.schemas.files import DiscoveredFile
from app.schemas.ingestion import AnalysisCompleteness, GitHubRepository
from app.schemas.source import ParseStatus, SupportedLanguage, SourceFile


class AnalysisRequest(BaseModel):
    repository_url: str = Field(min_length=1, max_length=500)


class AnalysisCreatedResponse(BaseModel):
    analysis_id: str
    status: str


class AnalysisError(BaseModel):
    type: str
    message: str


class AnalysisStatusResponse(BaseModel):
    analysis_id: str
    status: str
    stage: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
    error: AnalysisError | None = None
    completeness: AnalysisCompleteness | None = None


class RepositoryOverview(BaseModel):
    owner: str
    name: str
    canonical_url: str
    default_branch: str


class OverviewFiles(BaseModel):
    # total counts every discovered file; source_total counts the files RepoLens analyzed.
    total: int
    source_total: int = 0
    by_language: dict[str, int]


class OverviewArchitecture(BaseModel):
    name: str
    confidence: float
    summary: str


class OverviewGraph(BaseModel):
    nodes: int
    edges: int
    cycles: int
    strongly_connected_components: int


class OverviewResponse(BaseModel):
    repository: RepositoryOverview
    files: OverviewFiles
    architecture: OverviewArchitecture
    graph: OverviewGraph
    violations: int
    completeness: AnalysisCompleteness = Field(
        default_factory=lambda: AnalysisCompleteness(status="complete")
    )


class LayerEdge(BaseModel):
    source_layer: str
    target_layer: str
    import_count: int = Field(ge=0)
    supporting_files: list[str] = Field(default_factory=list)
    violation: bool = False


class ArchitectureResponse(BaseModel):
    report: ArchitectureReport
    layer_edges: list[LayerEdge]


class FileSummary(BaseModel):
    path: str
    language: SupportedLanguage | None
    parse_status: ParseStatus
    layer: str | None = None
    size_bytes: int
    symbol_count: int
    import_count: int


class FileDetailResponse(BaseModel):
    source_file: SourceFile
    layer: str | None = None
    resolved_imports: list[dict[str, Any]] = Field(default_factory=list)
    unresolved_imports: list[dict[str, Any]] = Field(default_factory=list)
    external_imports: list[dict[str, Any]] = Field(default_factory=list)


class IngestResponse(BaseModel):
    """Ingestion payload for the synchronous ``/api/ingest`` endpoint.

    Deliberately omits the ingestion workspace path: absolute server filesystem paths are
    never returned to API consumers.
    """

    repository: GitHubRepository
    discovered_files: list[DiscoveredFile]
    source_file_analyses: list[SourceFile] = Field(default_factory=list)
    dependency_graph: DependencyGraphResult | None = None
    architecture_report: ArchitectureReport | None = None
    total_files: int = Field(ge=0)
    source_files: int = Field(ge=0)
    source_bytes: int = Field(ge=0)
    completeness: AnalysisCompleteness = Field(
        default_factory=lambda: AnalysisCompleteness(status="complete")
    )


class SourceResponse(BaseModel):
    path: str
    content: str
    language: SupportedLanguage | None
