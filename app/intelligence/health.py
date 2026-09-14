from __future__ import annotations

from collections import defaultdict
from math import ceil

from app.architecture.models import ArchitectureReport
from app.graph.models import DependencyGraphResult, GraphEdgeType, import_edge_status
from app.intelligence.models import (
    ArchitectureViolationInsight,
    CouplingHotspot,
    CycleSeverity,
    FindingSeverity,
    HealthDimension,
    HealthReport,
    HealthStatus,
    HealthWeights,
    ProblemFile,
)
from app.schemas.ingestion import IngestionResult
from app.schemas.source import ParseStatus


HEALTH_WEIGHTS = HealthWeights(parse=0.20, imports=0.20, cycles=0.20, architecture=0.25, coupling=0.15)


def status_for(score: float) -> HealthStatus:
    if score >= 90:
        return HealthStatus.EXCELLENT
    if score >= 75:
        return HealthStatus.GOOD
    if score >= 60:
        return HealthStatus.FAIR
    if score >= 40:
        return HealthStatus.POOR
    return HealthStatus.CRITICAL


class RepositoryHealthAnalyzer:
    def analyze(self, result: IngestionResult) -> HealthReport:
        parse = self._parse_health(result)
        imports = self._import_health(result)
        cycles, cycle_severity = self._cycle_health(result)
        architecture = self._architecture_health(result.architecture_report)
        coupling, hotspots = self._coupling_health(result)
        dimensions = {"parse": parse, "imports": imports, "cycles": cycles, "architecture": architecture, "coupling": coupling}
        total = round(
            parse.score * HEALTH_WEIGHTS.parse
            + imports.score * HEALTH_WEIGHTS.imports
            + cycles.score * HEALTH_WEIGHTS.cycles
            + architecture.score * HEALTH_WEIGHTS.architecture
            + coupling.score * HEALTH_WEIGHTS.coupling,
            2,
        )
        total = max(0.0, min(100.0, total))
        problem_files = self._problem_files(result, hotspots)
        return HealthReport(
            score=total,
            status=status_for(total),
            weights=HEALTH_WEIGHTS,
            dimensions=dimensions,
            coupling_hotspots=hotspots,
            cycle_severity=cycle_severity,
            problem_files=problem_files,
        )

    @staticmethod
    def _parse_health(result: IngestionResult) -> HealthDimension:
        success = sum(item.parse_status == ParseStatus.SUCCESS for item in result.source_file_analyses)
        errors = sum(item.parse_status == ParseStatus.ERROR for item in result.source_file_analyses)
        attempted = success + errors
        unsupported = sum(item.parse_status == ParseStatus.UNSUPPORTED for item in result.source_file_analyses)
        empty = sum(item.parse_status == ParseStatus.EMPTY for item in result.source_file_analyses)
        score = 100.0 if attempted == 0 else round((success / attempted) * 100, 2)
        explanation = (
            "No analyzable source files were attempted. Unsupported and empty files are excluded from parse health."
            if attempted == 0
            else f"{success} of {attempted} analyzable source files parsed successfully."
        )
        return HealthDimension(
            score=score,
            status=status_for(score),
            explanation=explanation,
            metrics={"successful": success, "attempted": attempted, "errors": errors, "unsupported": unsupported, "empty": empty},
        )

    @staticmethod
    def _import_health(result: IngestionResult) -> HealthDimension:
        graph = result.dependency_graph
        if graph is None:
            return HealthDimension(score=0, status=HealthStatus.CRITICAL, explanation="Dependency graph data is unavailable.")
        resolved = unresolved = external = 0
        for edge in graph.edges:
            if edge.edge_type != GraphEdgeType.IMPORTS:
                continue
            status = import_edge_status(edge)
            if status == "external":
                external += 1
            elif status == "resolved":
                resolved += 1
            else:
                unresolved += 1
        denominator = resolved + unresolved
        resolution_rate = 100.0 if denominator == 0 else round((resolved / denominator) * 100, 2)
        explanation = "No internal import resolution failures were found." if unresolved == 0 else f"{unresolved} imports remain unresolved out of {denominator} internal import decisions."
        return HealthDimension(
            score=resolution_rate,
            status=status_for(resolution_rate),
            explanation=explanation,
            metrics={"resolved": resolved, "unresolved": unresolved, "external": external, "resolution_rate": resolution_rate},
        )

    @staticmethod
    def _cycle_health(result: IngestionResult) -> tuple[HealthDimension, list[CycleSeverity]]:
        graph = result.dependency_graph
        if graph is None:
            dimension = HealthDimension(score=0, status=HealthStatus.CRITICAL, explanation="Dependency graph data is unavailable.")
            return dimension, []
        cycles = graph.cycles
        participants = {path for cycle in cycles for path in cycle.files}
        largest_scc = max((len(scc) for scc in graph.strongly_connected_components), default=0)
        penalty = min(100, len(cycles) * 12 + len(participants) * 5 + max(0, largest_scc - 2) * 5)
        score = round(100 - penalty, 2)
        severity_rows: list[CycleSeverity] = []
        overall = RepositoryHealthAnalyzer._cycle_overall_severity(score, cycles)
        for cycle in cycles:
            if cycle.length >= 8:
                severity = FindingSeverity.CRITICAL
                reason = f"Cycle length {cycle.length} is unusually large."
            elif cycle.length >= 5:
                severity = FindingSeverity.HIGH
                reason = f"Cycle length {cycle.length} creates a broad dependency loop."
            elif cycle.length >= 3:
                severity = FindingSeverity.MEDIUM
                reason = f"Cycle includes {cycle.length} files."
            else:
                severity = FindingSeverity.LOW
                reason = "Two-file dependency cycle detected."
            severity_rows.append(CycleSeverity(files=cycle.files, length=cycle.length, severity=severity, reason=reason))
        explanation = "No dependency cycles detected." if not cycles else f"{len(cycles)} dependency cycle(s) involve {len(participants)} files; largest SCC contains {largest_scc} files."
        dimension = HealthDimension(
            score=score,
            status=status_for(score),
            explanation=explanation,
            metrics={"cycles": len(cycles), "cycle_files": len(participants), "largest_scc": largest_scc, "severity": overall.value},
        )
        return dimension, severity_rows

    @staticmethod
    def _cycle_overall_severity(score: float, cycles) -> FindingSeverity:
        if not cycles:
            return FindingSeverity.INFO
        if score >= 80:
            return FindingSeverity.LOW
        if score >= 60:
            return FindingSeverity.MEDIUM
        if score >= 40:
            return FindingSeverity.HIGH
        return FindingSeverity.CRITICAL

    @staticmethod
    def _architecture_health(report: ArchitectureReport | None) -> HealthDimension:
        if report is None:
            return HealthDimension(score=0, status=HealthStatus.CRITICAL, explanation="Architecture analysis data is unavailable.")
        candidate = report.primary
        violations = candidate.violations
        penalty = 0
        for violation in violations:
            penalty += 10 if violation.kind in {"skipped_layer", "backward_dependency"} else 6
        score = round(max(0.0, min(100.0, candidate.confidence * 100 - penalty)), 2)
        explanation = (
            f"{candidate.architecture.value} architecture detected at {candidate.confidence:.2f} confidence with no reported violations."
            if not violations
            else f"{candidate.architecture.value} architecture detected at {candidate.confidence:.2f} confidence with {len(violations)} reported violation(s)."
        )
        return HealthDimension(
            score=score,
            status=status_for(score),
            explanation=explanation,
            metrics={"architecture": candidate.architecture.value, "confidence": candidate.confidence, "violations": len(violations)},
        )

    @staticmethod
    def _coupling_health(result: IngestionResult) -> tuple[HealthDimension, list[CouplingHotspot]]:
        graph = result.dependency_graph
        if graph is None or not graph.metrics.node_metrics:
            dimension = HealthDimension(score=100, status=HealthStatus.EXCELLENT, explanation="No internal graph metrics indicate concentrated coupling.")
            return dimension, []
        internal_count = len(graph.metrics.node_metrics)
        max_incoming = max((metric.incoming_dependencies for metric in graph.metrics.node_metrics.values()), default=0)
        max_outgoing = max((metric.outgoing_dependencies for metric in graph.metrics.node_metrics.values()), default=0)
        max_centrality = max((metric.betweenness_centrality for metric in graph.metrics.node_metrics.values()), default=0.0)
        denominator = max(1, internal_count - 1)
        pressure = min(100.0, (max_incoming / denominator) * 45 + (max_outgoing / denominator) * 35 + max_centrality * 20)
        score = round(max(0.0, 100 - pressure), 2)
        incoming_threshold = max(3, ceil(internal_count * 0.25))
        outgoing_threshold = max(3, ceil(internal_count * 0.25))
        hotspots: list[CouplingHotspot] = []
        for path in graph.importance_ranking:
            metric = graph.metrics.node_metrics.get(path)
            if metric is None:
                continue
            reasons: list[str] = []
            if metric.incoming_dependencies >= incoming_threshold:
                reasons.append(f"High incoming dependency count: {metric.incoming_dependencies} files depend on this file.")
            if metric.outgoing_dependencies >= outgoing_threshold:
                reasons.append(f"High outgoing dependency count: this file depends on {metric.outgoing_dependencies} files.")
            if metric.betweenness_centrality >= 0.25:
                reasons.append(f"High betweenness centrality: {metric.betweenness_centrality:.3f}.")
            if reasons:
                hotspots.append(CouplingHotspot(
                    path=path,
                    incoming_dependencies=metric.incoming_dependencies,
                    outgoing_dependencies=metric.outgoing_dependencies,
                    centrality=metric.betweenness_centrality,
                    importance=metric.importance,
                    rank=metric.rank,
                    reason=" ".join(reasons),
                ))
        hotspots.sort(key=lambda item: (item.rank, item.path))
        explanation = "No coupling concentration crossed the deterministic hotspot thresholds." if not hotspots else f"{len(hotspots)} file(s) crossed deterministic coupling hotspot thresholds."
        return HealthDimension(score=score, status=status_for(score), explanation=explanation, metrics={"files": internal_count, "hotspots": len(hotspots), "max_incoming": max_incoming, "max_outgoing": max_outgoing, "max_centrality": round(max_centrality, 4)}), hotspots

    @staticmethod
    def _problem_files(result: IngestionResult, hotspots: list[CouplingHotspot]) -> list[ProblemFile]:
        reasons: dict[str, set[str]] = defaultdict(set)
        graph = result.dependency_graph
        architecture = result.architecture_report
        for item in result.source_file_analyses:
            if item.parse_status == ParseStatus.ERROR:
                reasons[item.path].add("Parse failure")
        if graph is not None:
            for edge in graph.edges:
                if edge.edge_type == GraphEdgeType.IMPORTS and import_edge_status(edge) == "unresolved":
                    reasons[edge.source_file].add(f"Unresolved import: {edge.import_evidence.get('module', edge.target)}")
            for cycle in graph.cycles:
                for path in cycle.files:
                    reasons[path].add(f"Participates in a dependency cycle of length {cycle.length}")
        for hotspot in hotspots:
            reasons[hotspot.path].add(hotspot.reason)
        if architecture is not None:
            for violation in architecture.primary.violations:
                reasons[violation.source].add(violation.description)
                reasons[violation.target].add(violation.description)
        problems: list[ProblemFile] = []
        metrics = graph.metrics.node_metrics if graph is not None else {}
        for path in sorted(reasons):
            metric = metrics.get(path)
            problems.append(ProblemFile(
                path=path,
                reasons=sorted(reasons[path]),
                metrics={} if metric is None else {
                    "incoming_dependencies": metric.incoming_dependencies,
                    "outgoing_dependencies": metric.outgoing_dependencies,
                    "centrality": metric.betweenness_centrality,
                    "importance": metric.importance,
                    "rank": metric.rank,
                },
            ))
        problems.sort(key=lambda item: (-len(item.reasons), item.path))
        return problems[:50]


def architecture_violation_insights(result: IngestionResult) -> list[ArchitectureViolationInsight]:
    report = result.architecture_report
    if report is None:
        return []
    rows: list[ArchitectureViolationInsight] = []
    for violation in report.primary.violations:
        severity = FindingSeverity.HIGH if violation.kind in {"skipped_layer", "backward_dependency"} else FindingSeverity.MEDIUM
        rows.append(ArchitectureViolationInsight(
            kind=violation.kind,
            source=violation.source,
            target=violation.target,
            source_layer=violation.source_layer,
            target_layer=violation.target_layer,
            description=violation.description,
            severity=severity,
        ))
    rows.sort(key=lambda item: (-_severity_rank(item.severity), item.kind, item.source, item.target))
    return rows


def _severity_rank(severity: FindingSeverity) -> int:
    return {FindingSeverity.CRITICAL: 5, FindingSeverity.HIGH: 4, FindingSeverity.MEDIUM: 3, FindingSeverity.LOW: 2, FindingSeverity.INFO: 1}[severity]
