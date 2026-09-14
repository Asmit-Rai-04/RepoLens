from collections.abc import Iterator
from typing import Any

from app.schemas.source import Symbol


def walk(node: Any) -> Iterator[Any]:
    yield node
    for child in node.children:
        yield from walk(child)


def descendants_of_type(node: Any, *types: str) -> Iterator[Any]:
    wanted = set(types)
    for child in walk(node):
        if child.type in wanted:
            yield child


def node_text(node: Any, source: bytes) -> str:
    return source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def name_from_field(node: Any, source: bytes, field: str = "name") -> str | None:
    field_node = node.child_by_field_name(field)
    return node_text(field_node, source) if field_node is not None else None


def symbol_from_node(node: Any, name: str, kind: str, parent: str | None = None) -> Symbol:
    return Symbol(
        name=name,
        kind=kind,
        line_start=node.start_point[0] + 1,
        line_end=node.end_point[0] + 1,
        column_start=node.start_point[1],
        column_end=node.end_point[1],
        parent=parent,
    )


def contains_error(node: Any) -> bool:
    return any(child.type == "ERROR" or child.is_missing for child in walk(node))


def class_heritage(node: Any) -> Any | None:
    """Return the ``class_heritage`` child of a class node, if any.

    Tree-sitter does not expose ``class_heritage`` as a named field, so the node is
    located by type. The JavaScript grammar nests ``extends`` directly inside
    ``class_heritage``; the TypeScript grammar wraps it in ``extends_clause`` and adds an
    optional ``implements_clause``.
    """
    return next((child for child in node.children if child.type == "class_heritage"), None)


def heritage_parent(heritage: Any | None, source: bytes) -> str | None:
    """Extract the ``extends`` target from a ``class_heritage`` node."""
    if heritage is None:
        return None
    children = list(heritage.children)
    for index, child in enumerate(children):
        if child.type == "extends_clause":
            for sub in child.children:
                if sub.type != "extends":
                    text = node_text(sub, source).strip()
                    if text:
                        return text
            return None
        if child.type == "extends":
            for sub in children[index + 1 :]:
                if sub.type in {"implements", "implements_clause"}:
                    break
                text = node_text(sub, source).strip()
                if text:
                    return text
    return None


def heritage_interfaces(heritage: Any | None, source: bytes) -> list[str]:
    """Extract ``implements`` targets from a ``class_heritage`` node."""
    if heritage is None:
        return []
    parents: list[str] = []
    for child in heritage.children:
        if child.type != "implements_clause":
            continue
        for sub in child.children:
            if sub.type == "implements":
                continue
            text = node_text(sub, source).strip()
            if text and text != ",":
                parents.append(text)
    return parents
