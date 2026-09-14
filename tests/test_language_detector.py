from pathlib import Path

import pytest

from app.analyzers.language_detector import LanguageDetector
from app.schemas.source import SupportedLanguage


@pytest.fixture
def detector() -> LanguageDetector:
    return LanguageDetector()


@pytest.mark.parametrize(
    ("filename", "language"),
    [
        ("main.py", SupportedLanguage.PYTHON),
        ("MAIN.PY", SupportedLanguage.PYTHON),
        ("app.js", SupportedLanguage.JAVASCRIPT),
        ("app.JSX", SupportedLanguage.JAVASCRIPT),
        ("types.ts", SupportedLanguage.TYPESCRIPT),
        ("types.D.TS", SupportedLanguage.TYPESCRIPT),
        ("view.tsx", SupportedLanguage.TSX),
        ("Main.JAVA", SupportedLanguage.JAVA),
    ],
)
def test_extension_detection_is_case_insensitive_and_authoritative(detector, temp_root: Path, filename, language):
    path = temp_root / filename
    path.write_text("#!/usr/bin/env node\nexport const x = 1;", encoding="utf-8")
    assert detector.detect(path) == language


def test_extensionless_python_shebang(detector, temp_root: Path):
    path = temp_root / "runner"
    path.write_text("#!/usr/bin/python3\nprint('ok')\n", encoding="utf-8")
    assert detector.detect(path) == SupportedLanguage.PYTHON


def test_extensionless_env_python_shebang(detector, temp_root: Path):
    path = temp_root / "runner"
    path.write_text("#!/usr/bin/env python\nprint('ok')\n", encoding="utf-8")
    assert detector.detect(path) == SupportedLanguage.PYTHON


def test_extensionless_env_node_shebang(detector, temp_root: Path):
    path = temp_root / "runner"
    path.write_text("#!/usr/bin/env node\nconsole.log('ok')\n", encoding="utf-8")
    assert detector.detect(path) == SupportedLanguage.JAVASCRIPT


def test_ts_node_is_not_misclassified_as_node(detector, temp_root: Path):
    path = temp_root / "runner.ts-node"
    path.write_text("#!/usr/bin/env ts-node\nconsole.log('ok')\n", encoding="utf-8")
    assert detector.detect(path) is None


def test_shebang_does_not_override_recognized_extension(detector, temp_root: Path):
    path = temp_root / "runner.py"
    path.write_text("#!/usr/bin/env node\nprint('ok')\n", encoding="utf-8")
    assert detector.detect(path) == SupportedLanguage.PYTHON


def test_unsupported_extension_returns_none(detector, temp_root: Path):
    path = temp_root / "main.rs"
    path.write_text("fn main() {}", encoding="utf-8")
    assert detector.detect(path) is None


def test_empty_extensionless_file_returns_none(detector, temp_root: Path):
    path = temp_root / "empty"
    path.write_bytes(b"")
    assert detector.detect(path) is None


def test_shebang_parse_with_env_s_options(detector, temp_root: Path):
    path = temp_root / "runner"
    path.write_text("#!/usr/bin/env -S python -u\nprint('ok')\n", encoding="utf-8")
    assert detector.detect(path) == SupportedLanguage.PYTHON
