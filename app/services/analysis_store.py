from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from app.schemas.ingestion import IngestionResult


@dataclass
class AnalysisRecord:
    analysis_id: str
    repository_url: str
    # Monotonic creation order. Wall-clock timestamps are not usable for ordering because
    # their resolution can tie on some platforms, which would make eviction non-deterministic.
    sequence: int = 0
    status: str = "queued"
    stage: str = "queued"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    error: dict[str, str] | None = None
    results: IngestionResult | None = None


class InMemoryAnalysisStore:
    def __init__(self) -> None:
        self._records: dict[str, AnalysisRecord] = {}
        self._lock = Lock()
        self._next_sequence = 0

    def create(self, analysis_id: str, repository_url: str) -> AnalysisRecord:
        with self._lock:
            self._next_sequence += 1
            record = AnalysisRecord(
                analysis_id=analysis_id,
                repository_url=repository_url,
                sequence=self._next_sequence,
            )
            self._records[analysis_id] = record
            return record

    def get(self, analysis_id: str) -> AnalysisRecord | None:
        with self._lock:
            return self._records.get(analysis_id)

    def update(self, analysis_id: str, **changes: Any) -> AnalysisRecord:
        with self._lock:
            record = self._records[analysis_id]
            for key, value in changes.items():
                setattr(record, key, value)
            record.updated_at = datetime.now(timezone.utc)
            return record

    def evict_finished_beyond(self, limit: int) -> list[AnalysisRecord]:
        """Drop the oldest finished analyses once more than ``limit`` exist.

        Running analyses are never evicted. Returns the removed records so the caller can
        release any resources they still hold.
        """
        with self._lock:
            finished = [
                record
                for record in self._records.values()
                if record.status in {"completed", "failed"}
            ]
            finished.sort(key=lambda record: record.sequence)
            removed: list[AnalysisRecord] = []
            while len(finished) > limit:
                record = finished.pop(0)
                removed.append(self._records.pop(record.analysis_id))
            return removed
