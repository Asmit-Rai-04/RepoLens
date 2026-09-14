import pytest

from app.core.exceptions import InvalidRepositoryURL
from app.core.github_url import parse_github_repository_url


@pytest.mark.parametrize(
    "url, expected",
    [
        ("https://github.com/user/repo", ("user", "repo")),
        ("https://github.com/user/repo/", ("user", "repo")),
        ("https://github.com/user/repo.git", ("user", "repo")),
        ("https://www.github.com/user/repo", ("user", "repo")),
    ],
)
def test_parse_supported_urls(url, expected):
    assert parse_github_repository_url(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/user/repo",
        "https://gitlab.com/user/repo",
        "https://github.com/user",
        "https://github.com/user/repo/issues",
        "https://github.com/user/repo?x=1",
        "https://github.com/user/repo#readme",
        "https://github.com//repo",
        "https://github.com/user/../repo",
        "not-a-url",
        "",
        "   ",
        # A host that merely starts with the trusted name must not be accepted.
        "https://github.com.evil.example/user/repo",
        "https://notgithub.com/user/repo",
        # Credentials and ports are not part of a public repository URL.
        "https://user:token@github.com/user/repo",
        "https://github.com:8443/user/repo",
        # Local file access must never be reachable through URL parsing.
        "file:///etc/passwd",
        "https://github.com/user/repo/../../etc/passwd",
    ],
)
def test_reject_invalid_urls(url):
    with pytest.raises(InvalidRepositoryURL):
        parse_github_repository_url(url)


def test_repository_names_with_dots_are_supported():
    assert parse_github_repository_url("https://github.com/user/foo.js") == ("user", "foo.js")
