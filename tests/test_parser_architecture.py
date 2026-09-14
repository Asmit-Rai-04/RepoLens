import pytest

from app.analyzers.parser_factory import ParserFactory
from app.analyzers.parsers.tree_sitter_base import ParserDependencyError
from app.schemas.source import SupportedLanguage


def test_factory_declares_every_supported_parser():
    for language in SupportedLanguage:
        try:
            parser = ParserFactory.create(language)
        except ParserDependencyError:
            continue
        assert parser.language == language


def test_factory_rejects_unknown_language():
    with pytest.raises(ValueError):
        ParserFactory.create("go")  # type: ignore[arg-type]
