from dataclasses import dataclass

import httpx

from app.core.config import Settings
from app.core.exceptions import GitHubRateLimited, RepositoryNotFound, DownloadError, RepositorySizeExceeded
from app.core.github_url import build_repository, parse_github_repository_url
from app.schemas.ingestion import GitHubRepository


@dataclass(frozen=True)
class GitHubMetadata:
    repository: GitHubRepository
    # GitHub's reported repository size in bytes (includes history and assets), kept for
    # surfacing oversized repositories instead of rejecting them.
    reported_size_bytes: int = 0
    oversized_reported: bool = False


class GitHubClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "RepoLens/1.0",
        }
        if self.settings.github_token:
            headers["Authorization"] = f"Bearer {self.settings.github_token}"
        return headers

    def get_repository_metadata(self, repository_url: str) -> GitHubMetadata:
        owner, name = parse_github_repository_url(repository_url)
        endpoint = f"{self.settings.github_api_base_url.rstrip('/')}/repos/{owner}/{name}"
        try:
            # Renamed/transferred repositories answer with a redirect to their current API
            # location, so the metadata request follows it.
            response = httpx.get(
                endpoint,
                headers=self._headers(),
                timeout=self.settings.download_timeout_seconds,
                follow_redirects=True,
            )
        except httpx.HTTPError as exc:
            raise DownloadError("Unable to contact GitHub") from exc

        if response.status_code in {403, 429} and response.headers.get("X-RateLimit-Remaining") == "0":
            raise GitHubRateLimited("GitHub API rate limit reached")
        if response.status_code == 404:
            raise RepositoryNotFound("Repository not found")
        if response.status_code >= 400:
            raise DownloadError("GitHub rejected the repository metadata request")

        try:
            payload = response.json()
            default_branch = payload["default_branch"]
            repository_bytes = int(payload.get("size", 0)) * 1024
        except (ValueError, KeyError, TypeError) as exc:
            raise DownloadError("GitHub returned invalid repository metadata") from exc

        # A repository above max_repository_bytes is flagged, not rejected: the extraction
        # budgets decide how much of it can safely be analyzed, and the downloader still
        # enforces a hard cap on what it will fetch.
        oversized = repository_bytes > self.settings.max_repository_bytes
        return GitHubMetadata(build_repository(owner, name, default_branch), repository_bytes, oversized)
