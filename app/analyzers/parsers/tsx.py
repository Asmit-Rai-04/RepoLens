from pathlib import Path

from app.analyzers.parsers.common import descendants_of_type, name_from_field, symbol_from_node
from app.analyzers.parsers.tree_sitter_base import ParserDependencyError
from app.analyzers.parsers.typescript import TypeScriptParser
from app.schemas.source import ParseStatus, SourceFile, SupportedLanguage


class TSXParser(TypeScriptParser):
    language = SupportedLanguage.TSX

    def _build_parser(self):
        try:
            import tree_sitter_typescript as ts_typescript
            from tree_sitter import Language, Parser
        except ImportError as exc:
            raise ParserDependencyError("Tree-sitter TypeScript dependencies are not installed") from exc
        return Parser(Language(ts_typescript.language_tsx()))

    def _extract(self, path: Path, source: bytes, tree) -> SourceFile:
        source_file = super()._extract(path, source, tree)
        jsx_nodes = list(descendants_of_type(tree.root_node, "jsx_element", "jsx_self_closing_element"))
        for node in descendants_of_type(tree.root_node, "function_declaration", "variable_declarator", "method_definition"):
            name = name_from_field(node, source)
            if not name or not name[:1].isupper():
                continue
            if any(jsx.start_byte >= node.start_byte and jsx.end_byte <= node.end_byte for jsx in jsx_nodes):
                for symbol in source_file.symbols:
                    if symbol.name == name and symbol.line_start == node.start_point[0] + 1:
                        symbol.kind = "react_component"
                        break
        return source_file
