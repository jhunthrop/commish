"""Where the copies are written: the images bucket over R2's S3 API, or a local directory laid out as
the bucket (development, and a stub for checks), each copy with the year-long cache rule."""

import os
from pathlib import Path
from typing import Protocol

import httpx

from research.errors import ConfigurationError
from research.headshots.config import CACHE_CONTROL, IMAGES_BUCKET
from research.nightly.r2 import R2RunStore, credentials_from_token
from research.nightly.run_store import checked_key


class ImageBucket(Protocol):
    def put(self, key: str, body: bytes, content_type: str) -> None:
        """Write one copy, replacing what is there."""

    def locate(self, key: str) -> str:
        """Where a reader finds `key`, for log lines."""


class R2ImageBucket:
    """A bucket over R2; `prefix` puts every key under a scratch area (an operator's check)."""

    def __init__(self, store: R2RunStore, prefix: str = "") -> None:
        self.store = store
        self.prefix = prefix

    def put(self, key: str, body: bytes, content_type: str) -> None:
        headers = {"content-type": content_type, "cache-control": CACHE_CONTROL}
        self.store.put_object(self.prefix + key, body, headers)

    def delete(self, key: str) -> None:
        self.store.delete(self.prefix + key)

    def locate(self, key: str) -> str:
        return self.store.locate(self.prefix + key)


class LocalImageBucket:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def put(self, key: str, body: bytes, content_type: str) -> None:
        del content_type  # a file has no content type
        path = self.root / checked_key(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)

    def locate(self, key: str) -> str:
        return str(self.root / checked_key(key))


class _NoBucket:
    """The bucket of a command that writes no copy (a listing, a refresh mark)."""

    def put(self, key: str, body: bytes, content_type: str) -> None:
        raise ConfigurationError(f"this command writes no copy ({key}, {content_type}, {len(body)} bytes)")

    def locate(self, key: str) -> str:
        return key


NO_BUCKET: ImageBucket = _NoBucket()


def image_bucket(out: str | None, http: httpx.Client) -> ImageBucket:
    """A local directory when `out` is given, else `commish-images` (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)."""
    if out is not None:
        return LocalImageBucket(Path(out))
    account, credentials = credentials_from_token(http, os.environ)
    return R2ImageBucket(R2RunStore(http, account, credentials, IMAGES_BUCKET))
