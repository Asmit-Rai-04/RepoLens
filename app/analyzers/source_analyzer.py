from pathlib import Path

from app.analyzers.language_detector import LanguageDetector
from app.analyzers.parser_factory import ParserFactory
from app.analyzers.parsers.tree_sitter_base import ParserDependencyError
from app.schemas.ingestion import DiscoveredFile
from app.schemas.source import ParseStatus, SourceFile


class SourceAnalyzer:
    def __init__(self) -> None:
        self.detector = LanguageDetector()

    def analyze(self, root: Path, discovered: list[DiscoveredFile]) -> list[SourceFile]:
        results: list[SourceFile] = []
        for item in discovered:
            if item.kind != "source":
                continue
            path = root / Path(item.path)
            language = self.detector.detect(path)
            if language is None:
                results.append(SourceFile(
                    path=item.path,
                    size_bytes=item.size_bytes,
                    kind="source",
                    language=None,
                    parse_status=ParseStatus.UNSUPPORTED,
                    parse_error="Unsupported or undetected source language",
                ))
                continue
            try:
                source = path.read_bytes()
                parser = ParserFactory.create(language)
                parsed = parser.parse(path=Path(item.path), source=source)
            except ParserDependencyError as exc:
                parsed = SourceFile(
                    path=item.path,
                    size_bytes=item.size_bytes,
                    kind="source",
                    language=language,
                    parse_status=ParseStatus.ERROR,
                    parse_error=str(exc),
                )
            except OSError as exc:
                parsed = SourceFile(
                    path=item.path,
                    size_bytes=item.size_bytes,
                    kind="source",
                    language=language,
                    parse_status=ParseStatus.ERROR,
                    parse_error=f"Unable to read source file: {exc.__class__.__name__}",
                )
            results.append(parsed)
        return results
