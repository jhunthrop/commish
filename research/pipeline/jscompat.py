"""JAVASCRIPT'S SEMANTICS, WHERE A PORT MUST REPRODUCE THEM EXACTLY.

The TypeScript core is the oracle, and parity is row for row. Wherever a mapper leans on a
JavaScript builtin whose behaviour Python does not share (`Number("")` is 0, `Number(" 12 ")` is
12, `Number("1_0")` is NaN while Python's `float("1_0")` is 10.0, `String.prototype.trim` strips a
different set of characters than `str.strip`, `Math.round(-2.5)` is -2), the port calls the
function here instead of the Python builtin. Each one names the builtin it reproduces.
"""

import json
import math
import re
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime, timedelta
from types import MappingProxyType

# ECMAScript WhiteSpace and LineTerminator code points: what `String.prototype.trim` removes.
_JS_WHITESPACE = "".join(
    chr(code)
    for code in (
        0x09, 0x0B, 0x0C, 0x20, 0xA0, 0xFEFF, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
        0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000, 0x0A, 0x0D, 0x2028, 0x2029,
    )
)  # fmt: skip

# StrDecimalLiteral, the grammar `Number(string)` accepts after trimming (plus Infinity forms).
_DECIMAL = re.compile(r"^[+-]?(?:Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$")
_NON_DECIMAL = re.compile(r"^0(?:[xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)$")


def js_trim(value: str) -> str:
    """`String.prototype.trim`."""
    return value.strip(_JS_WHITESPACE)


def js_number(value: str) -> float:
    """`Number(string)`: trims, reads "" as 0, accepts hex/octal/binary, NaN for anything else."""
    text = js_trim(value)
    if text == "":
        return 0.0
    if _NON_DECIMAL.match(text):
        base = {"x": 16, "o": 8, "b": 2}[text[1].lower()]
        return float(int(text[2:], base))
    if not _DECIMAL.match(text):
        return math.nan
    if text.endswith("Infinity"):
        return -math.inf if text.startswith("-") else math.inf
    return float(text)


def js_number_of(value: object) -> float:
    """`Number(value)` for a parsed JSON value: undefined is NaN, null and false are 0, true is 1,
    a string goes through `Number(string)`, an array of one element through that element, and
    any other object is NaN."""
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        return js_number(value)
    if isinstance(value, list):
        if len(value) == 0:
            return 0.0
        if len(value) == 1:
            return js_number_of(value[0])
        return math.nan
    return math.nan


_ARRAY_INDEX = re.compile(r"^(?:0|[1-9]\d*)$")


def js_object_keys(obj: dict[str, object]) -> list[str]:
    """`Object.keys` order: integer-like keys ascending first, then the rest in insertion order."""
    indices = sorted((k for k in obj if _ARRAY_INDEX.match(k) and int(k) < 2**32 - 1), key=int)
    index_set = set(indices)
    return [*indices, *(k for k in obj if k not in index_set)]


def js_sum(values: Iterable[float]) -> float:
    """`values.reduce((sum, value) => sum + value, 0)`: a plain left fold.

    NOT the builtin `sum`, which since Python 3.12 compensates float rounding (Neumaier) and so
    returns a different last bit from the TypeScript's naive fold. Parity is exact, so it folds."""
    total = 0.0
    for value in values:
        total += value
    return total


def js_json_stringify(value: object) -> str:
    """`JSON.stringify` of a parsed JSON value: no whitespace, keys in JavaScript's own property
    order (`js_object_keys`), numbers as JavaScript prints them (a parsed `1.0` is the number 1),
    non-ASCII left as is. What a TypeScript writer hands Postgres for a json column, and what its
    digests hash, byte for byte."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return js_string(float(value)) if abs(value) >= 2**53 else str(value)
    if isinstance(value, float):
        return js_string(value) if math.isfinite(value) else "null"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(js_json_stringify(item) for item in value) + "]"
    if isinstance(value, dict):
        return (
            "{"
            + ",".join(
                f"{json.dumps(k, ensure_ascii=False)}:{js_json_stringify(value[k])}" for k in js_object_keys(value)
            )
            + "}"
        )
    raise TypeError(f"not a JSON value: {type(value).__name__}")


def js_is_integer(value: float) -> bool:
    """`Number.isInteger`."""
    return math.isfinite(value) and value == math.floor(value)


def js_is_finite(value: float) -> bool:
    """`Number.isFinite` on a number."""
    return math.isfinite(value)


def js_math_round(value: float) -> float:
    """`Math.round`: half rounds toward +Infinity, unlike Python's banker's `round`."""
    if not math.isfinite(value):
        return value
    return float(math.floor(value + 0.5))


def js_iso(instant: datetime) -> str:
    """`Date.prototype.toISOString`: UTC, millisecond precision, a `Z` suffix."""
    utc = instant.astimezone(UTC)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


_ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_LEGACY_DATE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
_ISO_DATE_TIME = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$"
)


def js_date_parse(text: str) -> datetime | None:
    """`new Date(string)` for the ISO shapes these feeds publish, or None where V8 yields NaN.

    A date alone is UTC midnight; a date-time with a `Z` or an offset is that instant; a date-time
    with neither is LOCAL time in V8, and local is UTC here because the TypeScript runs under
    TZ=UTC in production (Vercel) and in the parity harness. Shapes outside these are not parsed,
    and the callers that reach for this treat None exactly as they treat an invalid Date.
    """
    match = _ISO_DATE.match(text)
    if match is not None:
        try:
            return datetime(int(match[1]), int(match[2]), int(match[3]), tzinfo=UTC)
        except ValueError:
            return None
    match = _LEGACY_DATE.match(text)
    if match is not None:
        # V8's legacy parser: an unpadded date is LOCAL midnight (UTC here, see above).
        try:
            return datetime(int(match[1]), int(match[2]), int(match[3]), tzinfo=UTC)
        except ValueError:
            return None
    match = _ISO_DATE_TIME.match(text)
    if match is None:
        return None
    year, month, day, hour, minute = (int(match[i]) for i in range(1, 6))
    second = int(match[6]) if match[6] is not None else 0
    millis = int((match[7] or "0")[:3].ljust(3, "0"))
    try:
        naive = datetime(year, month, day, hour, minute, second, millis * 1000, tzinfo=UTC)
    except ValueError:
        return None
    zone = match[8]
    if zone is None or zone == "Z":
        return naive
    sign = 1 if zone[0] == "+" else -1
    digits = zone[1:].replace(":", "")
    offset_minutes = int(digits[:2]) * 60 + int(digits[2:])
    return naive - sign * timedelta(minutes=offset_minutes)


def js_epoch_ms(instant: datetime) -> int:
    """`Date.prototype.getTime`."""
    return round(instant.timestamp() * 1000)


def from_epoch_ms(ms: float) -> datetime:
    """`new Date(ms)`, as an aware UTC datetime."""
    return datetime.fromtimestamp(ms / 1000, tz=UTC)


def js_string(value: float) -> str:
    """`String(number)` for the numbers these mappers print into keys and messages."""
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    if js_is_integer(value) and abs(value) < 1e21:
        return str(int(value))
    text = repr(value)
    if "e" in text:
        mantissa, exponent = text.split("e")
        sign = "-" if exponent.startswith("-") else "+"
        return f"{mantissa}e{sign}{exponent.lstrip('+-').lstrip('0') or '0'}"
    return text


# `String.prototype.localeCompare` under V8's default ICU collator (en-US, sensitivity "variant").
# Printable ASCII in the root collation's primary order, read off V8 itself: whitespace, then
# punctuation, then symbols, then digits, then letters with each case pair adjacent. Letters
# differ by case only at the tertiary level, where lowercase sorts first.
_ASCII_COLLATION_ORDER = (
    " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ"
)


def _primary_weights() -> Mapping[str, int]:
    weights: dict[str, int] = {}
    for char in _ASCII_COLLATION_ORDER:
        weights.setdefault(char.lower(), len(weights))
    return MappingProxyType(weights)


_PRIMARY = _primary_weights()

CollationKey = tuple[tuple[int, ...], tuple[int, ...]]


class UnverifiedCollationError(ValueError):
    """A string holds a character whose ICU collation weight this module has not verified."""


def collation_key(value: str) -> CollationKey:
    """A sort key that orders strings exactly as V8's `localeCompare` does, for printable ASCII.

    Printable ASCII is the alphabet whose root-collation order was read off V8 itself (see
    `_ASCII_COLLATION_ORDER`): primary weights first, then case at the tertiary level, lowercase
    first. Every id, team code and coach name these mappers sort is ASCII today. Anything else
    (an accent, a typographic apostrophe, a letter like `ø`) raises, naming the character: an
    approximated order would reorder rows silently, and a refusal can be fixed by verifying the
    character against V8 and adding it here.
    """
    primary: list[int] = []
    tertiary: list[int] = []
    for char in value:
        lowered = char.lower()
        weight = _PRIMARY.get(lowered)
        if weight is None:
            raise UnverifiedCollationError(
                f"localeCompare order is verified for printable ASCII only; {value!r} holds {char!r} (U+{ord(char):04X})."
            )
        primary.append(weight)
        tertiary.append(1 if char != lowered else 0)
    return tuple(primary), tuple(tertiary)


def js_locale_compare(left: str, right: str) -> int:
    """`left.localeCompare(right)` for the strings these mappers sort: ids, team codes, names."""
    a = collation_key(left)
    b = collation_key(right)
    return (a > b) - (a < b)


def js_code_unit_compare(left: str, right: str) -> int:
    """JavaScript's `<` on strings: UTF-16 code unit order, which equals code point order outside
    the astral planes (and these mappers never sort astral text)."""
    return (left > right) - (left < right)
