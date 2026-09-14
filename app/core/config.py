from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "RepoLens"
    app_env: str = "development"
    log_level: str = "INFO"

    max_repository_bytes: int = Field(default=100 * 1024 * 1024, gt=0)
    max_archive_bytes: int = Field(default=50 * 1024 * 1024, gt=0)
    max_extracted_bytes: int = Field(default=250 * 1024 * 1024, gt=0)
    # Hard guard on the number of entries an archive may declare. Bounds the memory the
    # member index needs; crafted all-header archives cannot pass the download cap with
    # more entries than this anyway, so legitimate repositories are unaffected.
    max_extracted_files: int = Field(default=200_000, gt=0)
    max_single_file_bytes: int = Field(default=10 * 1024 * 1024, gt=0)
    download_timeout_seconds: float = Field(default=30.0, gt=0)

    # Budgets for partial analysis. Content beyond these budgets is skipped (and
    # reported) instead of rejecting the whole repository, so large repositories can
    # still receive a useful analysis of the source that fits. Together with the hard
    # download cap and the compression-ratio guard they bound disk usage.
    partial_extracted_bytes_budget: int = Field(default=1024 * 1024 * 1024, gt=0)
    partial_extracted_files_budget: int = Field(default=150_000, gt=0)

    @property
    def effective_archive_budget_bytes(self) -> int:
        """Compressed-archive ceiling shared by the downloader and the extractor.

        Extraction is bounded by partial_extracted_bytes_budget in pre-compression entry
        sizes; GitHub archives gzip at roughly 3-4x, so a quarter of that budget bounds
        the compressed archive while leaving real repositories ample headroom.
        """
        return max(self.max_archive_bytes, self.partial_extracted_bytes_budget // 4)

    github_api_base_url: str = "https://api.github.com"
    github_token: str | None = None
    cors_allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Completed analyses keep their extraction workspace so file and source endpoints can
    # serve it. This bounds how many are retained before the oldest are released.
    max_retained_analyses: int = Field(default=10, gt=0)


@lru_cache
def get_settings() -> Settings:
    return Settings()
