from pathlib import Path

from app.services.discovery import FileDiscoverer


def test_discovery_ignores_generated_and_vendor_dirs(temp_root: Path, settings):
    root = temp_root / "repo"
    (root / "src").mkdir(parents=True)
    (root / "node_modules/pkg").mkdir(parents=True)
    (root / ".git").mkdir()
    (root / "src/main.py").write_text("print('x')")
    (root / "README.md").write_text("docs")
    (root / "node_modules/pkg/a.py").write_text("bad")
    (root / ".git/config").write_text("git")

    files = FileDiscoverer(settings).discover(root)
    paths = {item.path: item.kind for item in files}
    assert paths == {"README.md": "other", "src/main.py": "source"}
