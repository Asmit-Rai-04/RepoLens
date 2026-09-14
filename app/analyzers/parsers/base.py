from abc import ABC, abstractmethod
from pathlib import Path

from app.schemas.source import SourceFile, SupportedLanguage


class ParserBase(ABC):
    language: SupportedLanguage

    def parse(self, path: Path, source: bytes) -> SourceFile:
        raise NotImplementedError

    @staticmethod
    def source_metadata(path: Path, language: SupportedLanguage | None, size_bytes: int) -> dict:
        return {
            "path": path.as_posix(),
            "size_bytes": size_bytes,
            "kind": "source",
            "language": language,
        }

    @abstractmethod
    def parser_language(self):
        raise NotImplementedError
