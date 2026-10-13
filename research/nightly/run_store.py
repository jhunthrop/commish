"""WHERE A RUN IS WRITTEN: a key-value store of bytes, a local directory in development and the R2
bucket in production (`nightly.r2`). The run never touches a filesystem or a bucket directly, so the
two are one constructor each.

Keys are plain relative paths (`runs/2026-10-13T05/manifest.json`). `claim` writes only when the
key is absent, atomically: it is how a run takes its id, so an id is never reused, even by two runs
racing for the same hour.
"""

from pathlib import Path
from typing import Final, Protocol

from research.errors import ConfigurationError

JSON_TYPE: Final = "application/json"


class RunStore(Protocol):
    def put(self, key: str, body: bytes, content_type: str) -> None:
        """Write `body` at `key`, replacing whatever is there."""

    def claim(self, key: str, body: bytes, content_type: str) -> bool:
        """Write `body` at `key` only if nothing is there; False when the key was already taken."""

    def get(self, key: str) -> bytes | None:
        """The object at `key`, or None."""

    def exists(self, key: str) -> bool:
        """Whether an object is at `key`."""

    def locate(self, key: str) -> str:
        """Where a reader finds `key`, for log lines."""


def checked_key(key: str) -> str:
    """A key as a plain relative POSIX path: no empty segment, no `.` or `..`, no leading slash."""
    if not key or any(segment in {"", ".", ".."} for segment in key.split("/")):
        raise ConfigurationError(f'run store key "{key}" is not a plain relative path.')
    return key


class LocalRunStore:
    """A directory: the development target, laid out exactly as the bucket is, so the web build reads
    it with `PUBLIC_RUN_BASE_URL=<this directory>`."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _path(self, key: str) -> Path:
        return self.root / checked_key(key)

    def put(self, key: str, body: bytes, content_type: str) -> None:
        del content_type  # a file has no content type
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)

    def claim(self, key: str, body: bytes, content_type: str) -> bool:
        del content_type
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("xb") as file:
                file.write(body)
        except FileExistsError:
            return False
        return True

    def get(self, key: str) -> bytes | None:
        path = self._path(key)
        return path.read_bytes() if path.is_file() else None

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def locate(self, key: str) -> str:
        return str(self._path(key))
