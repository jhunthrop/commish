"""One source image fetched, bounded, and converted to webp at every kept width."""

import io
from dataclasses import dataclass
from typing import Final

import httpx
from PIL import Image, UnidentifiedImageError

from research.headshots.config import NO_PHOTO_MARK, WIDTHS

MAX_BYTES: Final = 2 * 1024 * 1024
MAX_PIXELS: Final = 4096 * 4096
_TIMEOUT_SECONDS: Final = 20.0
_OK: Final = 200
_GONE: Final = frozenset({404, 410})
_FORMATS: Final = frozenset({"PNG", "JPEG", "WEBP"})
_QUALITY: Final = 82


class NoImageError(Exception):
    """The source has no image of him: no URL, the provider's placeholder, a 404."""


class FetchFailedError(Exception):
    """The fetch or the conversion failed; a later try may succeed."""


@dataclass(frozen=True, slots=True)
class Source:
    url: str | None
    # The hosts the URL may name; None for any (a curator's choice).
    allowed_hosts: frozenset[str] | None


def check_source(source: Source) -> httpx.URL:
    """The source's URL, refused when it names no image or a host it may not."""
    if not source.url or NO_PHOTO_MARK in source.url:
        raise NoImageError("the source has no photo")
    try:
        url = httpx.URL(source.url)
    except httpx.InvalidURL as error:
        raise FetchFailedError(f"not a URL: {error}") from error
    if url.scheme != "https":
        raise FetchFailedError("not an https URL")
    if source.allowed_hosts is not None and url.host not in source.allowed_hosts:
        raise FetchFailedError(f"{url.host} is not the provider's image host")
    return url


def fetch(http: httpx.Client, source: Source) -> bytes:
    """The image's bytes, never redirected, and refused past `MAX_BYTES` while it streams."""
    url = check_source(source)
    try:
        with http.stream("GET", url, timeout=_TIMEOUT_SECONDS, follow_redirects=False) as response:
            if response.status_code in _GONE:
                raise NoImageError(f"HTTP {response.status_code}")
            if response.status_code != _OK:
                raise FetchFailedError(f"HTTP {response.status_code}")
            body = bytearray()
            for chunk in response.iter_bytes():
                body += chunk
                if len(body) > MAX_BYTES:
                    raise FetchFailedError(f"the image passed {MAX_BYTES} bytes")
            return bytes(body)
    except httpx.HTTPError as error:
        raise FetchFailedError(f"{type(error).__name__}: {error}") from error


def webp_widths(body: bytes) -> dict[int, bytes]:
    """The image at every kept width, its aspect and transparency kept, as webp."""
    try:
        with Image.open(io.BytesIO(body)) as opened:
            if opened.format not in _FORMATS:
                raise FetchFailedError(f"not a PNG, JPEG or WEBP image ({opened.format})")
            if opened.width * opened.height > MAX_PIXELS:
                raise FetchFailedError(f"the image is {opened.width} x {opened.height}")
            image = opened.convert("RGBA")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as error:
        raise FetchFailedError(f"not an image: {error}") from error
    out = {}
    for width in WIDTHS:
        height = max(1, round(image.height * width / image.width))
        buffer = io.BytesIO()
        image.resize((width, height), Image.Resampling.LANCZOS).save(buffer, "WEBP", quality=_QUALITY, method=6)
        out[width] = buffer.getvalue()
    return out
