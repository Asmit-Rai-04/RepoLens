from __future__ import annotations

import re
from collections import defaultdict
from pathlib import PurePosixPath

from app.architecture.models import LayerInfo
from app.schemas.source import SourceFile


_LAYER_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("frontend", ("frontend", "client", "web", "ui")),
    ("backend", ("backend", "server", "api")),
    ("controller", ("controller", "controllers", "controller.py", "controller.ts", "controller.js", "controller.java")),
    ("service", ("service", "services", "service.py", "service.ts", "service.js", "service.java")),
    ("repository", ("repository", "repositories", "repo", "repos", "repository.py", "repository.ts", "repository.js", "repository.java")),
    ("model", ("model", "models", "model.py", "model.ts", "model.js", "model.java", "entity")),
    ("view", ("view", "views", "template", "templates", "view.py", "view.ts", "view.tsx", "view.js")),
)

_LAYER_ORDER = {name: index for index, (name, _) in enumerate(_LAYER_RULES)}

# Test sources are separated out. They legitimately reach across layers, so letting them define
# or violate a production layer would make the architecture evidence misleading.
TEST_LAYER = "test"
_TEST_DIR_SEGMENTS = frozenset({
    "test",
    "tests",
    "testing",
    "__tests__",
    "spec",
    "specs",
    "testdata",
    "test_data",
    "integration-test",
    "integration_test",
    "e2e",
})
_TEST_FILE_SUFFIXES = (".test.ts", ".test.tsx", ".test.js", ".test.jsx", ".spec.ts", ".spec.tsx", ".spec.js", ".spec.jsx")


def _is_test_path(path: PurePosixPath) -> bool:
    if any(part.lower() in _TEST_DIR_SEGMENTS for part in path.parts[:-1]):
        return True
    name = path.name
    lower = name.lower()
    if lower.endswith(_TEST_FILE_SUFFIXES):
        return True
    # Python: test_*.py or *_test.py.
    if re.match(r"^(?:test_.+|[a-z0-9_]+_test)\.py$", lower):
        return True
    # Java uses a camel-case suffix, so this check keeps the original capitalisation.
    # Matching loosely (for example on any name ending in "it") would misclassify Unit, audit,
    # and Wait as tests.
    return bool(re.search(r"(?:Test|Tests|TestCase|IT|ITCase)\.java$", name))


class LayerClassifier:
    """Deterministic layer classifier using path segments and filename conventions."""

    def classify(self, source_files: list[SourceFile]) -> tuple[dict[str, str], list[LayerInfo]]:
        layer_map: dict[str, str] = {}
        paths_by_layer: dict[str, list[str]] = defaultdict(list)
        for source in source_files:
            layer = self._classify_path(source.path)
            if layer is not None:
                layer_map[source.path] = layer
                paths_by_layer[layer].append(source.path)

        layer_infos: list[LayerInfo] = []
        for layer in sorted(paths_by_layer, key=lambda name: (_LAYER_ORDER.get(name, 999), name)):
            expected, forbidden = self.expected_and_forbidden(layer)
            layer_infos.append(
                LayerInfo(
                    name=layer,
                    paths=sorted(paths_by_layer[layer]),
                    expected_dependencies=expected,
                    forbidden_dependencies=forbidden,
                    # Observed dependencies come from resolved graph edges, not raw import text.
                    # The detector fills them in once dependency resolution is available.
                    observed_dependencies=[],
                )
            )
        return layer_map, layer_infos

    @staticmethod
    def _classify_path(path: str) -> str | None:
        posix = PurePosixPath(path)
        if _is_test_path(posix):
            return TEST_LAYER
        segments = [segment.lower() for segment in posix.parts[:-1]]
        filename = posix.name.lower()
        stem = re.sub(r"\.(d\.ts|tsx|ts|jsx|js|py|java)$", "", filename)
        candidates: list[tuple[int, int, str]] = []

        for layer, tokens in _LAYER_RULES:
            for token in tokens:
                token = token.lower()
                if token in segments:
                    candidates.append((3, _LAYER_ORDER[layer], layer))
                elif filename == token:
                    candidates.append((2, _LAYER_ORDER[layer], layer))
                elif stem.endswith(token):
                    candidates.append((1, _LAYER_ORDER[layer], layer))

        if not candidates:
            return None
        candidates.sort(key=lambda item: (-item[0], item[1], item[2]))
        return candidates[0][2]

    @staticmethod
    def expected_and_forbidden(layer: str) -> tuple[list[str], list[str]]:
        mapping = {
            # Test code is tracked as its own layer and declares no production dependencies.
            "test": ([], []),
            "controller": (["service", "model", "view"], ["repository"]),
            "service": (["repository", "model"], ["controller", "view"]),
            "repository": (["model"], ["controller", "service", "view"]),
            "model": ([], ["controller", "service", "repository", "view"]),
            "view": (["controller", "model"], ["service", "repository"]),
            "frontend": (["backend"], []),
            "backend": (["model", "repository", "service"], ["frontend"]),
        }
        expected, forbidden = mapping.get(layer, ([], []))
        return list(expected), list(forbidden)
