import shlex
from pathlib import Path

from app.schemas.source import SupportedLanguage


EXTENSION_LANGUAGE: dict[str, SupportedLanguage] = {
    ".py": SupportedLanguage.PYTHON,
    ".js": SupportedLanguage.JAVASCRIPT,
    ".jsx": SupportedLanguage.JAVASCRIPT,
    ".ts": SupportedLanguage.TYPESCRIPT,
    ".tsx": SupportedLanguage.TSX,
    ".java": SupportedLanguage.JAVA,
}


def _shebang_command(line: str) -> str | None:
    if not line.startswith("#!"):
        return None
    try:
        parts = shlex.split(line[2:].strip())
    except ValueError:
        return None
    if not parts:
        return None

    executable = Path(parts[0]).name.lower()
    if executable == "env":
        args = parts[1:]
        while args and (args[0].startswith("-") or "=" in args[0]):
            if args[0] == "--":
                args = args[1:]
                break
            args = args[1:]
        if not args:
            return None
        executable = Path(args[0]).name.lower()
    return executable


class LanguageDetector:
    """Determines a supported language from a source-file path and optional shebang."""

    def detect(self, path: Path) -> SupportedLanguage | None:
        # A recognized extension is authoritative and always wins over shebang content.
        extension = path.suffix.lower()
        if extension in EXTENSION_LANGUAGE:
            return EXTENSION_LANGUAGE[extension]

        # .d.ts is still a TypeScript file, but suffix handling already detects .ts.
        if path.name.lower().endswith(".d.ts"):
            return SupportedLanguage.TYPESCRIPT

        # Shebangs are consulted only for genuinely extensionless files.
        if extension:
            return None

        try:
            first_line = path.read_text(encoding="utf-8", errors="replace").splitlines()[:1]
        except OSError:
            return None
        if not first_line:
            return None

        command = _shebang_command(first_line[0])
        if command in {"python", "python3"}:
            return SupportedLanguage.PYTHON
        if command in {"node", "nodejs"}:
            return SupportedLanguage.JAVASCRIPT
        return None
