import os
import tarfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from app.core.config import Settings
from app.core.exceptions import ArchiveSecurityError, RepositorySizeExceeded
from app.services.discovery import IGNORED_DIRS, SOURCE_EXTENSIONS

# How many rejected entry names to keep in memory for reporting.
MAX_REPORTED_ENTRIES = 50

# Entry sizes are pre-compression, while max_archive_bytes bounds the compressed
# download. GitHub gzip levels stay around 3-4x, so a repository whose declared entry
# sizes need a compression ratio beyond this factor to fit inside the archive cap is
# almost certainly crafted; abort instead of extracting it.
MAX_COMPRESSION_RATIO = 40

# Budget-selection priority tiers. Tier 0 is analyzable source (see discovery's
# SOURCE_EXTENSIONS); tier 1 is documentation and configuration that support the
# analysis views; everything else (media, binaries, data) is tier 2 and yields its
# budget space first.
TIER1_EXTENSIONS = {
    ".md", ".txt", ".rst", ".json", ".yml", ".yaml", ".toml", ".xml", ".html", ".css",
}


@dataclass
class ExtractionOutcome:
    """Result of a safe extraction.

    ``skipped_entries`` names archive members rejected as unsafe (links, special files).
    They are never written to disk; only their names are recorded so the rejection stays
    visible.

    ``budget_skipped`` maps a skip reason to member names that were safe but fell outside
    the resource budgets (total extracted size, file count, or individual file size) or
    were irrelevant per the discovery rules (vendored/generated directories). Resource
    skips mark the outcome ``partial``; ignored-directory skips are reported but do not,
    since excluding them is the normal discovery policy rather than a limitation.
    """

    root: Path
    extracted_files: int = 0
    extracted_bytes: int = 0
    skipped_entries: list[str] = field(default_factory=list)
    budget_skipped: dict[str, list[str]] = field(default_factory=dict)
    partial: bool = False

    @property
    def budget_skipped_count(self) -> int:
        return sum(len(names) for names in self.budget_skipped.values())


class SafeTarExtractor:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @staticmethod
    def _safe_member_path(root: Path, name: str) -> Path:
        normalized = PurePosixPath(name)
        if normalized.is_absolute() or ".." in normalized.parts:
            raise ArchiveSecurityError("Archive contains an unsafe path")
        target = root.joinpath(*normalized.parts)
        root_resolved = root.resolve()
        target_resolved = target.resolve(strict=False)
        if os.path.commonpath([root_resolved, target_resolved]) != str(root_resolved):
            raise ArchiveSecurityError("Archive path escapes extraction directory")
        return target

    @staticmethod
    def _is_ignored(name: str) -> bool:
        parts = PurePosixPath(name).parts
        return any(part in IGNORED_DIRS for part in parts[:-1] or parts)

    @staticmethod
    def _priority_tier(name: str) -> int:
        suffix = PurePosixPath(name).suffix.lower()
        if suffix in SOURCE_EXTENSIONS:
            return 0
        if suffix in TIER1_EXTENSIONS:
            return 1
        return 2

    def extract(self, archive_path: Path, destination: Path) -> Path:
        return self.extract_with_report(archive_path, destination).root

    def extract_with_report(self, archive_path: Path, destination: Path) -> ExtractionOutcome:
        """Extract an archive safely, rejecting unsafe members instead of trusting them.

        Security violations (path traversal, absolute paths, malformed archives,
        implausible compression) abort the extraction. Resource-budget violations do not:
        the members that fit are extracted, the rest are skipped and reported, and the
        outcome is marked partial so the analysis can continue on the extractable source.
        Selection happens before any writing so priority can favour analyzable content,
        while the write pass stays in archive order (gzip decompression is forward-only).
        Symlinks, hardlinks and special files are never created on disk.
        """
        destination.mkdir(parents=True, exist_ok=True)
        archive_size = archive_path.stat().st_size
        # Same derived ceiling the downloader enforces, so an archive that was accepted
        # for download is never hard-rejected here for size alone.
        if archive_size > self.settings.effective_archive_budget_bytes:
            raise RepositorySizeExceeded("Repository archive exceeds the configured limit")

        skipped: list[str] = []
        budget_skipped: dict[str, list[str]] = {}
        partial = False
        top_level: set[str] = set()

        def record_budget_skip(reason: str, name: str, marks_partial: bool = True) -> None:
            nonlocal partial
            if marks_partial:
                partial = True
            names = budget_skipped.setdefault(reason, [])
            if len(names) < MAX_REPORTED_ENTRIES:
                names.append(name)

        try:
            with tarfile.open(archive_path, mode="r:gz") as archive:
                members = archive.getmembers()
                if len(members) > self.settings.max_extracted_files:
                    # Crafted all-header archives stay tiny compressed but exhaust memory
                    # through their member index; refuse them instead of indexing further.
                    raise RepositorySizeExceeded("Repository archive declares too many entries")
                declared_size = sum(member.size for member in members if member.isfile())
                # Crafted ratio-consistent bomb guard: even at an implausibly good 40:1
                # compression ratio these entries could not fit inside the downloaded
                # archive, so refuse to spend the extraction budget on them.
                if declared_size > self.settings.max_extracted_bytes * MAX_COMPRESSION_RATIO:
                    raise RepositorySizeExceeded("Repository archive is implausibly compressed")

                for member in members:
                    if member.name:
                        top_level.add(PurePosixPath(member.name).parts[0])

                # --- Selection pass (index data only, no content decompression) ---
                # Every regular dir/file member is security-validated here so traversal
                # and absolute paths abort even when the member would be skipped.
                candidates: list[tuple[int, int, tarfile.TarInfo]] = []
                for index, member in enumerate(members):
                    is_link = member.issym() or member.islnk() or member.isdev()
                    if is_link or not (member.isdir() or member.isfile()):
                        if len(skipped) < MAX_REPORTED_ENTRIES:
                            skipped.append(member.name)
                        continue
                    self._safe_member_path(destination, member.name)
                    if not member.isfile():
                        continue
                    if self._is_ignored(member.name):
                        # Excluding vendored/generated output is the normal discovery
                        # policy, applied early here — not a resource limitation, so it
                        # is reported but does not make the analysis partial.
                        record_budget_skip("ignored directory content", member.name, marks_partial=False)
                        continue
                    if member.size > self.settings.max_single_file_bytes:
                        record_budget_skip("oversized file", member.name)
                        continue
                    candidates.append((self._priority_tier(member.name), index, member))

                included: set[int] = set()
                total_bytes = 0
                extracted_files = 0
                bytes_budget = self.settings.partial_extracted_bytes_budget
                count_budget = self.settings.partial_extracted_files_budget
                # Priority tiers first (source, then docs/config, then the rest), and
                # original order within a tier keeps extraction deterministic.
                for _, _, member in sorted(candidates, key=lambda c: (c[0], c[1])):
                    if total_bytes + member.size > bytes_budget or extracted_files + 1 > count_budget:
                        record_budget_skip("resource budget exceeded", member.name)
                        continue
                    included.add(id(member))
                    total_bytes += member.size
                    extracted_files += 1

                # --- Write pass (archive order, forward-only decompression) ---
                for member in members:
                    if member.isdir() and not self._is_ignored(member.name):
                        self._safe_member_path(destination, member.name).mkdir(parents=True, exist_ok=True)
                        continue
                    if not member.isfile() or id(member) not in included:
                        continue
                    target = self._safe_member_path(destination, member.name)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    source = archive.extractfile(member)
                    if source is None:
                        raise ArchiveSecurityError("Unable to read archive member")
                    with source, target.open("wb") as output:
                        remaining = member.size
                        while remaining:
                            chunk = source.read(min(64 * 1024, remaining))
                            if not chunk:
                                raise ArchiveSecurityError("Archive member ended before declared size")
                            output.write(chunk)
                            remaining -= len(chunk)

                root = destination / next(iter(top_level)) if len(top_level) == 1 else destination
                return ExtractionOutcome(
                    root=root,
                    extracted_files=extracted_files,
                    extracted_bytes=total_bytes,
                    skipped_entries=skipped,
                    budget_skipped=budget_skipped,
                    partial=partial,
                )
        except (tarfile.TarError, EOFError, OSError) as exc:
            raise ArchiveSecurityError("Repository archive is malformed or could not be extracted") from exc
