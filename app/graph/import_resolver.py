import sys
from dataclasses import dataclass
from pathlib import PurePosixPath

from app.schemas.source import Import, SourceFile, SupportedLanguage

# Python's own authoritative list of standard library top-level modules. Used so a bare
# `import logging` in `src/flask/logging.py` is treated as external rather than being resolved
# back to the importing file by the file-stem fallback.
_STDLIB_MODULES = frozenset(getattr(sys, "stdlib_module_names", ()))

# Java classes in these namespaces ship with the JDK or Jakarta EE and are never repository files,
# so the simple-name fallback must not resolve an import such as java.util.List to a local List.
_JDK_NAMESPACE_PREFIXES = ("java.", "javax.", "jakarta.", "jdk.", "sun.", "com.sun.")




_JS_EXTENSIONS = (".d.ts", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs")
_JS_INDEX_NAMES = {f"index{extension}": extension for extension in _JS_EXTENSIONS}


def _strip_js_extension(value: str) -> str:
    for extension in _JS_EXTENSIONS:
        if value.endswith(extension):
            return value[: -len(extension)]
    return value


def _extensionless(path: PurePosixPath) -> str:
    """Index key for a JS/TS module: its path without the source extension."""
    name = path.name
    if name.endswith(".d.ts"):
        return (path.parent / name[: -len(".d.ts")]).as_posix()
    return path.with_suffix("").as_posix()


def _normalize_posix(path: PurePosixPath) -> str | None:
    """Collapse '.' and '..' segments, or return None when the path escapes the repository."""
    parts: list[str] = []
    for part in path.parts:
        if part == ".":
            continue
        if part == "..":
            if not parts:
                return None
            parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


@dataclass(frozen=True)
class Resolution:
    classification: str
    target: str | None
    candidates: tuple[str, ...] = ()
    reason: str | None = None


class RepositoryFileIndex:
    """Build once and resolve imports without rescanning the repository per import."""

    def __init__(self, source_files: list[SourceFile]) -> None:
        self.files = {item.path: item for item in source_files}
        self.by_basename: dict[str, list[str]] = {}
        self.python_modules: dict[str, list[str]] = {}
        self.java_classes: dict[str, list[str]] = {}
        self.java_fqcn: dict[str, str] = {}
        self.js_ts_modules: dict[str, list[str]] = {}
        # Symbol index for inheritance resolution: maps class/interface names to the
        # files declaring them, so EXTENDS/IMPLEMENTS targets resolve without rescanning
        # every file's symbols per edge.
        self.symbol_declarations: dict[str, list[str]] = {}
        for item in source_files:
            self.by_basename.setdefault(PurePosixPath(item.path).name, []).append(item.path)
            for symbol in item.symbols:
                if symbol.kind in {"class", "interface"}:
                    self.symbol_declarations.setdefault(symbol.name, []).append(item.path)
            if item.language == SupportedLanguage.PYTHON:
                self._index_python(item)
            elif item.language in {SupportedLanguage.JAVASCRIPT, SupportedLanguage.TYPESCRIPT, SupportedLanguage.TSX}:
                self._index_js_ts(item)
            elif item.language == SupportedLanguage.JAVA:
                self._index_java(item)
        for mapping in (self.by_basename, self.python_modules, self.java_classes, self.js_ts_modules, self.symbol_declarations):
            for paths in mapping.values():
                paths.sort()

    def _index_python(self, item: SourceFile) -> None:
        path = PurePosixPath(item.path)
        if path.name == "__init__.py":
            module = ".".join(path.parent.parts)
        else:
            module = ".".join(path.with_suffix("").parts)
        if module:
            self.python_modules.setdefault(module, []).append(item.path)
        if path.name == "__init__.py":
            self.python_modules.setdefault(".".join(path.parent.parts), []).append(item.path)

    def _index_js_ts(self, item: SourceFile) -> None:
        path = PurePosixPath(item.path)
        self.js_ts_modules.setdefault(_extensionless(path), []).append(item.path)
        if _JS_INDEX_NAMES.get(path.name) is not None:
            # `import './components'` addresses the directory, not the index file itself.
            self.js_ts_modules.setdefault(path.parent.as_posix(), []).append(item.path)

    def _index_java(self, item: SourceFile) -> None:
        classes = [s for s in item.symbols if s.kind in {"class", "interface"}]
        for symbol in classes:
            self.java_classes.setdefault(symbol.name, []).append(item.path)
            if item.package_name:
                self.java_fqcn[f"{item.package_name}.{symbol.name}"] = item.path

    def resolve(self, source: SourceFile, import_item: Import) -> Resolution:
        module = import_item.module.strip()
        if source.language == SupportedLanguage.PYTHON:
            return self._resolve_python(source, import_item)
        if source.language in {SupportedLanguage.JAVASCRIPT, SupportedLanguage.TYPESCRIPT, SupportedLanguage.TSX}:
            return self._resolve_js_ts(source, module)
        if source.language == SupportedLanguage.JAVA:
            return self._resolve_java(import_item)
        return Resolution("external", f"external:{module}", reason="Unsupported resolver language")

    def _resolve_python(self, source: SourceFile, item: Import) -> Resolution:
        module = item.module.strip()
        source_path = PurePosixPath(source.path)
        if module.startswith("."):
            level = len(module) - len(module.lstrip("."))
            remainder = module[level:]
            base_parts = list(source_path.parent.parts)
            for _ in range(max(level - 1, 0)):
                if base_parts:
                    base_parts.pop()
            base = PurePosixPath(*base_parts)
            candidate_module = ".".join((*base.parts, *[p for p in remainder.split(".") if p]))
            candidates = self.python_modules.get(candidate_module, [])
            if len(candidates) == 1:
                return Resolution("internal", candidates[0], reason="Python relative module resolved")
            if len(candidates) > 1:
                return Resolution("ambiguous", None, tuple(candidates), reason="Multiple repository files match Python relative import")
            return Resolution("unresolved_internal", f"unresolved:{module}", reason="Python relative import has no repository match")
        candidates = self.python_modules.get(module, [])
        if len(candidates) == 1:
            return Resolution("internal", candidates[0], reason="Python module resolved")
        if len(candidates) > 1:
            return Resolution("ambiguous", None, tuple(candidates), reason="Multiple repository files match Python module")

        root = module.split(".", 1)[0]
        if root and root in self.python_modules:
            return Resolution("ambiguous", None, tuple(self.python_modules[root]), reason="Partial Python module match is ambiguous")

        # A standard library module is only a repository module when the repository defines that
        # top-level package itself, which the check above already handles.
        if root in _STDLIB_MODULES:
            return Resolution("external", f"external:{module}", reason="Python standard library module")

        # A bare module name can still be a local module when the repository
        # contains a file with that stem. Never guess when multiple stems match.
        basename = module.rsplit(".", 1)[-1]
        stem_candidates = tuple(
            path for path in self.by_basename.get(f"{basename}.py", [])
        )
        if len(stem_candidates) == 1:
            return Resolution("internal", stem_candidates[0], reason="Python local module resolved by file stem")
        if len(stem_candidates) > 1:
            return Resolution("ambiguous", None, stem_candidates, reason="Multiple repository Python files match module stem")

        return Resolution("external", f"external:{module}", reason="No repository Python module matches")

    def _resolve_js_ts(self, source: SourceFile, module: str) -> Resolution:
        if not module.startswith((".", "/")):
            return Resolution("external", f"external:{module}", reason="Bare JS/TS specifier is package-like")
        raw = _normalize_posix(PurePosixPath(source.path).parent / module)
        if raw is None:
            return Resolution(
                "unresolved_internal",
                f"unresolved:{module}",
                reason="Relative JS/TS import points outside the repository",
            )
        # An explicit file path such as './vendor/index.js' names exactly one file and must win
        # over the extension-probing search below.
        if raw in self.files:
            return Resolution("internal", raw, reason="Relative JS/TS file resolved by explicit path")
        directory = PurePosixPath(raw) if raw else PurePosixPath("")
        stem = _strip_js_extension(raw)
        candidate_paths: list[str] = []
        for suffix in ("", ".ts", ".tsx", ".js", ".jsx", ".d.ts"):
            key = stem if suffix == "" else stem + suffix
            candidate_paths.extend(self.js_ts_modules.get(key, []))
        # Explicit index resolution.
        for suffix in (".ts", ".tsx", ".js", ".jsx", ".d.ts"):
            candidate_paths.extend(self.js_ts_modules.get((directory / ("index" + suffix)).as_posix(), []))
        candidate_paths.extend(self.js_ts_modules.get((directory / "index").as_posix(), []))
        candidates = tuple(dict.fromkeys(candidate_paths))
        if len(candidates) == 1:
            return Resolution("internal", candidates[0], reason="Relative JS/TS module resolved")
        if len(candidates) > 1:
            return Resolution("ambiguous", None, candidates, reason="Multiple repository files match relative JS/TS import")
        return Resolution("unresolved_internal", f"unresolved:{module}", reason="Relative JS/TS import has no repository match")

    def _resolve_java(self, item: Import) -> Resolution:
        module = item.module.strip()
        if module.endswith(".*"):
            prefix = module[:-2]
            candidates = tuple(sorted(path for fqcn, path in self.java_fqcn.items() if fqcn.startswith(prefix + ".")))
        else:
            target = self.java_fqcn.get(module)
            candidates = (target,) if target else ()
        if len(candidates) == 1:
            return Resolution("internal", candidates[0], reason="Java fully qualified class resolved")
        if len(candidates) > 1:
            return Resolution("ambiguous", None, candidates, reason="Multiple repository Java classes match import")
        if module.startswith(_JDK_NAMESPACE_PREFIXES):
            return Resolution("external", f"external:{module}", reason="JDK or Jakarta namespace")
        simple = module.rsplit(".", 1)[-1]
        local = self.java_classes.get(simple, [])
        if len(local) == 1:
            return Resolution("internal", local[0], reason="Java simple class name resolved")
        if len(local) > 1:
            return Resolution("ambiguous", None, tuple(local), reason="Multiple repository Java classes share the imported class name")
        return Resolution("external", f"external:{module}", reason="No repository Java class matches")
