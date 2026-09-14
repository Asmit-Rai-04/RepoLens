from pathlib import Path

from app.core.exceptions import RepoLensError
from app.schemas.source import ParseStatus, SourceFile, SupportedLanguage
from app.analyzers.parsers.base import ParserBase


class ParserDependencyError(RepoLensError):
    """Raised when the Tree-sitter runtime or a required grammar is unavailable."""


class TreeSitterParserBase(ParserBase):
    language: SupportedLanguage

    def __init__(self) -> None:
        self._parser = self._build_parser()

    def _build_parser(self):
        raise NotImplementedError

    def parser_language(self):
        return self.language

    def parse(self, path: Path, source: bytes) -> SourceFile:
        metadata = {
            "path": path.as_posix(),
            "size_bytes": len(source),
            "kind": "source",
            "language": self.language,
        }
        if not source:
            return SourceFile(**metadata, parse_status=ParseStatus.EMPTY)
        try:
            tree = self._parser.parse(source)
            return self._extract(path, source, tree)
        except (UnicodeError, ValueError, TypeError, RuntimeError) as exc:
            return SourceFile(
                **metadata,
                parse_status=ParseStatus.ERROR,
                parse_error=self._sanitize_error(exc),
            )

    def _extract(self, path: Path, source: bytes, tree) -> SourceFile:
        raise NotImplementedError

    @staticmethod
    def _sanitize_error(exc: Exception) -> str:
        return f"{type(exc).__name__}: {exc}"[:500]
