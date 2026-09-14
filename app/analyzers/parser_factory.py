from functools import lru_cache

from app.analyzers.parsers.base import ParserBase
from app.analyzers.parsers.java import JavaParser
from app.analyzers.parsers.javascript import JavaScriptParser
from app.analyzers.parsers.python import PythonParser
from app.analyzers.parsers.tsx import TSXParser
from app.analyzers.parsers.typescript import TypeScriptParser
from app.schemas.source import SupportedLanguage


class ParserFactory:
    _parsers = {
        SupportedLanguage.PYTHON: PythonParser,
        SupportedLanguage.JAVASCRIPT: JavaScriptParser,
        SupportedLanguage.TYPESCRIPT: TypeScriptParser,
        SupportedLanguage.TSX: TSXParser,
        SupportedLanguage.JAVA: JavaParser,
    }

    @classmethod
    @lru_cache(maxsize=8)
    def create(cls, language: SupportedLanguage) -> ParserBase:
        parser_class = cls._parsers.get(language)
        if parser_class is None:
            raise ValueError(f"Unsupported parser language: {language}")
        return parser_class()
