"""Regression tests for security, retention, and reporting fixes."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import analysis as analysis_api
from app.architecture.detector import ArchitectureDetector
from app.architecture.models import ArchitectureType
from app.core.config import Settings
from app.graph.graph_builder import DependencyGraphBuilder
from app.graph.models import DependencyGraphResult
from app.intelligence.insights import RepositoryInsightsGenerator
from app.main import app
from app.schemas.files import DiscoveredFile
from app.schemas.ingestion import GitHubRepository, IngestionResult
from app.schemas.source import Import, SourceFile, SupportedLanguage
from app.services.analysis_orchestrator import AnalysisOrchestrator
from app.services.analysis_store import InMemoryAnalysisStore
from app.services.discovery import FileDiscoverer


def python_file(path: str, module: str | None = None) -> SourceFile:
    imports = (
        [Import(module=module, kind="from_import", imported_names=["thing"], line_start=1, line_end=1)]
        if module
        else []
    )
    return SourceFile(
        path=path,
        size_bytes=12,
        language=SupportedLanguage.PYTHON,
        parse_status="success",
        imports=imports,
    )


def build_result(source_files: list[SourceFile], root_path: str) -> IngestionResult:
    graph = DependencyGraphBuilder().build(source_files)
    architecture = ArchitectureDetector().detect(source_files, graph)
    return IngestionResult(
        repository=GitHubRepository(
            owner="u",
            name="r",
            canonical_url="https://github.com/u/r",
            default_branch="main",
            archive_url="https://github.com/u/r/archive/refs/heads/main.tar.gz",
        ),
        root_path=root_path,
        discovered_files=[
            DiscoveredFile(path=item.path, size_bytes=item.size_bytes, kind="source") for item in source_files
        ],
        source_file_analyses=source_files,
        dependency_graph=graph,
        architecture_report=architecture,
        total_files=len(source_files),
        source_files=len(source_files),
        source_bytes=sum(item.size_bytes for item in source_files),
    )


def reset_store() -> None:
    with analysis_api.store._lock:
        analysis_api.store._records.clear()


# --------------------------------------------------------------------------------------
# Path exposure
# --------------------------------------------------------------------------------------


def test_ingest_endpoint_never_returns_a_filesystem_path(tmp_path, monkeypatch):
    """`/api/ingest` must not expose the server-side extraction workspace."""
    result = build_result([python_file("a.py")], str(tmp_path / "extracted"))
    monkeypatch.setattr(
        "app.api.ingestion.RepositoryIngestionService.ingest",
        lambda self, url: result,
    )
    client = TestClient(app)
    response = client.post("/api/ingest", json={"url": "https://github.com/u/r"})
    assert response.status_code == 200
    body = response.text
    assert "root_path" not in body
    assert tmp_path.name not in body
    payload = response.json()
    assert payload["repository"]["owner"] == "u"
    assert payload["total_files"] == 1
    assert payload["architecture_report"] is not None


def test_analysis_responses_never_leak_the_workspace_path(tmp_path, monkeypatch):
    reset_store()
    workspace = tmp_path / "repelens-analysis-secret"
    (workspace / "extracted").mkdir(parents=True)
    (workspace / "extracted" / "a.py").write_text("x = 1\n", encoding="utf-8")
    result = build_result([python_file("a.py")], str(workspace / "extracted"))
    monkeypatch.setattr(analysis_api.orchestrator.ingestion, "ingest", lambda *a, **k: result)
    client = TestClient(app)
    analysis_id = client.post(
        "/api/analyze", json={"repository_url": "https://github.com/u/r"}
    ).json()["analysis_id"]

    for path in (
        "",
        "/overview",
        "/architecture",
        "/graph",
        "/files",
        "/files/a.py",
        "/source/a.py",
        "/health",
        "/insights",
    ):
        response = client.get(f"/api/analyze/{analysis_id}{path}")
        assert response.status_code == 200, path
        assert str(workspace) not in response.text, path
        assert "repelens-analysis-secret" not in response.text, path


def test_file_detail_reports_the_architecture_layer(tmp_path, monkeypatch):
    reset_store()
    files = [
        python_file("src/controller/user_controller.py", "src.service.user_service"),
        python_file("src/service/user_service.py"),
    ]
    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / "src").mkdir(parents=True, exist_ok=True)
    result = build_result(files, str(workspace))
    for item in files:
        target = workspace / item.path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("x = 1\n", encoding="utf-8")
    result.discovered_files = [
        DiscoveredFile(path=item.path, size_bytes=item.size_bytes, kind="source") for item in files
    ]
    monkeypatch.setattr(analysis_api.orchestrator.ingestion, "ingest", lambda *a, **k: result)
    client = TestClient(app)
    analysis_id = client.post(
        "/api/analyze", json={"repository_url": "https://github.com/u/r"}
    ).json()["analysis_id"]

    detail = client.get(f"/api/analyze/{analysis_id}/files/src/controller/user_controller.py")
    assert detail.status_code == 200
    assert detail.json()["layer"] == "controller"


def test_test_layer_edges_are_excluded_from_the_architecture_view(tmp_path, monkeypatch):
    reset_store()
    files = [
        python_file("src/service/user_service.py"),
        python_file("src/repository/user_repository.py"),
        python_file("tests/test_user_service.py", "src.repository.user_repository"),
    ]
    result = build_result(files, str(tmp_path / "extracted"))
    monkeypatch.setattr(analysis_api.orchestrator.ingestion, "ingest", lambda *a, **k: result)
    client = TestClient(app)
    analysis_id = client.post(
        "/api/analyze", json={"repository_url": "https://github.com/u/r"}
    ).json()["analysis_id"]

    payload = client.get(f"/api/analyze/{analysis_id}/architecture").json()
    assert all("test" not in (edge["source_layer"], edge["target_layer"]) for edge in payload["layer_edges"])
    # The test file is still reported, but as its own layer rather than a production one.
    files_payload = client.get(f"/api/analyze/{analysis_id}/files").json()
    layers = {item["path"]: item["layer"] for item in files_payload}
    assert layers["tests/test_user_service.py"] == "test"


def test_overview_separates_discovered_and_source_file_counts(tmp_path, monkeypatch):
    reset_store()
    result = build_result([python_file("a.py"), python_file("b.py")], str(tmp_path / "extracted"))
    result.discovered_files.append(DiscoveredFile(path="README.md", size_bytes=10, kind="other"))
    result.total_files = 3
    monkeypatch.setattr(analysis_api.orchestrator.ingestion, "ingest", lambda *a, **k: result)
    client = TestClient(app)
    analysis_id = client.post(
        "/api/analyze", json={"repository_url": "https://github.com/u/r"}
    ).json()["analysis_id"]
    payload = client.get(f"/api/analyze/{analysis_id}/overview").json()
    assert payload["files"]["total"] == 3
    assert payload["files"]["source_total"] == 2


@pytest.mark.parametrize(
    "requested",
    ["/etc/passwd", "C:/Windows/win.ini", "..%2F..%2Fetc%2Fpasswd", "a/../../b.py"],
)
def test_file_endpoints_reject_absolute_and_traversing_paths(requested, tmp_path, monkeypatch):
    reset_store()
    result = build_result([python_file("a.py")], str(tmp_path / "extracted"))
    monkeypatch.setattr(analysis_api.orchestrator.ingestion, "ingest", lambda *a, **k: result)
    client = TestClient(app)
    analysis_id = client.post(
        "/api/analyze", json={"repository_url": "https://github.com/u/r"}
    ).json()["analysis_id"]
    assert client.get(f"/api/analyze/{analysis_id}/source/{requested}").status_code == 404
    assert client.get(f"/api/analyze/{analysis_id}/files/{requested}").status_code == 404


# --------------------------------------------------------------------------------------
# Workspace retention
# --------------------------------------------------------------------------------------


def test_retention_releases_the_oldest_workspaces(tmp_path):
    settings = Settings(max_retained_analyses=2)
    store = InMemoryAnalysisStore()
    orchestrator = AnalysisOrchestrator(settings, store)

    workspaces: list[Path] = []
    for index in range(3):
        record = orchestrator.create_analysis("https://github.com/u/r")
        workspace = tmp_path / f"workspace-{index}"
        extracted = workspace / "extracted"
        extracted.mkdir(parents=True)
        workspaces.append(workspace)
        store.update(
            record.analysis_id,
            status="completed",
            stage="completed",
            results=build_result([python_file("a.py")], str(extracted)),
        )

    # Creating the fourth analysis pushes the oldest completed one out of the window.
    orchestrator.create_analysis("https://github.com/u/r")
    assert not workspaces[0].exists()
    assert workspaces[1].exists()
    assert workspaces[2].exists()


def test_retention_never_evicts_a_running_analysis(tmp_path):
    settings = Settings(max_retained_analyses=1)
    store = InMemoryAnalysisStore()
    orchestrator = AnalysisOrchestrator(settings, store)

    running = orchestrator.create_analysis("https://github.com/u/r")
    orchestrator.create_analysis("https://github.com/u/r")
    orchestrator.create_analysis("https://github.com/u/r")
    assert store.get(running.analysis_id) is not None


# --------------------------------------------------------------------------------------
# Architecture evidence
# --------------------------------------------------------------------------------------


def test_layered_dependency_evidence_cites_real_files():
    files = [
        python_file("src/controller/user_controller.py", "src.service.user_service"),
        python_file("src/service/user_service.py", "src.repository.user_repository"),
        python_file("src/repository/user_repository.py"),
    ]
    graph = DependencyGraphBuilder().build(files)
    report = ArchitectureDetector().detect(files, graph)

    assert report.primary.architecture == ArchitectureType.LAYERED
    direction_evidence = [item for item in report.primary.evidence if item.type == "dependency_direction"]
    assert {item.description for item in direction_evidence} == {
        "controller depends on service",
        "service depends on repository",
    }
    for item in direction_evidence:
        assert item.supporting_paths, f"evidence {item.description!r} cites no files"
        for path in item.supporting_paths:
            assert path in {source.path for source in files}


@pytest.mark.parametrize(
    "path, expected",
    [
        ("src/test/java/com/acme/ClinicServiceTests.java", True),
        ("src/main/java/com/acme/ClinicService.java", False),
        ("tests/test_app.py", True),
        ("app/helpers_test.py", True),
        ("src/utils.test.ts", True),
        ("src/utils.spec.tsx", True),
        # Names that merely contain the letters of a test marker must not be misclassified.
        ("src/Unit.java", False),
        ("src/audit.py", False),
        ("src/wait.py", False),
        ("src/Temperature.java", False),
        ("src/calculate_it.py", False),
        ("src/UserService.java", False),
        ("src/IntegrationIT.java", True),
    ],
)
def test_test_paths_are_recognised_without_false_positives(path, expected):
    from app.architecture.layer_classifier import _is_test_path
    from pathlib import PurePosixPath

    assert _is_test_path(PurePosixPath(path)) is expected


def test_test_sources_do_not_define_or_violate_production_layers():
    """Test code legitimately reaches across layers, so it must not shape the architecture."""
    files = [
        python_file("src/main/repository/user_repository.py"),
        python_file("src/service/user_service.py", "src.repository.user_repository"),
        python_file("src/test/service/test_user_service.py", "src.main.repository.user_repository"),
    ]
    graph = DependencyGraphBuilder().build(files)
    report = ArchitectureDetector().detect(files, graph)

    assert report.layer_map["src/test/service/test_user_service.py"] == "test"
    service_layer = next(layer for layer in report.primary.layers if layer.name == "service")
    assert service_layer.paths == ["src/service/user_service.py"]
    assert report.primary.violations == []


def test_layer_observed_dependencies_come_from_resolved_edges():
    files = [
        python_file("src/controller/user_controller.py", "src.service.user_service"),
        python_file("src/service/user_service.py"),
    ]
    graph = DependencyGraphBuilder().build(files)
    report = ArchitectureDetector().detect(files, graph)
    controller = next(layer for layer in report.primary.layers if layer.name == "controller")
    assert controller.observed_dependencies == ["service"]


# --------------------------------------------------------------------------------------
# Deterministic reporting
# --------------------------------------------------------------------------------------


def test_cycle_finding_counts_distinct_files_not_cycles():
    files = [
        python_file("a.py", "b"),
        python_file("b.py", "a"),
        python_file("c.py", "d"),
        python_file("d.py", "c"),
    ]
    result = build_result(files, "/tmp/repo")
    graph: DependencyGraphResult = result.dependency_graph  # type: ignore[assignment]
    assert len(graph.cycles) == 2

    report = RepositoryInsightsGenerator().generate(result)
    finding = next(item for item in report.key_findings if item.category == "dependency_cycle")
    assert "4 files participate in 2 dependency cycle(s)" in finding.description
    assert sorted(finding.related_files) == ["a.py", "b.py", "c.py", "d.py"]


def test_external_imports_are_not_counted_as_unresolved():
    files = [
        python_file("a.py", "requests"),
        python_file("b.py", "a"),
    ]
    result = build_result(files, "/tmp/repo")
    report = RepositoryInsightsGenerator().generate(result)
    assert report.summary.unresolved_imports == 0
    assert report.health.dimensions["imports"].metrics["external"] == 1
    assert report.health.dimensions["imports"].score == 100.0


# --------------------------------------------------------------------------------------
# Discovery
# --------------------------------------------------------------------------------------


def test_discovery_skips_symlinked_directories(tmp_path, settings):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "a.py").write_text("x = 1\n", encoding="utf-8")
    outside = tmp_path.parent / "outside-source"
    outside.mkdir(exist_ok=True)
    (outside / "leak.py").write_text("secret = 1\n", encoding="utf-8")

    link = tmp_path / "linked"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symlink creation is not permitted in this environment")

    discovered = FileDiscoverer(settings).discover(tmp_path)
    assert [item.path for item in discovered] == ["src/a.py"]


def test_discovery_is_deterministically_ordered(tmp_path, settings):
    for name in ("z.py", "a.py", "m.py"):
        (tmp_path / name).write_text("x = 1\n", encoding="utf-8")
    discovered = FileDiscoverer(settings).discover(tmp_path)
    assert [item.path for item in discovered] == ["a.py", "m.py", "z.py"]
    assert [item.kind for item in discovered] == ["source"] * 3
