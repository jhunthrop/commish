"""THE NUMERICS CASE: V8's transcendentals, its `**`, `Math.round` and mulberry32, against the
Python reproductions in `research.model.{fdlibm,jsmath}` and `research.model.laws.harness`.

The TypeScript side (`ts/numerics.ts`) prints random inputs with V8's answers as IEEE 754 bit
patterns; every line is recomputed here and must agree on every bit. This is the proof that the
board's arithmetic can be exact at all: a single ulp of `log` would surface in a games outlook.
"""

import struct
import subprocess
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from research.model.fdlibm import V8_FUSES_MULTIPLY_ADD, exp, log, sin
from research.model.jsmath import js_pow, js_round
from research.model.laws.harness import mulberry32

_TS: Final = Path(__file__).resolve().parent.parent / "ts" / "numerics.ts"
_REPO: Final = Path(__file__).resolve().parents[3]
_DOUBLE: Final = struct.Struct(">d")


def _float(bits: str) -> float:
    return float(_DOUBLE.unpack(bytes.fromhex(bits))[0])


@dataclass(frozen=True, slots=True)
class NumericsResult:
    checked: Counter[str]
    differing: Counter[str]
    fused: bool
    examples: tuple[str, ...]

    @property
    def matches(self) -> bool:
        return sum(self.differing.values()) == 0 and sum(self.checked.values()) > 0


_UNARY: Final[dict[str, Callable[[float], float]]] = {"log": log, "exp": exp, "sin": sin, "round": js_round}


def run_numerics(count: int, seed: int) -> NumericsResult:
    """Runs V8, recomputes every line, and counts agreement per function."""
    completed = subprocess.run(
        ["npx", "tsx", str(_TS), str(count), str(seed)], cwd=_REPO, check=True, capture_output=True, text=True
    )
    checked: Counter[str] = Counter()
    differing: Counter[str] = Counter()
    examples: list[str] = []
    streams: dict[int, Callable[[], float]] = {}
    for line in completed.stdout.splitlines():
        kind, *fields = line.split()
        if kind == "mulberry32":
            stream = streams.setdefault(int(fields[0]), mulberry32(int(fields[0])))
            ours, theirs = stream(), _float(fields[2])
        elif kind == "pow":
            ours, theirs = js_pow(_float(fields[0]), _float(fields[1])), _float(fields[2])
        else:
            ours, theirs = _UNARY[kind](_float(fields[0])), _float(fields[1])
        checked[kind] += 1
        if _DOUBLE.pack(ours) != _DOUBLE.pack(theirs):
            differing[kind] += 1
            if len(examples) < 5:  # noqa: PLR2004 - a few examples are enough to name the failure
                examples.append(f"{line} -> python {ours!r}")
    return NumericsResult(checked, differing, V8_FUSES_MULTIPLY_ADD, tuple(examples))
