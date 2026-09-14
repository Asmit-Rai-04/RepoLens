from pathlib import Path

from app.schemas.ingestion import GitHubRepository
from app.services.extractor import ExtractionOutcome
from app.services.ingestion import RepositoryIngestionService


def test_ingestion_pipeline_includes_source_analysis(temp_root: Path, settings, monkeypatch):
    root = temp_root / "repo"
    root.mkdir()
    (root / "main.py").write_text("def hello():\n    return 1\n", encoding="utf-8")
    (root / "README.md").write_text("docs", encoding="utf-8")

    service = RepositoryIngestionService(settings)
    repository = GitHubRepository(
        owner="u", name="r", canonical_url="https://github.com/u/r", default_branch="main", archive_url="https://example.invalid/r.tar.gz"
    )

    monkeypatch.setattr(
        service.github,
        "get_repository_metadata",
        lambda _: type("M", (), {"repository": repository, "oversized_reported": False})(),
    )
    monkeypatch.setattr(service.downloader, "download", lambda *_: temp_root / "repo.tar.gz")
    monkeypatch.setattr(
        service.extractor,
        "extract_with_report",
        lambda *_: ExtractionOutcome(root=root, extracted_files=2, extracted_bytes=32),
    )

    result = service.ingest("https://github.com/u/r")
    assert result.source_files == 1
    assert len(result.source_file_analyses) == 1
    assert result.source_file_analyses[0].path == "main.py"


def test_unsupported_source_language_is_preserved(temp_root: Path, settings):
    root = temp_root / "repo"
    root.mkdir()
    (root / "main.rs").write_text("fn main() {}", encoding="utf-8")

    from app.analyzers.source_analyzer import SourceAnalyzer
    from app.schemas.ingestion import DiscoveredFile
    from app.schemas.source import ParseStatus

    discovered = [DiscoveredFile(path="main.rs", size_bytes=12, kind="source")]
    result = SourceAnalyzer().analyze(root, discovered)
    assert result[0].parse_status == ParseStatus.UNSUPPORTED
    assert result[0].path == "main.rs"
