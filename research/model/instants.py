"""INSTANTS AS THE ORACLE HOLDS THEM: a JavaScript `Date` keeps milliseconds, Postgres keeps
microseconds. Every instant read from the store is truncated to the millisecond on the way in, so
`a > b` between two of them answers what the TypeScript's comparison answered."""

from datetime import UTC, datetime
from typing import Final

FAR_FUTURE: Final = datetime(9999, 12, 31, tzinfo=UTC)
_EPOCH: Final = datetime(1970, 1, 1, tzinfo=UTC)


def ms_instant(value: datetime) -> datetime:
    """`value` truncated to the millisecond, in UTC (what `new Date(<timestamptz text>)` keeps)."""
    utc = value.astimezone(UTC)
    return utc.replace(microsecond=utc.microsecond - utc.microsecond % 1000)


def epoch_ms(value: datetime) -> int:
    """`date.getTime()`."""
    utc = value.astimezone(UTC)
    whole = (utc.replace(microsecond=0) - _EPOCH) // _SECOND
    return int(whole) * 1000 + utc.microsecond // 1000


def from_epoch_ms(ms: int) -> datetime:
    """`new Date(ms)`."""
    seconds, millis = divmod(ms, 1000)
    return datetime.fromtimestamp(seconds, tz=UTC).replace(microsecond=millis * 1000)


def js_iso(value: datetime) -> str:
    """`date.toISOString()`."""
    utc = value.astimezone(UTC)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


_SECOND: Final = datetime(1970, 1, 1, 0, 0, 1, tzinfo=UTC) - _EPOCH
