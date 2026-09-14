from pathlib import Path

import httpx

from app.core.config import Settings
from app.core.exceptions import DownloadError, RepositorySizeExceeded
from app.schemas.ingestion import GitHubRepository


class RepositoryDownloader:
    """Streams a repository archive to disk under a hard download cap.

    The cap is derived from the partial-analysis extraction budget rather than the old
    tight archive limit: oversized repositories now proceed to bounded partial extraction
    instead of being rejected before the analyzer sees any source. It still bounds disk
    and memory (streamed in chunks, no full buffering) and still refuses archives that
    claim a larger size up front.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def max_download_bytes(self) -> int:
        # Shared derived ceiling so the downloader and the extractor agree on what fits.
        return self.settings.effective_archive_budget_bytes

    def download(self, repository: GitHubRepository, destination: Path) -> Path:
        destination.mkdir(parents=True, exist_ok=True)
        archive_path = destination / "repository.tar.gz"
        headers = {"User-Agent": "RepoLens/1.0", "Accept": "application/octet-stream"}
        if self.settings.github_token:
            headers["Authorization"] = f"Bearer {self.settings.github_token}"
        limit = self.max_download_bytes

        try:
            with httpx.stream(
                "GET",
                repository.archive_url,
                headers=headers,
                timeout=self.settings.download_timeout_seconds,
                follow_redirects=False,
            ) as response:
                if response.status_code >= 400:
                    raise DownloadError("GitHub rejected the repository archive request")
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > limit:
                    raise RepositorySizeExceeded("Repository archive exceeds the download limit")

                written = 0
                with archive_path.open("wb") as output:
                    for chunk in response.iter_bytes(64 * 1024):
                        written += len(chunk)
                        if written > limit:
                            raise RepositorySizeExceeded("Repository archive exceeds the download limit")
                        output.write(chunk)
        except RepositorySizeExceeded:
            archive_path.unlink(missing_ok=True)
            raise
        except (httpx.HTTPError, OSError, ValueError) as exc:
            archive_path.unlink(missing_ok=True)
            raise DownloadError("Unable to download the repository archive") from exc

        if archive_path.stat().st_size == 0:
            archive_path.unlink(missing_ok=True)
            raise DownloadError("Downloaded repository archive is empty")
        return archive_path
