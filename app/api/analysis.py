from __future__ import annotations

import re
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.architecture.layer_classifier import TEST_LAYER
from app.core.config import get_settings
from app.core.exceptions import RepoLensError
from app.core.github_url import parse_github_repository_url
from app.graph.models import DependencyGraphResult, GraphEdgeType, import_edge_status
from app.intelligence.models import HealthReport, InsightsReport
from app.intelligence.insights import RepositoryInsightsGenerator
from app.schemas.api import (
    AnalysisCreatedResponse,
    AnalysisRequest,
    AnalysisStatusResponse,
    ArchitectureResponse,
    FileDetailResponse,
    FileSummary,
    LayerEdge,
    OverviewArchitecture,
    OverviewFiles,
    OverviewGraph,
    OverviewResponse,
    RepositoryOverview,
    SourceResponse,
)
from app.schemas.ingestion import IngestionResult
from app.services.analysis_orchestrator import AnalysisOrchestrator
from app.services.analysis_store import AnalysisRecord, InMemoryAnalysisStore

router = APIRouter(prefix="/api/analyze", tags=["analysis"])
store = InMemoryAnalysisStore()
orchestrator = AnalysisOrchestrator(get_settings(), store)
intelligence = RepositoryInsightsGenerator()

# MS-DOS drive prefixes and UNC shares are absolute on Windows even though PurePosixPath
# does not consider them absolute. Reject both so no endpoint can be used to probe the host.
_WINDOWS_ABSOLUTE = re.compile(r"^(?:[A-Za-z]:[\\/]|\\\\)")


def _record_or_404(analysis_id: str) -> AnalysisRecord:
    record = store.get(analysis_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return record


def _completed(analysis_id: str) -> AnalysisRecord:
    record = _record_or_404(analysis_id)
    if record.status == "failed":
        raise HTTPException(status_code=409, detail=record.error or {"type": "AnalysisError", "message": "Analysis failed"})
    if record.results is None:
        raise HTTPException(status_code=409, detail="Analysis is not complete")
    return record


def _completed_result(analysis_id: str) -> IngestionResult:
    result = _completed(analysis_id).results
    if result is None:  # pragma: no cover - _completed already guarantees a result
        raise HTTPException(status_code=409, detail="Analysis is not complete")
    return result


def _safe_api_error(exc: RepoLensError) -> HTTPException:
    status = 400
    name = exc.__class__.__name__
    if name == "RepositoryNotFound":
        status = 404
    elif name == "GitHubRateLimited":
        status = 429
    elif name == "RepositorySizeExceeded":
        status = 413
    return HTTPException(status_code=status, detail={"type": name, "message": str(exc)})


def _safe_relative_parts(path: str) -> tuple[str, ...]:
    """Reject filesystem-style paths before any lookup or disk access happens."""
    relative = PurePosixPath(path)
    if not path or relative.is_absolute() or ".." in relative.parts or _WINDOWS_ABSOLUTE.match(path):
        raise HTTPException(status_code=404, detail="File not found")
    return relative.parts


@router.post("", response_model=AnalysisCreatedResponse, status_code=202)
def create_analysis(request: AnalysisRequest, background_tasks: BackgroundTasks) -> AnalysisCreatedResponse:
    try:
        parse_github_repository_url(request.repository_url)
    except RepoLensError as exc:
        raise _safe_api_error(exc) from None
    record = orchestrator.create_analysis(request.repository_url)
    background_tasks.add_task(orchestrator.run, record.analysis_id)
    return AnalysisCreatedResponse(analysis_id=record.analysis_id, status=record.status)


@router.get("/{analysis_id}", response_model=AnalysisStatusResponse)
def get_analysis(analysis_id: str) -> AnalysisStatusResponse:
    record = _record_or_404(analysis_id)
    completeness = None
    if record.results is not None:
        completeness = record.results.completeness
    return AnalysisStatusResponse(
        analysis_id=record.analysis_id,
        status=record.status,
        stage=record.stage,
        created_at=record.created_at,
        updated_at=record.updated_at,
        error=record.error,
        completeness=completeness,
    )


@router.get("/{analysis_id}/overview", response_model=OverviewResponse)
def get_overview(analysis_id: str) -> OverviewResponse:
    result = _completed_result(analysis_id)
    by_language: dict[str, int] = {}
    for source in result.source_file_analyses:
        key = source.language.value if source.language else "unknown"
        by_language[key] = by_language.get(key, 0) + 1
    report = result.architecture_report
    graph = result.dependency_graph
    if report is None or graph is None:
        raise HTTPException(status_code=409, detail="Analysis result is incomplete")
    return OverviewResponse(
        repository=RepositoryOverview(
            owner=result.repository.owner,
            name=result.repository.name,
            canonical_url=result.repository.canonical_url,
            default_branch=result.repository.default_branch,
        ),
        files=OverviewFiles(total=result.total_files, source_total=result.source_files, by_language=by_language),
        architecture=OverviewArchitecture(
            name=report.primary.architecture.value,
            confidence=report.primary.confidence,
            summary=report.summary,
        ),
        graph=OverviewGraph(
            nodes=len(graph.nodes),
            edges=len(graph.edges),
            cycles=len(graph.cycles),
            strongly_connected_components=len(graph.strongly_connected_components),
        ),
        violations=len(report.primary.violations),
        completeness=result.completeness,
    )


@router.get("/{analysis_id}/architecture", response_model=ArchitectureResponse)
def get_architecture(analysis_id: str) -> ArchitectureResponse:
    result = _completed_result(analysis_id)
    if result.architecture_report is None or result.dependency_graph is None:
        raise HTTPException(status_code=409, detail="Analysis result is incomplete")
    layer_map = result.architecture_report.layer_map
    grouped: dict[tuple[str, str], tuple[int, set[str], bool]] = {}
    violation_keys = {(v.source, v.target) for v in result.architecture_report.primary.violations}
    for edge in result.dependency_graph.edges:
        if edge.edge_type != GraphEdgeType.IMPORTS or edge.target_file is None or not edge.resolved:
            continue
        source_layer = layer_map.get(edge.source_file)
        target_layer = layer_map.get(edge.target_file)
        if not source_layer or not target_layer:
            continue
        # The architecture view describes production structure, so test-to-production edges
        # (which cross layers by design) are not part of it.
        if TEST_LAYER in {source_layer, target_layer}:
            continue
        key = (source_layer, target_layer)
        count, paths, violated = grouped.get(key, (0, set(), False))
        paths.add(edge.source_file)
        paths.add(edge.target_file)
        grouped[key] = (count + 1, paths, violated or (edge.source_file, edge.target_file) in violation_keys)
    layer_edges = [LayerEdge(source_layer=s, target_layer=t, import_count=c, supporting_files=sorted(paths), violation=v) for (s, t), (c, paths, v) in sorted(grouped.items())]
    return ArchitectureResponse(report=result.architecture_report, layer_edges=layer_edges)


@router.get("/{analysis_id}/graph", response_model=DependencyGraphResult)
def get_graph(analysis_id: str) -> DependencyGraphResult:
    result = _completed_result(analysis_id)
    if result.dependency_graph is None:
        raise HTTPException(status_code=409, detail="Analysis result is incomplete")
    return result.dependency_graph


@router.get("/{analysis_id}/health", response_model=HealthReport)
def get_health(analysis_id: str) -> HealthReport:
    return intelligence.health_analyzer.analyze(_completed_result(analysis_id))


@router.get("/{analysis_id}/insights", response_model=InsightsReport)
def get_insights(analysis_id: str) -> InsightsReport:
    return intelligence.generate(_completed_result(analysis_id))


@router.get("/{analysis_id}/files", response_model=list[FileSummary])
def list_files(analysis_id: str) -> list[FileSummary]:
    result = _completed_result(analysis_id)
    layer_map = result.architecture_report.layer_map if result.architecture_report else {}
    return [
        FileSummary(
            path=item.path,
            language=item.language,
            parse_status=item.parse_status,
            layer=layer_map.get(item.path),
            size_bytes=item.size_bytes,
            symbol_count=len(item.symbols),
            import_count=len(item.imports),
        )
        for item in result.source_file_analyses
    ]


@router.get("/{analysis_id}/files/{path:path}", response_model=FileDetailResponse)
def get_file(analysis_id: str, path: str) -> FileDetailResponse:
    parts = _safe_relative_parts(path)
    result = _completed_result(analysis_id)
    if result.dependency_graph is None:
        raise HTTPException(status_code=409, detail="Analysis result is incomplete")
    # Content is only served for paths the discoverer actually found in the repository.
    canonical = PurePosixPath(*parts).as_posix()
    if canonical not in {item.path for item in result.discovered_files}:
        raise HTTPException(status_code=404, detail="File not found")
    source = next((item for item in result.source_file_analyses if item.path == canonical), None)
    if source is None:
        raise HTTPException(status_code=404, detail="File not found")
    resolved: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    external: list[dict[str, Any]] = []
    for edge in result.dependency_graph.edges:
        if edge.source_file != source.path or edge.edge_type != GraphEdgeType.IMPORTS:
            continue
        evidence = dict(edge.import_evidence)
        evidence.update({"target": edge.target, "target_file": edge.target_file, "resolved": edge.resolved})
        status = import_edge_status(edge)
        if status == "external":
            external.append(evidence)
        elif status == "resolved":
            resolved.append(evidence)
        else:
            unresolved.append(evidence)
    report = result.architecture_report
    layer = report.layer_map.get(source.path) if report else None
    return FileDetailResponse(
        source_file=source,
        layer=layer,
        resolved_imports=resolved,
        unresolved_imports=unresolved,
        external_imports=external,
    )


@router.get("/{analysis_id}/source/{path:path}", response_model=SourceResponse)
def get_source(analysis_id: str, path: str) -> SourceResponse:
    parts = _safe_relative_parts(path)
    result = _completed_result(analysis_id)
    canonical = PurePosixPath(*parts).as_posix()
    if canonical not in {item.path for item in result.discovered_files}:
        raise HTTPException(status_code=404, detail="File not found")
    source_file = next((item for item in result.source_file_analyses if item.path == canonical), None)
    if source_file is None:
        raise HTTPException(status_code=404, detail="File not found")
    target = Path(result.root_path).joinpath(*parts)
    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raise HTTPException(status_code=404, detail="File not found") from None
    return SourceResponse(path=canonical, content=content, language=source_file.language)
