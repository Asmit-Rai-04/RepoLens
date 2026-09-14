import os
from pathlib import Path, PurePosixPath

from app.core.config import Settings
from app.schemas.ingestion import DiscoveredFile

IGNORED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "vendor",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "coverage",
    ".venv",
    "venv",
    "__pycache__",
}
IGNORED_FILE_NAMES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml"}
SOURCE_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".go", ".rs", ".rb", ".php", ".c", ".h", ".cpp", ".hpp",
    ".cs", ".swift", ".kt", ".kts", ".scala", ".sh", ".bash", ".zsh", ".sql", ".vue", ".svelte",
}


class FileDiscoverer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def discover(self, root: Path) -> list[DiscoveredFile]:
        results: list[DiscoveredFile] = []
        # os.walk is used instead of rglob so directory symlinks can never be descended into,
        # regardless of the pathlib behaviour of the running Python version.
        for current, dir_names, file_names in os.walk(root):
            dir_names[:] = sorted(
                name
                for name in dir_names
                if name not in IGNORED_DIRS and not (Path(current) / name).is_symlink()
            )
            for name in sorted(file_names):
                path = Path(current) / name
                if path.is_symlink() or not path.is_file():
                    continue
                relative = path.relative_to(root)
                if any(part in IGNORED_DIRS for part in relative.parts):
                    continue
                size = path.stat().st_size
                kind = "source" if path.suffix.lower() in SOURCE_EXTENSIONS else "other"
                if name in IGNORED_FILE_NAMES:
                    kind = "ignored"
                results.append(DiscoveredFile(path=PurePosixPath(relative).as_posix(), size_bytes=size, kind=kind))
        results.sort(key=lambda item: item.path)
        return results
