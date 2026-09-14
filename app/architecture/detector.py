from __future__ import annotations

from collections import defaultdict
from pathlib import PurePosixPath

from app.architecture.framework_detector import FrameworkDetector
from app.architecture.layer_classifier import LayerClassifier
from app.architecture.models import (
    ArchitectureCandidate,
    ArchitectureEvidence,
    ArchitectureReport,
    ArchitectureType,
    LayerInfo,
    MonorepoInfo,
)
from app.architecture.monorepo_detector import MonorepoDetector
from app.architecture.violation_detector import ArchitectureViolationDetector
from app.graph.models import DependencyGraphResult, GraphEdgeType
from app.schemas.source import SourceFile


DIRECTORY_WEIGHT = 0.15
DEPENDENCY_WEIGHT = 0.20
FRAMEWORK_WEIGHT = 0.15
NAMING_WEIGHT = 0.10
MIN_CONFIDENCE = 0.35
ALTERNATIVE_GAP = 0.15


class _LayerEvidenceResolver:
    """Collects the resolved dependency edges behind each layer-to-layer claim.

    Evidence must cite real files, so every architecture assertion is backed by actual
    resolved import edges rather than by directory names alone.
    """

    def __init__(self, layer_map: dict[str, str], graph: DependencyGraphResult) -> None:
        self._by_pair: dict[tuple[str, str], set[str]] = defaultdict(set)
        for edge in graph.edges:
            if edge.edge_type != GraphEdgeType.IMPORTS or not edge.resolved or not edge.target_file:
                continue
            source_layer = layer_map.get(edge.source)
            target_layer = layer_map.get(edge.target_file)
            if source_layer and target_layer:
                self._by_pair[(source_layer, target_layer)].update({edge.source, edge.target_file})

    def paths(self, source_layer: str, target_layer: str) -> list[str]:
        return sorted(self._by_pair.get((source_layer, target_layer), set()))

    def paths_to_any(self, source_layer: str, target_layers: tuple[str, ...]) -> list[str]:
        paths: set[str] = set()
        for target_layer in target_layers:
            paths.update(self._by_pair.get((source_layer, target_layer), set()))
        return sorted(paths)


class ArchitectureDetector:
    def __init__(self) -> None:
        self.layer_classifier = LayerClassifier()
        self.framework_detector = FrameworkDetector()
        self.monorepo_detector = MonorepoDetector()
        self.violation_detector = ArchitectureViolationDetector()

    def detect(self, source_files: list[SourceFile], graph: DependencyGraphResult) -> ArchitectureReport:
        layer_map, base_layers = self.layer_classifier.classify(source_files)
        framework_evidence = self.framework_detector.detect(source_files, graph)
        monorepo = self.monorepo_detector.detect(source_files)
        observed = self._observed_layers(layer_map, graph)
        layers = self._enrich_layers(base_layers, observed)
        resolver = _LayerEvidenceResolver(layer_map, graph)

        candidates = [
            self._layered_candidate(layer_map, layers, framework_evidence, observed, resolver),
            self._mvc_candidate(layer_map, layers, framework_evidence, observed, resolver),
            self._service_repository_candidate(layer_map, layers, framework_evidence, observed, resolver),
            self._frontend_backend_candidate(layer_map, layers, framework_evidence, observed, resolver),
            self._monorepo_candidate(monorepo),
            self._simple_flat_candidate(source_files, layer_map, graph, monorepo),
        ]
        candidates.sort(key=lambda candidate: (-candidate.confidence, candidate.architecture.value))
        top = candidates[0]
        if top.confidence < MIN_CONFIDENCE:
            top = self._unknown_candidate(source_files, graph, layer_map, layers, framework_evidence)
            alternatives = []
        else:
            alternatives = [candidate for candidate in candidates[1:] if abs(top.confidence - candidate.confidence) <= ALTERNATIVE_GAP and candidate.confidence >= MIN_CONFIDENCE]

        violations = self.violation_detector.detect(top.architecture, layer_map, graph)
        top = top.model_copy(update={"violations": violations})
        summary = self._summary(top, monorepo, violations)
        return ArchitectureReport(
            primary=top,
            alternatives=alternatives,
            monorepo=monorepo,
            summary=summary,
            layer_map=layer_map,
            metadata={"weights": {"directory_structure": DIRECTORY_WEIGHT, "dependency_direction": DEPENDENCY_WEIGHT, "framework": FRAMEWORK_WEIGHT, "naming": NAMING_WEIGHT}, "minimum_confidence": MIN_CONFIDENCE, "alternative_gap": ALTERNATIVE_GAP},
        )

    @staticmethod
    def _observed_layers(layer_map: dict[str, str], graph: DependencyGraphResult) -> dict[str, set[str]]:
        observed: dict[str, set[str]] = defaultdict(set)
        for edge in graph.edges:
            if edge.edge_type != GraphEdgeType.IMPORTS or not edge.resolved or not edge.target_file:
                continue
            source_layer = layer_map.get(edge.source)
            target_layer = layer_map.get(edge.target_file)
            if source_layer and target_layer:
                observed[source_layer].add(target_layer)
        return observed

    @staticmethod
    def _enrich_layers(layers: list[LayerInfo], observed: dict[str, set[str]]) -> list[LayerInfo]:
        return [layer.model_copy(update={"observed_dependencies": sorted(observed.get(layer.name, set()))}) for layer in layers]

    def _layered_candidate(self, layer_map, layers, frameworks, observed, resolver):
        evidence: list[ArchitectureEvidence] = []
        for layer_name in ("controller", "service", "repository"):
            info = next((item for item in layers if item.name == layer_name), None)
            if info:
                evidence.append(ArchitectureEvidence(type="directory_structure", description=f"{layer_name} layer detected ({len(info.paths)} files)", supporting_paths=info.paths, weight=DIRECTORY_WEIGHT))
        if "service" in observed.get("controller", set()):
            evidence.append(ArchitectureEvidence(type="dependency_direction", description="controller depends on service", supporting_paths=resolver.paths("controller", "service"), weight=DEPENDENCY_WEIGHT))
        if "repository" in observed.get("service", set()):
            evidence.append(ArchitectureEvidence(type="dependency_direction", description="service depends on repository", supporting_paths=resolver.paths("service", "repository"), weight=DEPENDENCY_WEIGHT))
        for framework in frameworks:
            if framework.framework == "Spring Boot":
                evidence.append(ArchitectureEvidence(type="framework", description="Spring Boot framework evidence detected", supporting_paths=framework.supporting_paths, weight=FRAMEWORK_WEIGHT))
        if any(self._name_has(source, "Controller") for source in layer_map if layer_map[source] == "controller"):
            evidence.append(ArchitectureEvidence(type="naming", description="controller filenames use Controller convention", supporting_paths=[path for path, layer in layer_map.items() if layer == "controller"], weight=NAMING_WEIGHT))
        return self._candidate(ArchitectureType.LAYERED, evidence, layers, frameworks)

    def _mvc_candidate(self, layer_map, layers, frameworks, observed, resolver):
        evidence: list[ArchitectureEvidence] = []
        for layer_name in ("controller", "model", "view"):
            info = next((item for item in layers if item.name == layer_name), None)
            if info:
                evidence.append(ArchitectureEvidence(type="directory_structure", description=f"{layer_name} layer detected ({len(info.paths)} files)", supporting_paths=info.paths, weight=DIRECTORY_WEIGHT))
        if "model" in observed.get("controller", set()) or "view" in observed.get("controller", set()):
            evidence.append(ArchitectureEvidence(type="dependency_direction", description="controller depends on MVC model/view layer", supporting_paths=resolver.paths_to_any("controller", ("model", "view")), weight=DEPENDENCY_WEIGHT))
        for framework in frameworks:
            if framework.framework == "Django":
                evidence.append(ArchitectureEvidence(type="framework", description="Django framework evidence detected", supporting_paths=framework.supporting_paths, weight=FRAMEWORK_WEIGHT))
        if any(self._name_has(source, "Controller") for source in layer_map if layer_map[source] == "controller"):
            evidence.append(ArchitectureEvidence(type="naming", description="controller filenames use Controller convention", supporting_paths=[path for path, layer in layer_map.items() if layer == "controller"], weight=NAMING_WEIGHT))
        return self._candidate(ArchitectureType.MVC, evidence, layers, frameworks)

    def _service_repository_candidate(self, layer_map, layers, frameworks, observed, resolver):
        evidence: list[ArchitectureEvidence] = []
        for layer_name in ("service", "repository"):
            info = next((item for item in layers if item.name == layer_name), None)
            if info:
                evidence.append(ArchitectureEvidence(type="directory_structure", description=f"{layer_name} layer detected ({len(info.paths)} files)", supporting_paths=info.paths, weight=DIRECTORY_WEIGHT))
        if "repository" in observed.get("service", set()):
            evidence.append(ArchitectureEvidence(type="dependency_direction", description="service depends on repository", supporting_paths=resolver.paths("service", "repository"), weight=DEPENDENCY_WEIGHT))
        if not any(layer.name == "controller" for layer in layers):
            evidence.append(ArchitectureEvidence(type="naming", description="service/repository structure has no distinct controller layer", supporting_paths=[], weight=NAMING_WEIGHT))
        for framework in frameworks:
            if framework.framework == "Spring Boot" and any(layer.name == "service" for layer in layers):
                evidence.append(ArchitectureEvidence(type="framework", description="Spring Boot service/repository evidence detected", supporting_paths=framework.supporting_paths, weight=FRAMEWORK_WEIGHT))
        return self._candidate(ArchitectureType.SERVICE_REPOSITORY, evidence, layers, frameworks)

    def _frontend_backend_candidate(self, layer_map, layers, frameworks, observed, resolver):
        evidence: list[ArchitectureEvidence] = []
        for layer_name in ("frontend", "backend"):
            info = next((item for item in layers if item.name == layer_name), None)
            if info:
                evidence.append(ArchitectureEvidence(type="directory_structure", description=f"{layer_name} root detected ({len(info.paths)} files)", supporting_paths=info.paths, weight=DIRECTORY_WEIGHT))
        if "backend" in observed.get("frontend", set()):
            evidence.append(ArchitectureEvidence(type="dependency_direction", description="frontend depends on backend", supporting_paths=resolver.paths("frontend", "backend"), weight=DEPENDENCY_WEIGHT))
        frontend_frameworks = {item.framework for item in frameworks if item.framework == "React"}
        backend_frameworks = {item.framework for item in frameworks if item.framework in {"FastAPI", "Express", "Django"}}
        if frontend_frameworks and backend_frameworks:
            evidence.append(ArchitectureEvidence(type="framework", description="frontend and backend framework evidence detected", supporting_paths=[path for item in frameworks for path in item.supporting_paths], weight=FRAMEWORK_WEIGHT))
        if len({layer for layer in layer_map.values() if layer in {"frontend", "backend"}}) == 2:
            evidence.append(ArchitectureEvidence(type="naming", description="separate frontend/backend path conventions detected", supporting_paths=[path for path, layer in layer_map.items() if layer in {"frontend", "backend"}], weight=NAMING_WEIGHT))
        return self._candidate(ArchitectureType.FRONTEND_BACKEND, evidence, layers, frameworks)

    @staticmethod
    def _monorepo_candidate(monorepo: MonorepoInfo):
        return ArchitectureCandidate(
            architecture=ArchitectureType.MONOREPO,
            confidence=min(1.0, sum(e.weight for e in monorepo.evidence)),
            evidence=monorepo.evidence,
            layers=[],
            violations=[],
            framework_evidence=[],
        )

    @staticmethod
    def _simple_flat_candidate(source_files, layer_map, graph, monorepo):
        evidence: list[ArchitectureEvidence] = []
        source_count = len(source_files)
        root_level = [item.path for item in source_files if len(PurePosixPath(item.path).parts) <= 2]
        if source_count <= 12 and not layer_map and not monorepo.is_monorepo and root_level:
            evidence.append(ArchitectureEvidence(type="directory_structure", description="small source set with flat/simple paths", supporting_paths=sorted(root_level), weight=DIRECTORY_WEIGHT))
            evidence.append(ArchitectureEvidence(type="dependency_direction", description="no architecture-specific layer direction competes with the flat structure", supporting_paths=[], weight=DEPENDENCY_WEIGHT))
            evidence.append(ArchitectureEvidence(type="naming", description="no conventional architecture layer naming detected", supporting_paths=[], weight=NAMING_WEIGHT))
        return ArchitectureCandidate(architecture=ArchitectureType.SIMPLE_FLAT, confidence=min(1.0, sum(e.weight for e in evidence)), evidence=evidence)

    @staticmethod
    def _unknown_candidate(source_files, graph, layer_map, layers, frameworks):
        evidence = [ArchitectureEvidence(type="insufficient_evidence", description="no architecture candidate reached the minimum confidence threshold", supporting_paths=[item.path for item in source_files], weight=0.0)]
        return ArchitectureCandidate(architecture=ArchitectureType.UNKNOWN, confidence=0.0, evidence=evidence, layers=layers, framework_evidence=frameworks)

    @staticmethod
    def _candidate(architecture, evidence, layers, frameworks):
        confidence = min(1.0, sum(item.weight for item in evidence))
        return ArchitectureCandidate(architecture=architecture, confidence=confidence, evidence=evidence, layers=layers, framework_evidence=frameworks)

    @staticmethod
    def _name_has(path: str, token: str) -> bool:
        return token.lower() in PurePosixPath(path).name.lower()

    @staticmethod
    def _summary(candidate: ArchitectureCandidate, monorepo: MonorepoInfo, violations):
        if candidate.architecture == ArchitectureType.UNKNOWN:
            return "Architecture evidence is insufficient for a confident classification."
        suffix = f" {len(violations)} architecture violation(s) detected." if violations else " No architecture violations detected."
        if monorepo.is_monorepo and candidate.architecture != ArchitectureType.MONOREPO:
            suffix += " Monorepo evidence is also present."
        return f"Detected {candidate.architecture.value} architecture with {candidate.confidence:.2f} confidence." + suffix
