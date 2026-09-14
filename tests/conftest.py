from pathlib import Path

import pytest

from app.core.config import Settings


@pytest.fixture
def settings() -> Settings:
    return Settings(
        max_archive_bytes=1024 * 1024,
        max_extracted_bytes=2 * 1024 * 1024,
        max_extracted_files=100,
        max_single_file_bytes=512 * 1024,
        partial_extracted_bytes_budget=64 * 1024,
        partial_extracted_files_budget=90,
        download_timeout_seconds=2,
    )


@pytest.fixture
def temp_root(tmp_path: Path) -> Path:
    return tmp_path
