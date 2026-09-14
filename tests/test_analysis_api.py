from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.api import analysis as analysis_api
from app.main import app
from app.architecture.detector import ArchitectureDetector
from app.core.exceptions import RepositoryNotFound
from app.graph.graph_builder import DependencyGraphBuilder
from app.schemas.ingestion import DiscoveredFile, GitHubRepository, IngestionResult
from app.schemas.source import Import, SourceFile, SupportedLanguage


def make_result(tmp_path: Path) -> IngestionResult:
    root = tmp_path / "repo"
    root.mkdir()
    (root / "main.py").write_text("from utils import helper\nprint(helper())\n", encoding="utf-8")
    (root / "utils.py").write_text("def helper():\n    return 1\n", encoding="utf-8")

    source_files = [
        SourceFile(
            path="main.py",
            size_bytes=(root / "main.py").stat().st_size,
            language=SupportedLanguage.PYTHON,
            parse_status="success",
            symbols=[],
            imports=[Import(module="utils", kind="from_import", imported_names=["helper"], line_start=1, line_end=1)],
            inheritance=[],
        ),
        SourceFile(
            path="utils.py",
            size_bytes=(root / "utils.py").stat().st_size,
            language=SupportedLanguage.PYTHON,
            parse_status="success",
            symbols=[],
            imports=[],
            inheritance=[],
        ),
    ]
    discovered = [
        DiscoveredFile(path="main.py", size_bytes=source_files[0].size_bytes, kind="source"),
        DiscoveredFile(path="utils.py", size_bytes=source_files[1].size_bytes, kind="source"),
    ]
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
        root_path=str(root),
        discovered_files=discovered,
        source_file_analyses=source_files,
        dependency_graph=graph,
        architecture_report=architecture,
        total_files=2,
        source_files=2,
        source_bytes=sum(item.size_bytes for item in source_files),
    )


def reset_store() -> None:
    with analysis_api.store._lock:
        analysis_api.store._records.clear()


def test_create_analysis_and_complete_flow(tmp_path, monkeypatch):
    reset_store()
    result = make_result(tmp_path)
    monkeypatch.setattr(analysis_api.orchestrator.ingestion, "ingest", lambda *args, **kwargs: result)
    client = TestClient(app)

    response = client.post("/api/analyze", json={"repository_url": "https://github.com/u/r"})
    assert response.status_code == 202
    analysis_id = response.json()["analysis_id"]
    assert response.json()["status"] in {"queued", "running", "completed"}

    status = client.get(f"/api/analyze/{analysis_id}")
    assert status.status_code == 200
    assert status.json()["status"] == "completed"
    assert status.json()["stage"] == "completed"

    overview = client.get(f"/api/analyze/{analysis_id}/overview")
    assert overview.status_code == 200
    assert overview.json()["files"]["total"] == 2
    assert overview.json()["graph"]["nodes"] == 2

    architecture = client.get(f"/api/analyze/{analysis_id}/architecture")
    assert architecture.status_code == 200
    assert "report" in architecture.json()
    assert "layer_edges" in architecture.json()

    graph = client.get(f"/api/analyze/{analysis_id}/graph")
    assert graph.status_code == 200
    json.dumps(graph.json())
    assert graph.json()["edges"]

    files = client.get(f"/api/analyze/{analysis_id}/files")
    assert files.status_code == 200
    assert {item["path"] for item in files.json()} == {"main.py", "utils.py"}

    detail = client.get(f"/api/analyze/{analysis_id}/files/main.py")
    assert detail.status_code == 200
    assert detail.json()["resolved_imports"]

    source = client.get(f"/api/analyze/{analysis_id}/source/main.py")
    assert source.status_code == 200
    assert "from utils" in source.json()["content"]


def test_unknown_analysis_and_missing_files():
    reset_store()
    client = TestClient(app)
    assert client.get("/api/analyze/not-real").status_code == 404


def test_invalid_repository_url():
    reset_store()
    client = TestClient(app)
    response = client.post("/api/analyze", json={"repository_url": "https://example.com/a/b"})
    assert response.status_code == 400
    assert response.json()["detail"]["type"] == "InvalidRepositoryURL"


def test_failure_is_sanitized(monkeypatch):
    reset_store()

    def fail(*args, **kwargs):
        raise RepositoryNotFound("Repository not found")

    monkeypatch.setattr(analysis_api.orchestrator.ingestion, "ingest", fail)
    client = TestClient(app)
    response = client.post("/api/analyze", json={"repository_url": "https://github.com/u/missing"})
    assert response.status_code == 202
    analysis_id = response.json()["analysis_id"]

    status = client.get(f"/api/analyze/{analysis_id}")
    payload = status.json()
    assert payload["status"] == "failed"
    assert payload["error"]["type"] == "RepositoryNotFound"
    assert "traceback" not in str(payload).lower()
    assert "root_path" not in str(payload).lower()


def test_file_and_source_path_traversal_are_denied(tmp_path, monkeypatch):
    reset_store()
    result = make_result(tmp_path)
    monkeypatch.setattr(analysis_api.orchestrator.ingestion, "ingest", lambda *args, **kwargs: result)
    client = TestClient(app)
    analysis_id = client.post("/api/analyze", json={"repository_url": "https://github.com/u/r"}).json()["analysis_id"]

    assert client.get(f"/api/analyze/{analysis_id}/files/../secret.txt").status_code == 404
    assert client.get(f"/api/analyze/{analysis_id}/source/../secret.txt").status_code == 404
    assert client.get(f"/api/analyze/{analysis_id}/source/%2E%2E%2Fsecret.txt").status_code == 404
    assert client.get(f"/api/analyze/{analysis_id}/source/%2Fetc%2Fpasswd").status_code == 404


def test_cors_allows_configured_frontend_origin():
    reset_store()
    client = TestClient(app)
    response = client.options(
        "/api/analyze",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_orchestrator_records_real_stage_transitions(tmp_path, monkeypatch):
    reset_store()
    result = make_result(tmp_path)
    seen: list[str] = []

    def fake_ingest(url, preserve_workspace=False, on_stage=None):
        assert preserve_workspace is True
        if on_stage:
            for stage in ("parsing", "building_graph", "detecting_architecture"):
                on_stage(stage)
                seen.append(stage)
        return result

    monkeypatch.setattr(analysis_api.orchestrator.ingestion, "ingest", fake_ingest)
    record = analysis_api.orchestrator.create_analysis("https://github.com/u/r")
    analysis_api.orchestrator.run(record.analysis_id)
    current = analysis_api.store.get(record.analysis_id)
    assert current is not None
    assert current.status == "completed"
    assert current.stage == "completed"
    assert seen == ["parsing", "building_graph", "detecting_architecture"]
