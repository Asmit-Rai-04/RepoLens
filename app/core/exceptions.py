class RepoLensError(Exception):
    """Base class for expected RepoLens application errors."""


class InvalidRepositoryURL(RepoLensError):
    """Raised when a GitHub repository URL is malformed or unsupported."""


class RepositoryNotFound(RepoLensError):
    """Raised when GitHub cannot locate the repository."""


class GitHubRateLimited(RepoLensError):
    """Raised when GitHub explicitly reports a rate limit."""


class DownloadError(RepoLensError):
    """Raised when a repository archive cannot be downloaded safely."""


class ArchiveSecurityError(RepoLensError):
    """Raised when an archive violates extraction safety rules."""


class RepositorySizeExceeded(RepoLensError):
    """Raised when repository/archive/extracted size limits are exceeded."""


class FileAccessDenied(RepoLensError):
    """Raised when requested content is not part of the discovered file allowlist."""
