from __future__ import annotations

from collections import Counter

from app.graph.models import GraphEdgeType, import_edge_status
from app.intelligence.health import RepositoryHealthAnalyzer, architecture_violation_insights
from app.intelligence.models import FindingSeverity, InsightsReport, KeyFinding, RepositorySummary
from app.schemas.ingestion import IngestionResult
from app.schemas.source import ParseStatus


class RepositoryInsightsGenerator:
    def __init__(self, health_analyzer: RepositoryHealthAnalyzer | None = None) -> None:
        self.health_analyzer = health_analyzer or RepositoryHealthAnalyzer()

    def generate(self, result: IngestionResult) -> InsightsReport:
        health = self.health_analyzer.analyze(result)
        graph = result.dependency_graph
        architecture = result.architecture_report
        languages = Counter(item.language.value if item.language else "unknown" for item in result.source_file_analyses)
        unresolved = 0
        dependency_count = 0
        if graph is not None:
            dependency_count = sum(edge.edge_type == GraphEdgeType.IMPORTS for edge in graph.edges)
            unresolved = sum(edge.edge_type == GraphEdgeType.IMPORTS and import_edge_status(edge) == "unresolved" for edge in graph.edges)
        architecture_name = architecture.primary.architecture.value if architecture is not None else "Unknown"
        architecture_confidence = architecture.primary.confidence if architecture is not None else 0.0
        violations = len(architecture.primary.violations) if architecture is not None else 0
        summary = RepositorySummary(
            repository_name=result.repository.name,
            total_files=result.total_files,
            source_files=result.source_files,
            languages=dict(sorted(languages.items())),
            architecture=architecture_name,
            architecture_confidence=architecture_confidence,
            dependency_count=dependency_count,
            cycle_count=len(graph.cycles) if graph is not None else 0,
            scc_count=len(graph.strongly_connected_components) if graph is not None else 0,
            unresolved_imports=unresolved,
            architecture_violations=violations,
            health_score=health.score,
        )
        violations_report = architecture_violation_insights(result)
        findings = self._findings(result, health, unresolved, violations_report)
        no_cycles = graph is None or len(graph.cycles) == 0
        clean_state = (
            unresolved == 0
            and no_cycles
            and violations == 0
            and not any(item.parse_status == ParseStatus.ERROR for item in result.source_file_analyses)
            and health.dimensions["coupling"].status in {"excellent", "good"}
        )
        clean_message = None
        if clean_state:
            clean_message = "Repository analysis found no unresolved imports, dependency cycles, architecture violations, or parse failures."
        return InsightsReport(
            summary=summary,
            health=health,
            key_findings=findings,
            coupling_hotspots=health.coupling_hotspots,
            cycle_severity=health.cycle_severity,
            problem_files=health.problem_files,
            architecture_violations=violations_report,
            clean_state=clean_state,
            clean_state_message=clean_message,
        )

    @staticmethod
    def _findings(result: IngestionResult, health, unresolved: int, violations_report) -> list[KeyFinding]:
        graph = result.dependency_graph
        findings: list[KeyFinding] = []
        for violation in violations_report:
            findings.append(KeyFinding(
                severity=violation.severity,
                category="architecture_violation",
                title=violation.kind.replace("_", " ").title(),
                description=violation.description,
                related_files=[violation.source, violation.target],
            ))
        if unresolved:
            unresolved_sources = sorted({
                edge.source_file
                for edge in (graph.edges if graph is not None else [])
                if edge.edge_type == GraphEdgeType.IMPORTS and import_edge_status(edge) == "unresolved"
            })
            severity = FindingSeverity.HIGH if unresolved >= 5 else FindingSeverity.MEDIUM
            findings.append(KeyFinding(severity=severity, category="unresolved_imports", title="Unresolved imports", description=f"{unresolved} repository import(s) could not be resolved confidently.", related_files=unresolved_sources))
        if graph is not None and graph.cycles:
            overall = health.dimensions["cycles"].metrics.get("severity", "medium")
            severity = FindingSeverity(str(overall)) if str(overall) in {item.value for item in FindingSeverity} else FindingSeverity.MEDIUM
            members = sorted({path for cycle in graph.cycles for path in cycle.files})
            findings.append(KeyFinding(severity=severity, category="dependency_cycle", title="Dependency cycle detected", description=f"{len(members)} files participate in {len(graph.cycles)} dependency cycle(s).", related_files=members))
        for hotspot in health.coupling_hotspots[:5]:
            findings.append(KeyFinding(severity=FindingSeverity.MEDIUM, category="high_coupling", title="Coupling hotspot", description=hotspot.reason, related_files=[hotspot.path]))
        parse_error_files = [item.path for item in result.source_file_analyses if item.parse_status == ParseStatus.ERROR]
        if parse_error_files:
            findings.append(KeyFinding(severity=FindingSeverity.HIGH if len(parse_error_files) >= 3 else FindingSeverity.MEDIUM, category="parse_failures", title="Source parse failures", description=f"{len(parse_error_files)} source file(s) failed parsing.", related_files=sorted(parse_error_files)))
        unsupported = [item.path for item in result.source_file_analyses if item.parse_status == ParseStatus.UNSUPPORTED]
        if unsupported:
            findings.append(KeyFinding(severity=FindingSeverity.INFO, category="unsupported_files", title="Unsupported source formats", description=f"{len(unsupported)} discovered source file(s) use unsupported languages or extensions.", related_files=sorted(unsupported)))
        architecture = result.architecture_report
        if architecture is not None and architecture.primary.confidence < 0.35:
            findings.append(KeyFinding(severity=FindingSeverity.MEDIUM, category="architecture_confidence", title="Low architecture confidence", description=f"Architecture confidence is {architecture.primary.confidence:.2f}; evidence is insufficient for a high-confidence classification.", related_files=[]))
        findings.sort(key=lambda item: (-_severity_rank(item.severity), item.category, item.title, tuple(item.related_files)))
        return findings[:30]


def _severity_rank(severity: FindingSeverity) -> int:
    return {FindingSeverity.CRITICAL: 5, FindingSeverity.HIGH: 4, FindingSeverity.MEDIUM: 3, FindingSeverity.LOW: 2, FindingSeverity.INFO: 1}[severity]
