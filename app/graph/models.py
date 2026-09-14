from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class GraphNodeType(StrEnum):
    FILE = "file"
    EXTERNAL = "external"
    UNRESOLVED = "unresolved"


class GraphEdgeType(StrEnum):
    IMPORTS = "IMPORTS"
    EXTENDS = "EXTENDS"
    IMPLEMENTS = "IMPLEMENTS"


class GraphNode(BaseModel):
    id: str = Field(min_length=1)
    node_type: GraphNodeType
    path_name: str = Field(min_length=1)
    language: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class GraphEdge(BaseModel):
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)
    edge_type: GraphEdgeType
    resolved: bool
    import_evidence: dict[str, Any] = Field(default_factory=dict)
    source_file: str = Field(min_length=1)
    target_file: str | None = None


class NodeMetrics(BaseModel):
    incoming_dependencies: int = Field(ge=0)
    outgoing_dependencies: int = Field(ge=0)
    degree: int = Field(ge=0)
    betweenness_centrality: float = Field(ge=0)
    importance: float = Field(ge=0)
    rank: int = Field(ge=1)


class CycleInfo(BaseModel):
    files: list[str] = Field(min_length=2)
    length: int = Field(ge=2)


class DependencyGraphMetrics(BaseModel):
    node_metrics: dict[str, NodeMetrics] = Field(default_factory=dict)


def import_edge_status(edge: GraphEdge) -> str:
    """Classify an IMPORTS edge as ``external``, ``resolved``, or ``unresolved``.

    The resolver's classification is preserved as edge evidence, so a single definition
    keeps health scoring, insights, and file inspection consistent. External dependencies
    are never treated as unresolved internal imports.
    """
    if str(edge.import_evidence.get("classification", "")) == "external":
        return "external"
    return "resolved" if edge.resolved else "unresolved"


class DependencyGraphResult(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    metrics: DependencyGraphMetrics
    cycles: list[CycleInfo] = Field(default_factory=list)
    # True when a strongly connected component holds more cycles than are reported, so the cycle
    # list shows the shortest ones rather than every possible cycle.
    cycles_truncated: bool = False
    strongly_connected_components: list[list[str]] = Field(default_factory=list)
    importance_ranking: list[str] = Field(default_factory=list)
