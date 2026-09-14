from __future__ import annotations

from collections import defaultdict

from app.architecture.models import FrameworkEvidence
from app.graph.models import DependencyGraphResult, GraphNodeType
from app.schemas.source import SourceFile


_FRAMEWORK_RULES = {
    "Spring Boot": ("org.springframework", "springframework", "SpringApplication", "RestController", "Service"),
    "React": ("react", "react-dom", "jsx", "useState", "useEffect"),
    "Express": ("express",),
    "FastAPI": ("fastapi", "FastAPI"),
    "Django": ("django",),
}


class FrameworkDetector:
    def detect(self, source_files: list[SourceFile], graph: DependencyGraphResult) -> list[FrameworkEvidence]:
        paths: dict[str, set[str]] = defaultdict(set)
        evidence: dict[str, set[str]] = defaultdict(set)
        for source in source_files:
            source_modules = {item.module for item in source.imports}
            symbol_names = {item.name for item in source.symbols}
            raw_text = " ".join(sorted(source_modules | symbol_names))
            for framework, signals in _FRAMEWORK_RULES.items():
                matched = [signal for signal in signals if self._signal_matches(signal, source_modules, symbol_names, raw_text)]
                if matched:
                    paths[framework].add(source.path)
                    evidence[framework].update(matched)

        for node in graph.nodes:
            if node.node_type != GraphNodeType.EXTERNAL:
                continue
            package = node.id.removeprefix("external:")
            for framework, signals in _FRAMEWORK_RULES.items():
                matched = [signal for signal in signals if package == signal or package.startswith(signal + "-") or package.startswith(signal + ".") or package.startswith(signal + "/")]
                if matched:
                    target_paths = [edge.source_file for edge in graph.edges if edge.target == node.id]
                    paths[framework].update(target_paths)
                    evidence[framework].update(matched)

        return [
            FrameworkEvidence(
                framework=framework,
                supporting_paths=sorted(paths[framework]),
                evidence=sorted(evidence[framework]),
            )
            for framework in sorted(paths)
            if paths[framework]
        ]

    @staticmethod
    def _signal_matches(signal: str, modules: set[str], symbols: set[str], raw_text: str) -> bool:
        if signal in modules or signal in symbols:
            return True
        if any(module == signal or module.startswith(signal + ".") or module.startswith(signal + "/") for module in modules):
            return True
        return signal in raw_text.split()
