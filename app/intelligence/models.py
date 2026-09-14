from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class HealthStatus(StrEnum):
    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"
    CRITICAL = "critical"


class FindingSeverity(StrEnum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class HealthDimension(BaseModel):
    score: float = Field(ge=0, le=100)
    status: HealthStatus
    explanation: str = Field(min_length=1)
    metrics: dict[str, int | float | str | bool | None] = Field(default_factory=dict)


class HealthWeights(BaseModel):
    parse: float = Field(ge=0, le=1)
    imports: float = Field(ge=0, le=1)
    cycles: float = Field(ge=0, le=1)
    architecture: float = Field(ge=0, le=1)
    coupling: float = Field(ge=0, le=1)


class CycleSeverity(BaseModel):
    files: list[str] = Field(min_length=2)
    length: int = Field(ge=2)
    severity: FindingSeverity
    reason: str = Field(min_length=1)


class CouplingHotspot(BaseModel):
    path: str = Field(min_length=1)
    incoming_dependencies: int = Field(ge=0)
    outgoing_dependencies: int = Field(ge=0)
    centrality: float = Field(ge=0)
    importance: float = Field(ge=0)
    rank: int = Field(ge=1)
    reason: str = Field(min_length=1)


class ProblemFile(BaseModel):
    path: str = Field(min_length=1)
    reasons: list[str] = Field(default_factory=list)
    metrics: dict[str, int | float | str | bool | None] = Field(default_factory=dict)


class ArchitectureViolationInsight(BaseModel):
    kind: str
    source: str
    target: str
    source_layer: str
    target_layer: str
    description: str
    severity: FindingSeverity


class KeyFinding(BaseModel):
    severity: FindingSeverity
    category: str
    title: str
    description: str
    related_files: list[str] = Field(default_factory=list)


class RepositorySummary(BaseModel):
    repository_name: str
    total_files: int = Field(ge=0)
    source_files: int = Field(ge=0)
    languages: dict[str, int]
    architecture: str
    architecture_confidence: float = Field(ge=0, le=1)
    dependency_count: int = Field(ge=0)
    cycle_count: int = Field(ge=0)
    scc_count: int = Field(ge=0)
    unresolved_imports: int = Field(ge=0)
    architecture_violations: int = Field(ge=0)
    health_score: float = Field(ge=0, le=100)


class HealthReport(BaseModel):
    score: float = Field(ge=0, le=100)
    status: HealthStatus
    weights: HealthWeights
    dimensions: dict[str, HealthDimension]
    coupling_hotspots: list[CouplingHotspot] = Field(default_factory=list)
    cycle_severity: list[CycleSeverity] = Field(default_factory=list)
    problem_files: list[ProblemFile] = Field(default_factory=list)


class InsightsReport(BaseModel):
    summary: RepositorySummary
    health: HealthReport
    key_findings: list[KeyFinding] = Field(default_factory=list)
    coupling_hotspots: list[CouplingHotspot] = Field(default_factory=list)
    cycle_severity: list[CycleSeverity] = Field(default_factory=list)
    problem_files: list[ProblemFile] = Field(default_factory=list)
    architecture_violations: list[ArchitectureViolationInsight] = Field(default_factory=list)
    clean_state: bool
    clean_state_message: str | None = None
