"""THE SITE'S ONE ROUNDING RULE for a figure a screen shows (Lane 66k H1, the API's `tenth.Round`).

The nightly's writer rounds each board figure once, here, where it writes the board, and the web
prints the tenth as given. Half away from zero, on the shortest decimal the float is written as
(`repr`), so 9.45 gives 9.5 though the binary 9.45 sits just below it, and a sum with binary noise
(74.69999999999999) rounds back to the tenth it is. The cases are web/src/lib/format/tenth-table.json,
the table the Go and web tests read too.
"""

import math
from decimal import ROUND_HALF_UP, Decimal
from typing import Final

_TENTH: Final = Decimal("0.1")


def tenth(n: float) -> float:
    """`n` to one decimal, half away from zero; a value that is not finite passes through."""
    if not math.isfinite(n):
        return n
    out = float(Decimal(repr(n)).quantize(_TENTH, rounding=ROUND_HALF_UP))
    # -0.04 rounds to zero, never to a signed zero.
    return out if out != 0 else 0.0


def tenth_or_none(n: float | None) -> float | None:
    """`tenth` for a figure that may be absent (a range the run does not carry, no ADP)."""
    return None if n is None else tenth(n)
