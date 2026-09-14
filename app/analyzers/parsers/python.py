import re
from pathlib import Path

from app.analyzers.parsers.common import contains_error, descendants_of_type, name_from_field, node_text, symbol_from_node, walk
from app.analyzers.parsers.tree_sitter_base import ParserDependencyError, TreeSitterParserBase
from app.schemas.source import Import, Inheritance, ParseStatus, SourceFile, SupportedLanguage


class PythonParser(TreeSitterParserBase):
    language = SupportedLanguage.PYTHON

    def _build_parser(self):
        try:
            import tree_sitter_python as ts_python
            from tree_sitter import Language, Parser
        except ImportError as exc:
            raise ParserDependencyError("Tree-sitter Python dependencies are not installed") from exc
        return Parser(Language(ts_python.language()))

    def _extract(self, path: Path, source: bytes, tree) -> SourceFile:
        symbols = []
        imports = []
        inheritance = []
        class_stack: list[str] = []
        seen_nodes: set[int] = set()

        def visit(node):
            node_id = id(node)
            if node_id in seen_nodes:
                return
            seen_nodes.add(node_id)
            if node.type == "class_definition":
                name = name_from_field(node, source)
                if name:
                    parent = class_stack[-1] if class_stack else None
                    symbols.append(symbol_from_node(node, name, "class", parent))
                    bases = node.child_by_field_name("superclasses")
                    if bases is not None:
                        for base in bases.children:
                            if base.type in {"(", ")", ","}:
                                continue
                            base_name = node_text(base, source).strip()
                            if base_name and base_name not in {"*", "**"}:
                                inheritance.append(
                                    Inheritance(
                                        child=name,
                                        parent=base_name,
                                        relation="inherits",
                                        line_start=node.start_point[0] + 1,
                                        line_end=node.end_point[0] + 1,
                                    )
                                )
                    class_stack.append(name)
                    for child in node.children:
                        visit(child)
                    class_stack.pop()
                    return
            if node.type in {"function_definition", "async_function_definition"}:
                name = name_from_field(node, source)
                if name:
                    kind = "method" if class_stack else "function"
                    symbols.append(symbol_from_node(node, name, kind, class_stack[-1] if class_stack else None))
            elif node.type == "import_statement":
                text = node_text(node, source).strip()
                payload = text[len("import") :].strip().rstrip(";")
                for item in payload.split(","):
                    part = item.strip()
                    if not part:
                        continue
                    pieces = re.split(r"\s+as\s+", part, maxsplit=1)
                    imports.append(
                        Import(
                            module=pieces[0].strip(),
                            alias=pieces[1].strip() if len(pieces) == 2 else None,
                            kind="import",
                            line_start=node.start_point[0] + 1,
                            line_end=node.end_point[0] + 1,
                        )
                    )
            elif node.type == "import_from_statement":
                text = node_text(node, source).strip().rstrip(";")
                match = re.match(r"from\s+(.+?)\s+import\s+(.+)$", text, re.DOTALL)
                if match:
                    module = match.group(1).strip()
                    names = [item.strip() for item in match.group(2).split(",") if item.strip()]
                    imports.append(
                        Import(
                            module=module,
                            imported_names=names,
                            kind="from_import",
                            line_start=node.start_point[0] + 1,
                            line_end=node.end_point[0] + 1,
                        )
                    )
            for child in node.children:
                visit(child)

        visit(tree.root_node)
        status = ParseStatus.ERROR if contains_error(tree.root_node) else ParseStatus.SUCCESS
        return SourceFile(
            path=path.as_posix(),
            size_bytes=len(source),
            kind="source",
            language=self.language,
            parse_status=status,
            parse_error="Tree-sitter reported syntax errors" if status == ParseStatus.ERROR else None,
            symbols=symbols,
            imports=imports,
            inheritance=inheritance,
        )
