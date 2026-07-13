from __future__ import annotations

import csv
import fcntl
from pathlib import Path
import sys
import tempfile
from typing import Callable, Iterator, TypeVar

from contextlib import contextmanager

from social_flow.models import QUEUE_COLUMNS, QueueRow

T = TypeVar("T")


def _allow_large_tsv_fields() -> None:
    csv.field_size_limit(sys.maxsize)


class LocalQueueRepository:
    def __init__(self, path: str) -> None:
        self._path = Path(path)

    @property
    def path(self) -> Path:
        return self._path

    @property
    def _lock_path(self) -> Path:
        return self._path.with_suffix(self._path.suffix + ".lock")

    @contextmanager
    def _exclusive_lock(self) -> Iterator[None]:
        self._lock_path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock_path.open("a+", encoding="utf-8") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def bootstrap(self) -> None:
        with self._exclusive_lock():
            if self._path.exists():
                rows = self._path.read_text(encoding="utf-8").splitlines()
                if rows:
                    return
            self._path.write_text("\t".join(QUEUE_COLUMNS) + "\n", encoding="utf-8")

    def read_all(self) -> list[QueueRow]:
        with self._exclusive_lock():
            return self._read_all_unlocked()

    def append(self, queue_row: QueueRow) -> None:
        with self._exclusive_lock():
            self._bootstrap_unlocked()
            with self._path.open("a", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
                writer.writerow(queue_row.as_row())

    def update(self, queue_row: QueueRow) -> None:
        with self._exclusive_lock():
            rows = self._read_all_unlocked()
            updated = False
            for index, existing in enumerate(rows):
                if existing.id == queue_row.id:
                    rows[index] = queue_row
                    updated = True
                    break
            if not updated:
                raise KeyError(f"Queue row not found: {queue_row.id}")
            self._write_all_unlocked(rows)

    def replace_all(self, rows: list[QueueRow]) -> None:
        with self._exclusive_lock():
            self._write_all_unlocked(rows)

    def mutate_all(self, mutator: Callable[[list[QueueRow]], T]) -> T:
        with self._exclusive_lock():
            rows = self._read_all_unlocked()
            result = mutator(rows)
            should_write = bool(result.get("changed")) if isinstance(result, dict) and "changed" in result else bool(result)
            if should_write:
                self._write_all_unlocked(rows)
            return result

    def get(self, item_id: str) -> QueueRow | None:
        for row in self.read_all():
            if row.id == item_id:
                return row
        return None

    def _bootstrap_unlocked(self) -> None:
        if self._path.exists():
            rows = self._path.read_text(encoding="utf-8").splitlines()
            if rows:
                return
        self._path.write_text("\t".join(QUEUE_COLUMNS) + "\n", encoding="utf-8")

    def _read_all_unlocked(self) -> list[QueueRow]:
        if not self._path.exists():
            return []
        with self._path.open("r", encoding="utf-8", newline="") as handle:
            _allow_large_tsv_fields()
            reader = csv.reader(handle, delimiter="\t")
            rows = list(reader)
        if not rows:
            return []
        header = rows[0]
        return [QueueRow.from_sheet_row(row, header) for row in rows[1:] if any(cell.strip() for cell in row)]

    def _write_all_unlocked(self, rows: list[QueueRow]) -> None:
        self._bootstrap_unlocked()
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            newline="",
            dir=str(self._path.parent),
            delete=False,
        ) as handle:
            writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
            writer.writerow(QUEUE_COLUMNS)
            for row in rows:
                writer.writerow(row.as_row())
            temp_path = Path(handle.name)
        temp_path.replace(self._path)
