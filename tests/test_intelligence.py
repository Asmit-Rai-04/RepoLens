from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.api import analysis as analysis_api
from app.architecture.models import (
    ArchitectureCandidate,
    ArchitectureEvidence,
    ArchitectureReport,
    ArchitectureType,
    LayerInfo,
    MonorepoInfo,
)
from app.graph.graph_builder import DependencyGraphBuilder
from app.intelligence.health import HEALTH_WEIGHTS, RepositoryHealthAnalyzer
from app.intelligence.models import FindingSeverity, HealthStatus
from app.intelligence.insights import RepositoryInsightsGenerator
from app.main import app
from app.schemas.files import DiscoveredFile
from app.schemas.ingestion import GitHubRepository, IngestionResult
from app.schemas.source import Import, ParseStatus, SourceFile, SupportedLanguage


def sf(path: str, imports=None, status: ParseStatus = ParseStatus.SUCCESS) -> SourceFile:
    return SourceFile(
        path=path,
        size_bytes=1,
        language=SupportedLanguage.PYTHON,
        parse_status=status,
        imports=imports or [],
    )


def architecture_with_violations(count: int = 0, confidence: float = 0.92) -> ArchitectureReport:
    violations = []
    for index in range(count):
        from app.architecture.models import ArchitectureViolation

        violations.append(
            ArchitectureViolation(
                kind="skipped_layer",
                source=f"controller{index}.py",
                target=f"repository{index}.py",
                source_layer="controller",
                target_layer="repository",
                description="Controller directly depends on Repository, skipping the Service layer.",
            )
        )
    return ArchitectureReport(
        primary=ArchitectureCandidate(
            architecture=ArchitectureType.LAYERED,
            confidence=confidence,
            evidence=[ArchitectureEvidence(type="directory_structure", description="controller/service/repository layers detected", weight=0.15)],
            layers=[
                LayerInfo(name="controller", paths=["controller.py"], expected_dependencies=["service"], forbidden_dependencies=["repository"], observed_dependencies=["service"]),
                LayerInfo(name="service", paths=["service.py"], expected_dependencies=["repository"], forbidden_dependencies=[], observed_dependencies=["repository"]),
                LayerInfo(name="repository", paths=["repository.py"], expected_dependencies=[], forbidden_dependencies=["service"], observed_dependencies=[]),
            ],
            violations=violations,
        ),
        monorepo=MonorepoInfo(is_monorepo=False),
        summary="Detected Layered architecture.",
        layer_map={"controller.py": "controller", "service.py": "service", "repository.py": "repository"},
    )


def result_from(source_files: list[SourceFile], architecture: ArchitectureReport | None = None) -> IngestionResult:
    graph = DependencyGraphBuilder().build(source_files)
    discovered = [DiscoveredFile(path=item.path, size_bytes=item.size_bytes, kind="source") for item in source_files]
    return IngestionResult(
        repository=GitHubRepository(
            owner="u", name="repo", canonical_url="https://github.com/u/repo", default_branch="main", archive_url="https://example.invalid/archive.tgz"
        ),
        root_path="/tmp/repo",
        discovered_files=discovered,
        source_file_analyses=source_files,
        dependency_graph=graph,
        architecture_report=architecture or architecture_with_violations(0),
        total_files=len(source_files),
        source_files=len(source_files),
        source_bytes=sum(item.size_bytes for item in source_files),
    )


def test_health_weights_are_explicit_and_sum_to_one():
    assert HEALTH_WEIGHTS.model_dump() == {"parse": 0.2, "imports": 0.2, "cycles": 0.2, "architecture": 0.25, "coupling": 0.15}
    assert sum(HEALTH_WEIGHTS.model_dump().values()) == 1


def test_parse_health_excludes_empty_and_unsupported():
    result = result_from([
        sf("ok.py"),
        sf("broken.py", status=ParseStatus.ERROR),
        sf("empty.py", status=ParseStatus.EMPTY),
        sf("other.txt", status=ParseStatus.UNSUPPORTED),
    ])
    dimension = RepositoryHealthAnalyzer().analyze(result).dimensions["parse"]
    assert dimension.score == 50
    assert dimension.metrics["attempted"] == 2
    assert dimension.metrics["unsupported"] == 1
    assert dimension.metrics["empty"] == 1
    assert dimension.status == HealthStatus.POOR


def test_import_health_excludes_external_from_resolution_rate():
    result = result_from([
        sf("main.py", [
            Import(module="utils", kind="import", line_start=1, line_end=1),
            Import(module=".missing", kind="from_import", line_start=2, line_end=2),
            Import(module="requests", kind="import", line_start=3, line_end=3),
        ]),
        sf("utils.py"),
    ])
    dimension = RepositoryHealthAnalyzer().analyze(result).dimensions["imports"]
    assert dimension.metrics["resolved"] == 1
    assert dimension.metrics["unresolved"] == 1
    assert dimension.metrics["external"] == 1
    assert dimension.score == 50


def test_cycle_health_reflects_cycle_count_and_scc_size():
    result = result_from([
        sf("a.py", [Import(module="b", kind="import", line_start=1, line_end=1)]),
        sf("b.py", [Import(module="c", kind="import", line_start=1, line_end=1)]),
        sf("c.py", [Import(module="a", kind="import", line_start=1, line_end=1)]),
    ])
    health = RepositoryHealthAnalyzer().analyze(result)
    dimension = health.dimensions["cycles"]
    assert dimension.metrics["cycles"] == 1
    assert dimension.metrics["largest_scc"] == 3
    assert dimension.score == 68
    assert health.cycle_severity[0].severity == FindingSeverity.MEDIUM


def test_architecture_health_penalizes_violations_and_low_confidence():
    result = result_from([sf("controller.py")], architecture_with_violations(2, confidence=0.8))
    dimension = RepositoryHealthAnalyzer().analyze(result).dimensions["architecture"]
    assert dimension.score == 60
    assert dimension.metrics["violations"] == 2


def test_coupling_hotspot_uses_backend_metrics():
    result = result_from([
        sf("a.py", [Import(module="hub", kind="import", line_start=1, line_end=1)]),
        sf("b.py", [Import(module="hub", kind="import", line_start=1, line_end=1)]),
        sf("c.py", [Import(module="hub", kind="import", line_start=1, line_end=1)]),
        sf("hub.py"),
    ])
    health = RepositoryHealthAnalyzer().analyze(result)
    assert health.coupling_hotspots
    assert health.coupling_hotspots[0].path == "hub.py"
    assert "incoming dependency count" in health.coupling_hotspots[0].reason


def test_weighted_total_is_reproducible():
    result = result_from([sf("main.py")])
    health_a = RepositoryHealthAnalyzer().analyze(result)
    health_b = RepositoryHealthAnalyzer().analyze(result)
    assert health_a == health_b
    expected = round(
        sum(health_a.dimensions[name].score * weight for name, weight in HEALTH_WEIGHTS.model_dump().items()), 2
    )
    assert health_a.score == expected


def test_insights_are_deterministic_and_include_factual_findings():
    result = result_from([
        sf("a.py", [Import(module="b", kind="import", line_start=1, line_end=1), Import(module=".missing", kind="from_import", line_start=2, line_end=2)]),
        sf("b.py", [Import(module="a", kind="import", line_start=1, line_end=1)]),
        sf("broken.py", status=ParseStatus.ERROR),
    ], architecture_with_violations(1))
    generator = RepositoryInsightsGenerator()
    first = generator.generate(result)
    second = generator.generate(result)
    assert first == second
    categories = {item.category for item in first.key_findings}
    assert {"unresolved_imports", "dependency_cycle", "parse_failures", "architecture_violation"} <= categories
    assert first.clean_state is False
    assert first.summary.unresolved_imports == 1


def test_clean_repository_state_is_positive():
    result = result_from([sf("main.py")], architecture_with_violations(0))
    report = RepositoryInsightsGenerator().generate(result)
    assert report.clean_state is True
    assert report.clean_state_message
    assert report.key_findings == []


def test_health_and_insights_api(monkeypatch, tmp_path: Path):
    result = result_from([sf("main.py")], architecture_with_violations(0))
    reset_store()
    monkeypatch.setattr(analysis_api.orchestrator.ingestion, "ingest", lambda *args, **kwargs: result)
    client = TestClient(app)
    analysis_id = client.post("/api/analyze", json={"repository_url": "https://github.com/u/repo"}).json()["analysis_id"]
    health = client.get(f"/api/analyze/{analysis_id}/health")
    assert health.status_code == 200
    assert health.json()["weights"]["architecture"] == 0.25
    assert "dimensions" in health.json()
    insights = client.get(f"/api/analyze/{analysis_id}/insights")
    assert insights.status_code == 200
    assert insights.json()["health"]["score"] == health.json()["score"]
    assert insights.json()["clean_state"] is True


def test_health_and_insights_require_completed_analysis():
    reset_store()
    client = TestClient(app)
    response = client.post("/api/analyze", json={"repository_url": "https://github.com/u/repo"})
    analysis_id = response.json()["analysis_id"]
    assert client.get(f"/api/analyze/{analysis_id}/health").status_code == 409
    assert client.get(f"/api/analyze/{analysis_id}/insights").status_code == 409


def reset_store() -> None:
    with analysis_api.store._lock:
        analysis_api.store._records.clear()

from app.intelligence.health import status_for


def test_status_thresholds_are_deterministic():
    assert status_for(100).value == "excellent"
    assert status_for(90).value == "excellent"
    assert status_for(89.99).value == "good"
    assert status_for(75).value == "good"
    assert status_for(74.99).value == "fair"
    assert status_for(60).value == "fair"
    assert status_for(59.99).value == "poor"
    assert status_for(40).value == "poor"
    assert status_for(39.99).value == "critical"


def test_health_and_insights_missing_analysis_are_404():
    reset_store()
    client = TestClient(app)
    assert client.get("/api/analyze/missing/health").status_code == 404
    assert client.get("/api/analyze/missing/insights").status_code == 404


def test_failed_analysis_is_rejected_by_health_and_insights(monkeypatch):
    reset_store()
    from app.core.exceptions import RepositoryNotFound

    def fail(*args, **kwargs):
        raise RepositoryNotFound("Repository not found")

    monkeypatch.setattr(analysis_api.orchestrator.ingestion, "ingest", fail)
    client = TestClient(app)
    analysis_id = client.post("/api/analyze", json={"repository_url": "https://github.com/u/missing"}).json()["analysis_id"]
    assert client.get(f"/api/analyze/{analysis_id}/health").status_code == 409
    assert client.get(f"/api/analyze/{analysis_id}/insights").status_code == 409
