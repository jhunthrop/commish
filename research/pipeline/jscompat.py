"""JAVASCRIPT'S SEMANTICS, WHERE A PORT MUST REPRODUCE THEM EXACTLY.

The TypeScript core is the oracle, and parity is row for row. Wherever a mapper leans on a
JavaScript builtin whose behaviour Python does not share (`Number("")` is 0, `Number(" 12 ")` is
12, `Number("1_0")` is NaN while Python's `float("1_0")` is 10.0, `String.prototype.trim` strips a
different set of characters than `str.strip`, `Math.round(-2.5)` is -2), the port calls the
function here instead of the Python builtin. Each one names the builtin it reproduces.
"""

import math
import re
import unicodedata
from datetime import UTC, datetime

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


def _primary_weights() -> dict[str, int]:
    weights: dict[str, int] = {}
    for char in _ASCII_COLLATION_ORDER:
        weights.setdefault(char.lower(), len(weights))
    return weights


_PRIMARY = _primary_weights()

CollationKey = tuple[tuple[int, ...], tuple[int, ...], tuple[int, ...]]


def collation_key(value: str) -> CollationKey:
    """A sort key that orders strings the way `localeCompare` does (three UCA levels)."""
    primary: list[int] = []
    secondary: list[int] = []
    tertiary: list[int] = []
    for char in unicodedata.normalize("NFD", value):
        if unicodedata.combining(char):
            # A combining accent carries no primary weight: it only breaks ties at the second level.
            secondary.append(ord(char))
            continue
        lowered = char.lower()
        weight = _PRIMARY.get(lowered)
        primary.append(weight if weight is not None else len(_PRIMARY) + ord(lowered))
        secondary.append(0)
        tertiary.append(1 if char != lowered else 0)
    return tuple(primary), tuple(secondary), tuple(tertiary)


def js_locale_compare(left: str, right: str) -> int:
    """`left.localeCompare(right)` for the strings these mappers sort: ids, team codes, names."""
    a = collation_key(left)
    b = collation_key(right)
    return (a > b) - (a < b)


def js_code_unit_compare(left: str, right: str) -> int:
    """JavaScript's `<` on strings: UTF-16 code unit order, which equals code point order outside
    the astral planes (and these mappers never sort astral text)."""
    return (left > right) - (left < right)
