from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.files import DiscoveredFile
from app.schemas.source import SourceFile
from app.graph.models import DependencyGraphResult
from app.architecture.models import ArchitectureReport


class RepositoryRequest(BaseModel):
    url: str = Field(min_length=1, max_length=500)


class GitHubRepository(BaseModel):
    owner: str
    name: str
    canonical_url: str
    default_branch: str
    archive_url: str


class SkippedContent(BaseModel):
    """Content that extraction skipped, grouped by reason, capped per reason.

    Only safe-but-out-of-budget or irrelevant content appears here; content rejected for
    security reasons is logged server-side and never listed.
    """

    reasons: dict[str, list[str]] = Field(default_factory=dict)

    @property
    def total_skipped(self) -> int:
        return sum(len(names) for names in self.reasons.values())


class AnalysisCompleteness(BaseModel):
    """Whether the result covers the whole repository or a bounded part of it."""

    status: Literal["complete", "partial"]
    reason: str | None = None
    skipped: SkippedContent = Field(default_factory=SkippedContent)


class IngestionResult(BaseModel):
    repository: GitHubRepository
    root_path: str
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
