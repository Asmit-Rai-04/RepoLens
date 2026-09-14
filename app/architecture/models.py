from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class ArchitectureType(StrEnum):
    LAYERED = "Layered"
    MVC = "MVC"
    SERVICE_REPOSITORY = "Service/Repository Pattern"
    FRONTEND_BACKEND = "Frontend/Backend Separation"
    MONOREPO = "Monorepo"
    SIMPLE_FLAT = "Simple/Flat"
    UNKNOWN = "Unknown"


class ArchitectureEvidence(BaseModel):
    type: str = Field(min_length=1)
    description: str = Field(min_length=1)
    supporting_paths: list[str] = Field(default_factory=list)
    weight: float = Field(ge=0, le=1)


class LayerInfo(BaseModel):
    name: str = Field(min_length=1)
    paths: list[str] = Field(default_factory=list)
    expected_dependencies: list[str] = Field(default_factory=list)
    forbidden_dependencies: list[str] = Field(default_factory=list)
    observed_dependencies: list[str] = Field(default_factory=list)


class FrameworkEvidence(BaseModel):
    framework: str = Field(min_length=1)
    supporting_paths: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)


class ArchitectureViolation(BaseModel):
    kind: str = Field(min_length=1)
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)
    source_layer: str = Field(min_length=1)
    target_layer: str = Field(min_length=1)
    description: str = Field(min_length=1)
    evidence: list[str] = Field(default_factory=list)


class MonorepoInfo(BaseModel):
    is_monorepo: bool
    roots: list[str] = Field(default_factory=list)
    evidence: list[ArchitectureEvidence] = Field(default_factory=list)


class ArchitectureCandidate(BaseModel):
    architecture: ArchitectureType
    confidence: float = Field(ge=0, le=1)
    evidence: list[ArchitectureEvidence] = Field(default_factory=list)
    layers: list[LayerInfo] = Field(default_factory=list)
    violations: list[ArchitectureViolation] = Field(default_factory=list)
    framework_evidence: list[FrameworkEvidence] = Field(default_factory=list)


class ArchitectureReport(BaseModel):
    primary: ArchitectureCandidate
    alternatives: list[ArchitectureCandidate] = Field(default_factory=list)
    monorepo: MonorepoInfo
    summary: str = Field(min_length=1)
    layer_map: dict[str, str] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
