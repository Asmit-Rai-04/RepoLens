from urllib.parse import urlparse

from app.core.exceptions import InvalidRepositoryURL
from app.schemas.ingestion import GitHubRepository


_GITHUB_HOSTS = {"github.com", "www.github.com"}


def parse_github_repository_url(url: str) -> tuple[str, str]:
    raw = url.strip()
    if not raw:
        raise InvalidRepositoryURL("Repository URL is required")

    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https" or parsed.hostname not in _GITHUB_HOSTS:
        raise InvalidRepositoryURL("Only HTTPS GitHub repository URLs are supported")

    if parsed.username or parsed.password or parsed.port:
        raise InvalidRepositoryURL("Repository URL must not contain credentials or a port")

    if parsed.query or parsed.fragment:
        raise InvalidRepositoryURL("Repository URL must not contain a query or fragment")

    segments = [segment for segment in parsed.path.split("/") if segment]
    if len(segments) > 2:
        raise InvalidRepositoryURL("Only repository URLs are supported")
    if len(segments) != 2:
        raise InvalidRepositoryURL("Repository URL must contain an owner and repository name")

    owner, repo = segments
    if repo.endswith(".git"):
        repo = repo[:-4]
    if not owner or not repo or "." in owner or "/" in owner or "/" in repo:
        raise InvalidRepositoryURL("Malformed GitHub repository path")

    return owner, repo


def build_repository(owner: str, name: str, default_branch: str) -> GitHubRepository:
    canonical_url = f"https://github.com/{owner}/{name}"
    archive_url = f"https://codeload.github.com/{owner}/{name}/tar.gz/refs/heads/{default_branch}"
    return GitHubRepository(
        owner=owner,
        name=name,
        canonical_url=canonical_url,
        default_branch=default_branch,
        archive_url=archive_url,
    )
