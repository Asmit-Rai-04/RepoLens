import re
from pathlib import Path

from app.analyzers.parsers.common import (
    class_heritage,
    contains_error,
    descendants_of_type,
    heritage_interfaces,
    heritage_parent,
    name_from_field,
    node_text,
    symbol_from_node,
)
from app.analyzers.parsers.tree_sitter_base import ParserDependencyError, TreeSitterParserBase
from app.schemas.source import Import, Inheritance, ParseStatus, SourceFile, SupportedLanguage


class JavaScriptParser(TreeSitterParserBase):
    language = SupportedLanguage.JAVASCRIPT

    def _build_parser(self):
        try:
            import tree_sitter_javascript as ts_javascript
            from tree_sitter import Language, Parser
        except ImportError as exc:
            raise ParserDependencyError("Tree-sitter JavaScript dependencies are not installed") from exc
        return Parser(Language(ts_javascript.language()))

    def _extract(self, path: Path, source: bytes, tree) -> SourceFile:
        symbols = []
        imports = []
        inheritance = []

        def nearest_class(node):
            current = node
            while current is not None:
                if current.type in {"class_declaration", "class"}:
                    return name_from_field(current, source)
                current = getattr(current, "parent", None)
            return None

        for node in descendants_of_type(
            tree.root_node,
            "function_declaration",
            "function",
            "class_declaration",
            "method_definition",
            "variable_declarator",
            "import_statement",
            "call_expression",
        ):
            if node.type == "function_declaration":
                name = name_from_field(node, source)
                if name:
                    symbols.append(symbol_from_node(node, name, "function"))
            elif node.type == "function":
                name = name_from_field(node, source)
                if name:
                    parent = nearest_class(node)
                    symbols.append(symbol_from_node(node, name, "method" if parent else "function", parent))
            elif node.type == "class_declaration":
                name = name_from_field(node, source)
                if name:
                    symbols.append(symbol_from_node(node, name, "class"))
                    heritage = class_heritage(node)
                    parent = heritage_parent(heritage, source)
                    if parent:
                        inheritance.append(Inheritance(
                            child=name, parent=parent, relation="extends",
                            line_start=node.start_point[0] + 1, line_end=node.end_point[0] + 1,
                        ))
                    for interface in heritage_interfaces(heritage, source):
                        inheritance.append(Inheritance(
                            child=name, parent=interface, relation="implements",
                            line_start=node.start_point[0] + 1, line_end=node.end_point[0] + 1,
                        ))
            elif node.type == "method_definition":
                name = name_from_field(node, source)
                if name:
                    parent = nearest_class(node)
                    symbols.append(symbol_from_node(node, name, "method", parent))
            elif node.type == "variable_declarator":
                value = node.child_by_field_name("value")
                name = name_from_field(node, source)
                if value is not None and value.type in {"arrow_function", "function"} and name:
                    parent = nearest_class(node)
                    symbols.append(symbol_from_node(node, name, "method" if parent else "function", parent))
            elif node.type == "import_statement":
                text = node_text(node, source).strip()
                module_match = re.search(r"from\s+['\"]([^'\"]+)['\"]", text)
                if not module_match:
                    module_match = re.search(r"import\s+['\"]([^'\"]+)['\"]", text)
                if module_match:
                    imported_names = []
                    named = re.search(r"\{([^}]*)\}", text, re.DOTALL)
                    if named:
                        imported_names = [part.strip().split(" as ")[0].strip() for part in named.group(1).split(",") if part.strip()]
                    imports.append(Import(
                        module=module_match.group(1), kind="import", imported_names=imported_names,
                        line_start=node.start_point[0] + 1, line_end=node.end_point[0] + 1,
                    ))
            elif node.type == "call_expression":
                function = node.child_by_field_name("function")
                arguments = node.child_by_field_name("arguments")
                if function is not None and node_text(function, source) == "require" and arguments is not None:
                    text = node_text(arguments, source)
                    match = re.search(r"['\"]([^'\"]+)['\"]", text)
                    if match:
                        imports.append(Import(
                            module=match.group(1), kind="require",
                            line_start=node.start_point[0] + 1, line_end=node.end_point[0] + 1,
                        ))

        status = ParseStatus.ERROR if contains_error(tree.root_node) else ParseStatus.SUCCESS
        return SourceFile(
            path=path.as_posix(), size_bytes=len(source), kind="source", language=self.language,
            parse_status=status,
            parse_error="Tree-sitter reported syntax errors" if status == ParseStatus.ERROR else None,
            symbols=symbols, imports=imports, inheritance=inheritance,
        )
