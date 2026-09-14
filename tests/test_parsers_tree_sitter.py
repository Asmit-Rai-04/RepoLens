import pytest

pytest.importorskip("tree_sitter")
pytest.importorskip("tree_sitter_python")
pytest.importorskip("tree_sitter_javascript")
pytest.importorskip("tree_sitter_typescript")
pytest.importorskip("tree_sitter_java")

from pathlib import Path

import pytest

from app.analyzers.parser_factory import ParserFactory
from app.schemas.source import ParseStatus, SupportedLanguage


def parse(language: SupportedLanguage, suffix: str, source: str):
    """Parse source with the repository-relative path the real pipeline passes."""
    return ParserFactory.create(language).parse(Path(f"sample{suffix}"), source.encode("utf-8"))


def test_python_symbols_imports_inheritance_and_ranges():
    source = """import os\nfrom collections import deque as D\n\nclass Child(Base):\n    def method(self):\n        return 1\n\ndef helper():\n    return 2\n"""
    result = parse(SupportedLanguage.PYTHON, ".py", source)
    assert result.parse_status == ParseStatus.SUCCESS
    assert result.path == "sample.py"
    assert {s.name for s in result.symbols} == {"Child", "method", "helper"}
    assert next(s for s in result.symbols if s.name == "method").kind == "method"
    assert next(s for s in result.symbols if s.name == "method").line_start == 5
    assert next(s for s in result.symbols if s.name == "method").line_end == 6
    assert {i.module for i in result.imports} == {"os", "collections"}
    assert result.inheritance[0].parent == "Base"


def test_javascript_functions_classes_methods_import_require_extends():
    source = """import { readFile } from 'fs';\nconst lib = require('lib');\nclass Child extends Base {\n  method() { return 1; }\n}\nfunction helper() { return 2; }\n"""
    result = parse(SupportedLanguage.JAVASCRIPT, ".js", source)
    assert result.parse_status == ParseStatus.SUCCESS
    assert {s.name for s in result.symbols} >= {"Child", "method", "helper"}
    assert {i.module for i in result.imports} == {"fs", "lib"}
    assert result.inheritance[0].parent == "Base"


def test_typescript_interface_implements_and_function():
    source = """interface User { id: number }\nclass Admin implements User {\n  id = 1;\n  save() {}\n}\nfunction load(): User { return new Admin(); }\n"""
    result = parse(SupportedLanguage.TYPESCRIPT, ".ts", source)
    assert result.parse_status == ParseStatus.SUCCESS
    assert any(s.name == "User" and s.kind == "interface" for s in result.symbols)
    assert any(i.parent == "User" and i.relation == "implements" for i in result.inheritance)
    assert any(s.name == "load" and s.kind == "function" for s in result.symbols)


def test_tsx_react_component_is_identified():
    source = """import React from 'react';\nexport function Hello() {\n  return <div>Hello</div>;\n}\n"""
    result = parse(SupportedLanguage.TSX, ".tsx", source)
    assert result.parse_status == ParseStatus.SUCCESS
    assert any(s.name == "Hello" and s.kind == "react_component" for s in result.symbols)
    assert any(i.module == "react" for i in result.imports)


def test_java_package_import_classes_interfaces_methods_constructors_inheritance():
    source = """package demo;\nimport java.util.List;\ninterface RunnableThing {}\nclass Child extends Base implements RunnableThing {\n  Child() {}\n  void run() {}\n}\n"""
    result = parse(SupportedLanguage.JAVA, ".java", source)
    assert result.parse_status == ParseStatus.SUCCESS
    assert result.package_name == "demo"
    assert any(i.module == "java.util.List" for i in result.imports)
    assert any(s.name == "RunnableThing" and s.kind == "interface" for s in result.symbols)
    assert any(s.name == "Child" and s.kind == "class" for s in result.symbols)
    assert any(s.kind == "constructor" for s in result.symbols)
    assert any(s.name == "run" and s.kind == "method" for s in result.symbols)
    assert any(i.child == "Child" and i.parent == "Base" and i.relation == "extends" for i in result.inheritance)
    assert any(i.child == "Child" and i.parent == "RunnableThing" and i.relation == "implements" for i in result.inheritance)


@pytest.mark.parametrize(
    ("language", "suffix"),
    [
        (SupportedLanguage.PYTHON, ".py"),
        (SupportedLanguage.JAVASCRIPT, ".js"),
        (SupportedLanguage.TYPESCRIPT, ".ts"),
        (SupportedLanguage.TSX, ".tsx"),
        (SupportedLanguage.JAVA, ".java"),
    ],
)
def test_empty_source(language, suffix):
    result = parse(language, suffix, "")
    assert result.parse_status == ParseStatus.EMPTY
    assert result.symbols == []


def test_malformed_source_is_preserved_with_error_status():
    result = parse(SupportedLanguage.PYTHON, ".py", "def broken(:\n    pass\n")
    assert result.parse_status == ParseStatus.ERROR
    assert result.parse_error
    assert result.path == "sample.py"


def test_typescript_class_with_extends_and_implements_keeps_both_relations():
    source = "interface User { id: number }\nclass Base {}\nclass Admin extends Base implements User { id = 1; }\n"
    result = parse(SupportedLanguage.TYPESCRIPT, ".ts", source)
    relations = {(item.parent, item.relation) for item in result.inheritance}
    assert relations == {("Base", "extends"), ("User", "implements")}


def test_typescript_implements_list_is_split_into_separate_relations():
    source = "class Admin implements First, Second {}"
    result = parse(SupportedLanguage.TYPESCRIPT, ".ts", source)
    assert {item.parent for item in result.inheritance if item.relation == "implements"} == {"First", "Second"}


@pytest.mark.parametrize("absolute", ["/etc/passwd", "C:/server/secret.py", "../outside.py", "src/../../outside.py"])
def test_absolute_and_traversing_paths_are_rejected(absolute: str):
    """SourceFile.path feeds API responses, so it must never hold a filesystem path."""
    with pytest.raises(ValueError):
        ParserFactory.create(SupportedLanguage.PYTHON).parse(Path(absolute), b"x = 1\n")
