from __future__ import annotations

from collections import defaultdict
from pathlib import PurePosixPath

from app.architecture.models import ArchitectureEvidence, MonorepoInfo
from app.schemas.source import SourceFile


class MonorepoDetector:
    """Conservative monorepo detector based on meaningful application/package roots."""

    def detect(self, source_files: list[SourceFile]) -> MonorepoInfo:
        source_paths = [PurePosixPath(item.path) for item in source_files]
        top_level: dict[str, list[str]] = defaultdict(list)
        for path in source_paths:
            if len(path.parts) >= 2:
                top_level[path.parts[0]].append(path.as_posix())

        evidence: list[ArchitectureEvidence] = []
        roots: list[str] = []
        known_containers = {"apps", "packages"}
        for container in sorted(known_containers):
            children = sorted({PurePosixPath(path).parts[1] for path in top_level.get(container, []) if len(PurePosixPath(path).parts) >= 3})
            meaningful = [child for child in children if sum(1 for path in top_level.get(container, []) if PurePosixPath(path).parts[1] == child) >= 1]
            if len(meaningful) >= 2:
                roots.extend(f"{container}/{child}" for child in meaningful)
                evidence.append(
                    ArchitectureEvidence(
                        type="directory_structure",
                        description=f"multiple independent roots detected under {container}/",
                        supporting_paths=[f"{container}/{child}" for child in meaningful],
                        weight=0.30,
                    )
                )

        if not roots:
            candidate_roots = []
            ignored = {"src", "tests", "test", "docs", "scripts", "config", "public", "static"}
            for name, paths in sorted(top_level.items()):
                if name in ignored:
                    continue
                if len(paths) >= 1 and any(PurePosixPath(path).parts[-1] not in {"README.md", "__init__.py"} for path in paths):
                    candidate_roots.append(name)
            if len(candidate_roots) >= 3 and self._independent_roots_have_source(top_level, candidate_roots):
                roots = candidate_roots
                evidence.append(
                    ArchitectureEvidence(
                        type="directory_structure",
                        description="multiple independent top-level application/package roots detected",
                        supporting_paths=candidate_roots,
                        weight=0.30,
                    )
                )

        if roots:
            return MonorepoInfo(is_monorepo=True, roots=sorted(set(roots)), evidence=evidence)
        return MonorepoInfo(is_monorepo=False)

    @staticmethod
    def _independent_roots_have_source(top_level: dict[str, list[str]], roots: list[str]) -> bool:
        return all(any(PurePosixPath(path).suffix.lower() in {".py", ".js", ".jsx", ".ts", ".tsx", ".java"} for path in top_level[root]) for root in roots)
