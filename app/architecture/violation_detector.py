from __future__ import annotations

from app.architecture.models import ArchitectureType, ArchitectureViolation
from app.graph.models import DependencyGraphResult, GraphEdgeType


class ArchitectureViolationDetector:
    def detect(self, architecture: ArchitectureType, layer_map: dict[str, str], graph: DependencyGraphResult) -> list[ArchitectureViolation]:
        violations: list[ArchitectureViolation] = []
        for edge in graph.edges:
            if edge.edge_type != GraphEdgeType.IMPORTS or not edge.resolved or not edge.target_file:
                continue
            source_layer = layer_map.get(edge.source)
            target_layer = layer_map.get(edge.target_file)
            if not source_layer or not target_layer:
                continue
            if source_layer == target_layer:
                continue
            if architecture == ArchitectureType.LAYERED:
                violations.extend(self._layered(edge.source, edge.target_file, source_layer, target_layer))
            elif architecture == ArchitectureType.SERVICE_REPOSITORY:
                violations.extend(self._service_repository(edge.source, edge.target_file, source_layer, target_layer))
            elif architecture == ArchitectureType.MVC:
                violations.extend(self._mvc(edge.source, edge.target_file, source_layer, target_layer))
            elif architecture == ArchitectureType.FRONTEND_BACKEND:
                if source_layer == "backend" and target_layer == "frontend":
                    violations.append(self._violation("backward_dependency", edge.source, edge.target_file, source_layer, target_layer, "Backend depends on Frontend, reversing the expected application boundary."))
        return self._dedupe(violations)

    @staticmethod
    def _layered(source, target, source_layer, target_layer):
        forbidden = {
            ("controller", "repository"): ("skipped_layer", "Controller directly depends on Repository, skipping the Service layer."),
            ("service", "controller"): ("backward_dependency", "Service depends on Controller, reversing the expected layered direction."),
            ("repository", "service"): ("backward_dependency", "Repository depends on Service, reversing the expected layered direction."),
            ("repository", "controller"): ("backward_dependency", "Repository depends on Controller, reversing the expected layered direction."),
        }
        spec = forbidden.get((source_layer, target_layer))
        if spec:
            return [ArchitectureViolationDetector._violation(spec[0], source, target, source_layer, target_layer, spec[1])]
        return []

    @staticmethod
    def _service_repository(source, target, source_layer, target_layer):
        if source_layer == "repository" and target_layer == "service":
            return [ArchitectureViolationDetector._violation("backward_dependency", source, target, source_layer, target_layer, "Repository depends on Service, reversing the expected Service → Repository direction.")]
        return []

    @staticmethod
    def _mvc(source, target, source_layer, target_layer):
        if source_layer == "model" and target_layer in {"controller", "view"}:
            return [ArchitectureViolationDetector._violation("backward_dependency", source, target, source_layer, target_layer, "Model depends on Controller/View, reversing the expected MVC direction.")]
        return []

    @staticmethod
    def _violation(kind, source, target, source_layer, target_layer, description):
        return ArchitectureViolation(
            kind=kind,
            source=source,
            target=target,
            source_layer=source_layer,
            target_layer=target_layer,
            description=description,
            evidence=[f"resolved import edge {source} → {target}"],
        )

    @staticmethod
    def _dedupe(violations):
        unique = {}
        for violation in violations:
            unique[(violation.kind, violation.source, violation.target)] = violation
        return [unique[key] for key in sorted(unique)]
