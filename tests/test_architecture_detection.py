import json
from pathlib import Path

from app.architecture.detector import ArchitectureDetector
from app.architecture.models import ArchitectureType
from app.graph.graph_builder import DependencyGraphBuilder
from app.graph.models import GraphEdgeType
from app.schemas.source import Import, Inheritance, ParseStatus, SourceFile, SupportedLanguage, Symbol


def sf(path, language, imports=None, inheritance=None, symbols=None, package=None):
    return SourceFile(
        path=path,
        size_bytes=1,
        language=language,
        parse_status=ParseStatus.SUCCESS,
        imports=imports or [],
        inheritance=inheritance or [],
        symbols=symbols or [],
        package_name=package,
    )


def analyze(files):
    graph = DependencyGraphBuilder().build(files)
    report = ArchitectureDetector().detect(files, graph)
    return report, graph


def test_spring_boot_layered_fixture_detects_layered_and_high_confidence():
    files = [
        sf("src/main/java/controller/UserController.java", SupportedLanguage.JAVA, imports=[Import(module="service.UserService", kind="import", line_start=1, line_end=1), Import(module="org.springframework.web.bind.annotation.RestController", kind="import", line_start=2, line_end=2)], symbols=[Symbol(name="UserController", kind="class", line_start=1, line_end=5, column_start=0, column_end=1)], package="controller"),
        sf("src/main/java/service/UserService.java", SupportedLanguage.JAVA, imports=[Import(module="repository.UserRepository", kind="import", line_start=1, line_end=1), Import(module="org.springframework.stereotype.Service", kind="import", line_start=2, line_end=2)], symbols=[Symbol(name="UserService", kind="class", line_start=1, line_end=5, column_start=0, column_end=1)], package="service"),
        sf("src/main/java/repository/UserRepository.java", SupportedLanguage.JAVA, imports=[Import(module="org.springframework.stereotype.Repository", kind="import", line_start=1, line_end=1)], symbols=[Symbol(name="UserRepository", kind="class", line_start=1, line_end=5, column_start=0, column_end=1)], package="repository"),
    ]
    report, _ = analyze(files)
    assert report.primary.architecture == ArchitectureType.LAYERED
    assert report.primary.confidence >= 0.55
    assert any(item.type == "dependency_direction" for item in report.primary.evidence)


def test_service_repository_pattern_is_distinct_from_layered():
    files = [
        sf("services/UserService.py", SupportedLanguage.PYTHON, imports=[Import(module="repositories.user", kind="from_import", imported_names=["UserRepository"], line_start=1, line_end=1)]),
        sf("repositories/user.py", SupportedLanguage.PYTHON),
    ]
    report, _ = analyze(files)
    assert report.primary.architecture == ArchitectureType.SERVICE_REPOSITORY
    assert report.primary.confidence >= 0.35


def test_same_named_files_in_different_directories_are_classified_by_directory():
    files = [
        sf("controllers/User.py", SupportedLanguage.PYTHON),
        sf("models/User.py", SupportedLanguage.PYTHON),
    ]
    report, _ = analyze(files)
    assert report.layer_map["controllers/User.py"] == "controller"
    assert report.layer_map["models/User.py"] == "model"


def test_mvc_fixture_detects_mvc_without_service_requirement():
    files = [
        sf("controllers/UserController.py", SupportedLanguage.PYTHON, imports=[Import(module="models.user", kind="from_import", imported_names=["User"], line_start=1, line_end=1)]),
        sf("models/user.py", SupportedLanguage.PYTHON),
        sf("views/user.html", SupportedLanguage.JAVASCRIPT),
    ]
    report, _ = analyze(files)
    assert report.primary.architecture == ArchitectureType.MVC


def test_frontend_backend_fixture_detects_separation():
    files = [
        sf("frontend/src/App.tsx", SupportedLanguage.TSX, imports=[Import(module="react", kind="import", line_start=1, line_end=1)]),
        sf("frontend/src/api.ts", SupportedLanguage.TYPESCRIPT),
        sf("backend/app/main.py", SupportedLanguage.PYTHON, imports=[Import(module="fastapi", kind="import", line_start=1, line_end=1)]),
        sf("backend/app/service.py", SupportedLanguage.PYTHON),
    ]
    report, _ = analyze(files)
    assert report.primary.architecture == ArchitectureType.FRONTEND_BACKEND
    assert report.monorepo.is_monorepo is False


def test_monorepo_fixture_detects_apps_and_packages_roots():
    files = [
        sf("apps/web/src/App.tsx", SupportedLanguage.TSX),
        sf("apps/api/main.py", SupportedLanguage.PYTHON),
        sf("packages/ui/Button.tsx", SupportedLanguage.TSX),
        sf("packages/config/index.ts", SupportedLanguage.TYPESCRIPT),
    ]
    report, _ = analyze(files)
    assert report.monorepo.is_monorepo is True
    assert set(report.monorepo.roots) >= {"apps/api", "apps/web", "packages/config", "packages/ui"}


def test_flat_fixture_prefers_simple_flat_over_unknown():
    files = [sf("main.py", SupportedLanguage.PYTHON), sf("util.py", SupportedLanguage.PYTHON)]
    report, _ = analyze(files)
    assert report.primary.architecture == ArchitectureType.SIMPLE_FLAT


def test_ambiguous_fixture_is_unknown_or_low_confidence():
    files = [sf("src/a.py", SupportedLanguage.PYTHON), sf("src/b.py", SupportedLanguage.PYTHON), sf("docs/readme.md", SupportedLanguage.JAVASCRIPT)]
    report, _ = analyze(files)
    assert report.primary.architecture in {ArchitectureType.UNKNOWN, ArchitectureType.SIMPLE_FLAT}
    if report.primary.architecture == ArchitectureType.UNKNOWN:
        assert report.primary.confidence < 0.35


def test_layered_violation_controller_directly_imports_repository():
    files = [
        sf("controller/UserController.java", SupportedLanguage.JAVA, imports=[Import(module="repository.UserRepository", kind="import", line_start=1, line_end=1)], symbols=[Symbol(name="UserController", kind="class", line_start=1, line_end=2, column_start=0, column_end=1)]),
        sf("service/UserService.java", SupportedLanguage.JAVA, symbols=[Symbol(name="UserService", kind="class", line_start=1, line_end=2, column_start=0, column_end=1)]),
        sf("repository/UserRepository.java", SupportedLanguage.JAVA, symbols=[Symbol(name="UserRepository", kind="class", line_start=1, line_end=2, column_start=0, column_end=1)], package="repository"),
    ]
    report, graph = analyze(files)
    assert report.primary.architecture == ArchitectureType.LAYERED
    assert any(v.kind == "skipped_layer" for v in report.primary.violations)
    assert any(e.edge_type == GraphEdgeType.IMPORTS for e in graph.edges)


def test_backward_repository_to_service_is_detected_for_layered():
    files = [
        sf("controller/C.java", SupportedLanguage.JAVA, symbols=[Symbol(name="C", kind="class", line_start=1, line_end=2, column_start=0, column_end=1)]),
        sf("service/S.java", SupportedLanguage.JAVA, symbols=[Symbol(name="S", kind="class", line_start=1, line_end=2, column_start=0, column_end=1)], package="service"),
        sf("repository/R.java", SupportedLanguage.JAVA, imports=[Import(module="service.S", kind="import", line_start=1, line_end=1)], symbols=[Symbol(name="R", kind="class", line_start=1, line_end=2, column_start=0, column_end=1)], package="repository"),
    ]
    report, _ = analyze(files)
    assert any(v.kind == "backward_dependency" and v.source_layer == "repository" and v.target_layer == "service" for v in report.primary.violations)


def test_no_false_layered_violations_for_flat_repository():
    files = [
        sf("a.py", SupportedLanguage.PYTHON, imports=[Import(module="b", kind="import", line_start=1, line_end=1)]),
        sf("b.py", SupportedLanguage.PYTHON),
    ]
    report, _ = analyze(files)
    assert report.primary.architecture == ArchitectureType.SIMPLE_FLAT
    assert report.primary.violations == []


def test_framework_evidence_is_structured_and_json_serializable():
    files = [
        sf("backend/main.py", SupportedLanguage.PYTHON, imports=[Import(module="fastapi", kind="import", line_start=1, line_end=1)]),
        sf("frontend/App.tsx", SupportedLanguage.TSX, imports=[Import(module="react", kind="import", line_start=1, line_end=1)]),
    ]
    report, _ = analyze(files)
    frameworks = {item.framework for item in report.primary.framework_evidence}
    assert {"FastAPI", "React"} <= frameworks
    json.dumps(report.model_dump(mode="json"))


def test_alternatives_returned_when_candidates_are_close():
    files = [
        sf("controllers/C.py", SupportedLanguage.PYTHON),
        sf("models/M.py", SupportedLanguage.PYTHON),
        sf("views/V.py", SupportedLanguage.PYTHON),
        sf("services/S.py", SupportedLanguage.PYTHON),
        sf("repositories/R.py", SupportedLanguage.PYTHON),
    ]
    report, _ = analyze(files)
    assert report.alternatives
    assert abs(report.primary.confidence - report.alternatives[0].confidence) <= 0.15


def test_empty_repository_is_unknown():
    report, _ = analyze([])
    assert report.primary.architecture == ArchitectureType.UNKNOWN
    assert report.primary.confidence == 0


def test_pipeline_integration_exposes_architecture_report_without_new_endpoint(tmp_path):
    from app.analyzers.pipeline import SourceAnalysisPipeline
    from app.schemas.ingestion import DiscoveredFile

    # SourceAnalysisPipeline works on discovered files and the architecture report is generated
    # after the existing graph stage without introducing another API surface.
    root = tmp_path
    (root / "main.py").write_text("print('ok')\n", encoding="utf-8")
    files, graph, report = SourceAnalysisPipeline().analyze(root, [DiscoveredFile(path="main.py", size_bytes=11, kind="source")])
    assert len(files) == 1
    assert graph.nodes[0].id == "main.py"
    assert report.primary.architecture == ArchitectureType.SIMPLE_FLAT
