import re
from pathlib import Path

from app.analyzers.parsers.common import contains_error, descendants_of_type, name_from_field, node_text, symbol_from_node
from app.analyzers.parsers.tree_sitter_base import ParserDependencyError, TreeSitterParserBase
from app.schemas.source import Import, Inheritance, ParseStatus, SourceFile, SupportedLanguage


class JavaParser(TreeSitterParserBase):
    language = SupportedLanguage.JAVA

    def _build_parser(self):
        try:
            import tree_sitter_java as ts_java
            from tree_sitter import Language, Parser
        except ImportError as exc:
            raise ParserDependencyError("Tree-sitter Java dependencies are not installed") from exc
        return Parser(Language(ts_java.language()))

    def _extract(self, path: Path, source: bytes, tree) -> SourceFile:
        symbols = []
        imports = []
        inheritance = []
        package_name = None
        for node in descendants_of_type(
            tree.root_node,
            "package_declaration", "import_declaration", "class_declaration", "interface_declaration",
            "method_declaration", "constructor_declaration",
        ):
            line_start, line_end = node.start_point[0] + 1, node.end_point[0] + 1
            if node.type == "package_declaration":
                package_name = node_text(node, source).removeprefix("package").strip().rstrip(";")
            elif node.type == "import_declaration":
                imports.append(Import(module=node_text(node, source).removeprefix("import").strip().removeprefix("static ").rstrip(";"), kind="import", line_start=line_start, line_end=line_end))
            elif node.type == "class_declaration":
                name = name_from_field(node, source)
                if name:
                    symbols.append(symbol_from_node(node, name, "class"))
                    self._java_inheritance(node, source, name, inheritance)
            elif node.type == "interface_declaration":
                name = name_from_field(node, source)
                if name:
                    symbols.append(symbol_from_node(node, name, "interface"))
                    self._java_inheritance(node, source, name, inheritance)
            elif node.type == "method_declaration":
                name = name_from_field(node, source)
                if name:
                    parent = self._parent_type(node, source)
                    symbols.append(symbol_from_node(node, name, "method", parent))
            elif node.type == "constructor_declaration":
                name = name_from_field(node, source)
                if name:
                    parent = self._parent_type(node, source)
                    symbols.append(symbol_from_node(node, name, "constructor", parent))
        status = ParseStatus.ERROR if contains_error(tree.root_node) else ParseStatus.SUCCESS
        return SourceFile(
            path=path.as_posix(), size_bytes=len(source), kind="source", language=self.language, package_name=package_name,
            parse_status=status, parse_error="Tree-sitter reported syntax errors" if status == ParseStatus.ERROR else None,
            symbols=symbols, imports=imports, inheritance=inheritance,
        )

    @staticmethod
    def _parent_type(node, source: bytes) -> str | None:
        current = getattr(node, "parent", None)
        while current is not None:
            if current.type in {"class_declaration", "interface_declaration"}:
                return name_from_field(current, source)
            current = getattr(current, "parent", None)
        return None

    @staticmethod
    def _java_inheritance(node, source: bytes, child: str, output: list[Inheritance]) -> None:
        text = node_text(node, source)
        extends = re.search(r"\bextends\s+([A-Za-z_$][\w$]*(?:\s*<[^>]+>)?)", text)
        if extends:
            output.append(Inheritance(child=child, parent=extends.group(1).strip(), relation="extends", line_start=node.start_point[0] + 1, line_end=node.end_point[0] + 1))
        implements = re.search(r"\bimplements\s+([^\{]+)", text)
        if implements:
            for parent in re.split(r"\s*,\s*", implements.group(1).strip()):
                if parent:
                    output.append(Inheritance(child=child, parent=parent.strip(), relation="implements", line_start=node.start_point[0] + 1, line_end=node.end_point[0] + 1))
