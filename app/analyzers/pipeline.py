from app.schemas.ingestion import DiscoveredFile
from app.analyzers.source_analyzer import SourceAnalyzer
from app.graph.graph_builder import DependencyGraphBuilder
from app.architecture.detector import ArchitectureDetector
from app.schemas.source import SourceFile


class SourceAnalysisPipeline:
    """Milestone 2 source-analysis stage built on top of Milestone 1 discovery."""

    def __init__(self) -> None:
        self.source_analyzer = SourceAnalyzer()
        self.graph_builder = DependencyGraphBuilder()
        self.architecture_detector = ArchitectureDetector()

    def analyze(self, root_path: str, discovered_files: list[DiscoveredFile]):
        from pathlib import Path
        source_files = self.source_analyzer.analyze(Path(root_path), discovered_files)
        dependency_graph = self.graph_builder.build(source_files)
        return source_files, dependency_graph, self.architecture_detector.detect(source_files, dependency_graph)
