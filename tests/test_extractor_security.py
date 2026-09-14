import io
import tarfile
from pathlib import Path

import pytest

from app.core.exceptions import ArchiveSecurityError, RepositorySizeExceeded
from app.services.extractor import SafeTarExtractor


def write_tar(path: Path, members: list[tuple[str, bytes, str]]) -> None:
    with tarfile.open(path, "w:gz") as tar:
        for name, data, kind in members:
            info = tarfile.TarInfo(name)
            if kind == "file":
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
            elif kind == "symlink":
                info.type = tarfile.SYMTYPE
                info.linkname = "target"
                tar.addfile(info)
            elif kind == "hardlink":
                info.type = tarfile.LNKTYPE
                info.linkname = "target"
                tar.addfile(info)


def test_reject_path_traversal(temp_root: Path, settings):
    archive = temp_root / "evil.tar.gz"
    write_tar(archive, [("../../evil.txt", b"owned", "file")])
    with pytest.raises(ArchiveSecurityError):
        SafeTarExtractor(settings).extract(archive, temp_root / "out")


def test_reject_absolute_path(temp_root: Path, settings):
    archive = temp_root / "evil.tar.gz"
    write_tar(archive, [("/tmp/evil.txt", b"owned", "file")])
    with pytest.raises(ArchiveSecurityError):
        SafeTarExtractor(settings).extract(archive, temp_root / "out")


@pytest.mark.parametrize("kind", ["symlink", "hardlink"])
def test_links_are_rejected_and_never_written(temp_root: Path, settings, kind):
    """Links are refused: they must not exist on disk, and the rejection is reported."""
    archive = temp_root / "links.tar.gz"
    write_tar(archive, [("repo/real.py", b"x = 1\n", "file"), ("repo/evil", b"", kind)])
    out = temp_root / "out"
    outcome = SafeTarExtractor(settings).extract_with_report(archive, out)

    assert not (out / "repo" / "evil").exists()
    assert not (out / "repo" / "evil").is_symlink()
    assert outcome.skipped_entries == ["repo/evil"]
    # Safe neighbours still extract, so one link does not make a repository unanalyzable.
    assert (out / "repo" / "real.py").read_text() == "x = 1\n"
    assert outcome.extracted_files == 1
    assert outcome.root == out / "repo"


def test_special_device_entries_are_rejected_and_never_written(temp_root: Path, settings):
    archive = temp_root / "device.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        info = tarfile.TarInfo("repo/fifo")
        info.type = tarfile.FIFOTYPE
        tar.addfile(info)
        real = tarfile.TarInfo("repo/ok.py")
        payload = b"print('ok')\n"
        real.size = len(payload)
        tar.addfile(real, io.BytesIO(payload))

    out = temp_root / "out"
    outcome = SafeTarExtractor(settings).extract_with_report(archive, out)
    assert outcome.skipped_entries == ["repo/fifo"]
    assert not (out / "repo" / "fifo").exists()
    assert (out / "repo" / "ok.py").read_text() == "print('ok')\n"


def test_oversized_single_file_is_skipped_and_reported(temp_root: Path, settings):
    """One huge file must not sink the analysis: it is skipped, neighbours still extract."""
    archive = temp_root / "large.tar.gz"
    write_tar(
        archive,
        [
            ("repo/large.py", b"x" * (settings.max_single_file_bytes + 1), "file"),
            ("repo/ok.py", b"print('ok')\n", "file"),
        ],
    )
    outcome = SafeTarExtractor(settings).extract_with_report(archive, temp_root / "out")
    assert outcome.partial is True
    assert outcome.budget_skipped["oversized file"] == ["repo/large.py"]
    assert (temp_root / "out" / "repo" / "ok.py").exists()
    assert not (temp_root / "out" / "repo" / "large.py").exists()
    assert outcome.extracted_files == 1


def test_extracted_size_budget_yields_partial_extraction(temp_root: Path, settings):
    """Entries beyond the partial bytes budget are skipped; the rest still extract."""
    archive = temp_root / "big.tar.gz"
    write_tar(
        archive,
        [
            ("repo/a.py", b"x" * (settings.partial_extracted_bytes_budget // 2), "file"),
            ("repo/b.py", b"x" * (settings.partial_extracted_bytes_budget // 2), "file"),
            ("repo/c.py", b"x" * (settings.partial_extracted_bytes_budget // 2), "file"),
        ],
    )
    outcome = SafeTarExtractor(settings).extract_with_report(archive, temp_root / "out")
    assert outcome.partial is True
    assert outcome.extracted_bytes <= settings.partial_extracted_bytes_budget
    assert len(outcome.budget_skipped["resource budget exceeded"]) == 1
    assert outcome.extracted_files == 2


def test_file_count_budget_yields_partial_extraction(temp_root: Path, settings):
    archive = temp_root / "many.tar.gz"
    files = [(f"repo/{i}.py", b"x", "file") for i in range(settings.partial_extracted_files_budget + 5)]
    write_tar(archive, files)
    outcome = SafeTarExtractor(settings).extract_with_report(archive, temp_root / "out")
    assert outcome.partial is True
    assert outcome.extracted_files == settings.partial_extracted_files_budget
    assert len(outcome.budget_skipped["resource budget exceeded"]) == 5


def test_priority_keeps_source_over_media_under_budget_pressure(temp_root: Path, settings):
    """When the budget runs out, media is skipped before analyzable source code."""
    archive = temp_root / "media.tar.gz"
    write_tar(
        archive,
        [
            ("repo/asset.png", b"\x89PNG" + b"0" * (settings.partial_extracted_bytes_budget - 4), "file"),
            ("repo/main.py", b"print('source wins')\n", "file"),
        ],
    )
    outcome = SafeTarExtractor(settings).extract_with_report(archive, temp_root / "out")
    assert outcome.partial is True
    assert (temp_root / "out" / "repo" / "main.py").read_text() == "print('source wins')\n"
    assert not (temp_root / "out" / "repo" / "asset.png").exists()
    assert outcome.extracted_files == 1


def test_ignored_directories_are_skipped_without_consuming_budget(temp_root: Path, settings):
    archive = temp_root / "ignored.tar.gz"
    write_tar(
        archive,
        [
            ("repo/node_modules/leftpad/index.js", b"x" * (settings.partial_extracted_bytes_budget - 10), "file"),
            ("repo/src/main.py", b"print('kept')\n", "file"),
        ],
    )
    outcome = SafeTarExtractor(settings).extract_with_report(archive, temp_root / "out")
    assert not (temp_root / "out" / "repo" / "node_modules").exists()
    assert (temp_root / "out" / "repo" / "src" / "main.py").read_text() == "print('kept')\n"
    assert outcome.extracted_files == 1
    assert "ignored directory content" in outcome.budget_skipped


def test_archive_above_download_limit_is_rejected(temp_root: Path, settings):
    """The download cap is a hard security budget: oversized archives never extract."""
    archive = temp_root / "huge.tar.gz"
    archive.write_bytes(b"\x1f\x8b" + b"0" * (settings.max_archive_bytes + 1))
    with pytest.raises(RepositorySizeExceeded):
        SafeTarExtractor(settings).extract_with_report(archive, temp_root / "out")


def test_extract_normal_archive(temp_root: Path, settings):
    archive = temp_root / "repo.tar.gz"
    write_tar(archive, [("repo/main.py", b"print('ok')", "file"), ("repo/README.md", b"readme", "file")])
    root = SafeTarExtractor(settings).extract(archive, temp_root / "out")
    assert (root / "main.py").read_text() == "print('ok')"
    assert (root / "README.md").read_text() == "readme"


def test_archive_budget_is_shared_between_downloader_and_extractor(settings):
    """The extractor must never reject an archive the downloader accepted for size."""
    from app.services.downloader import RepositoryDownloader

    assert RepositoryDownloader(settings).max_download_bytes == settings.effective_archive_budget_bytes
    assert settings.effective_archive_budget_bytes >= settings.max_archive_bytes


def test_member_count_bomb_is_rejected(temp_root: Path, settings):
    """An archive declaring more entries than allowed is rejected outright."""
    import gzip
    import io
    import tarfile as tf

    settings.max_extracted_files = 5
    buffer = io.BytesIO()
    with tf.open(fileobj=buffer, mode="w") as archive:
        for index in range(8):
            info = tf.TarInfo(f"repo/f{index}.py")
            info.size = 0
            archive.addfile(info, io.BytesIO(b""))
    archive_file = temp_root / "many.tar.gz"
    archive_file.write_bytes(gzip.compress(buffer.getvalue()))
    with pytest.raises(RepositorySizeExceeded):
        SafeTarExtractor(settings).extract_with_report(archive_file, temp_root / "out")
