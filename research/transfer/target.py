"""WHERE A MEASUREMENT MAY CONNECT: a loopback Postgres named by the URL's host alone.

A measurement runs the nightly's steps, which write; pointed at a hosted store it would be the
2026-09-07 and 2026-10-14 incidents again. So the URL must name a loopback host (`localhost`, or an
address `ipaddress` calls loopback, IPv6 included) and carry no query string at all: libpq reads
`host`, `hostaddr`, `port` and `service` from the query ahead of the URL's own host (review HIGH-2),
and a local measurement needs no query.
"""

import ipaddress
from dataclasses import dataclass
from typing import Final
from urllib.parse import urlsplit, urlunsplit

LOCALHOST: Final = "localhost"
DEFAULT_PORT: Final = 5432


class RefusedTargetError(ValueError):
    """A URL a measurement may not connect to."""


@dataclass(frozen=True, slots=True)
class Target:
    host: str
    port: int


def is_loopback(host: str) -> bool:
    if host == LOCALHOST:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def checked_target(url: str) -> Target:
    """The loopback host and port `url` names; refuses anything else, naming why but not the URL."""
    parts = urlsplit(url)
    if parts.query or parts.fragment:
        raise RefusedTargetError("the URL carries a query string; a measurement's URL may name only its host")
    host = parts.hostname or ""
    if not is_loopback(host):
        raise RefusedTargetError(f"the URL must name a loopback host; refusing {host!r}")
    return Target(host, parts.port or DEFAULT_PORT)


def through_relay(url: str, relay_port: int) -> str:
    """`url` (already checked) pointed at the relay's loopback port instead of its own host."""
    parts = urlsplit(url)
    userinfo = parts.netloc.rsplit("@", 1)[0] + "@" if "@" in parts.netloc else ""
    return urlunsplit((parts.scheme, f"{userinfo}127.0.0.1:{relay_port}", parts.path, "", ""))
