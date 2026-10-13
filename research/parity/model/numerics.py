"""THE NUMERICS CASE: V8's transcendentals, its `**`, `Math.round`, `Math.max`/`Math.min` on signed
zeros, the register's NaN-aware ordinal comparator and sort, and mulberry32, against the Python reproductions in
`research.model.{fdlibm,jsmath}`, `research.model.register.grade` and `research.model.laws.harness`.

Three sources of V8 answers, each a list of inputs with V8's results as IEEE 754 bit patterns:

- the running node (`ts/numerics.ts`), judged with BOTH fused-multiply-add arms of `log`, `exp` and
  `sin`: exactly one arm must agree on every line, and the case names which;
- the committed arm64 macOS vectors (`fixtures/numerics-v8-arm64`), which the fused arm must match;
- the committed x86-64 Linux vectors (`fixtures/numerics-v8-x64`), which the unfused arm must match.

A source's `pow` lines are judged only where its `**` is this host's libm (the header's platform
names it: V8 on macOS takes `pow` from Apple's libm). V8 on x86-64 Linux computes a `pow` that
matches neither glibc nor Apple's libm nor a correctly rounded pow, so those lines are counted as
skipped and named, never passed.
"""

import gzip
import struct
import subprocess
from collections import Counter
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Final

from research.model.arithmetic import host_libm
from research.model.fdlibm import exp, log, sin
from research.model.jsmath import js_max, js_min, js_pow, js_round
from research.model.laws.harness import mulberry32
from research.model.register.grade import ordinal_compare, ordinal_ranks

_PARITY: Final = Path(__file__).resolve().parent.parent
_TS: Final = _PARITY / "ts" / "numerics.ts"
_REPO: Final = _PARITY.parents[1]
_DOUBLE: Final = struct.Struct(">d")
_TRANSCENDENTAL: Final[Mapping[str, Callable[..., float]]] = MappingProxyType({"log": log, "exp": exp, "sin": sin})
_BINARY: Final[Mapping[str, Callable[[float, float], float]]] = MappingProxyType(
    {"pow": js_pow, "max": js_max, "min": js_min}
)
_EXAMPLES: Final = 5
COMMITTED_VECTORS: Final = MappingProxyType(
    {
        _PARITY / "fixtures" / "numerics-v8-arm64" / "vectors.txt.gz": True,
        _PARITY / "fixtures" / "numerics-v8-x64" / "vectors.txt.gz": False,
    }
)


def _float(bits: str) -> float:
    return float(_DOUBLE.unpack(bytes.fromhex(bits))[0])


def _bits(value: float) -> bytes:
    return _DOUBLE.pack(value)


def source_libm(header: str) -> str:
    """Whose `pow` a node's `**` is, from its header (`# node <version> <arch> <platform>`)."""
    _, _, _, arch, platform = header.split()
    return "apple-libm" if platform == "darwin" else f"v8-{platform}-{arch}"


@dataclass(frozen=True, slots=True)
class VectorCheck:
    """One source judged: per kind, lines checked, lines differing, and lines not judgeable here."""

    source: str
    fused: bool | None
    checked: Counter[str] = field(default_factory=Counter)
    differing: Counter[str] = field(default_factory=Counter)
    skipped: Counter[str] = field(default_factory=Counter)
    other_arm_differs: int = 0
    examples: Mapping[str, tuple[str, ...]] = field(default_factory=dict)


def _ordinal(fields: list[str]) -> bool:
    entries = [(key, _float(bits)) for key, bits in (pair.split("=") for pair in fields[0].split(","))]
    ranks = ordinal_ranks(entries)
    return sorted(ranks, key=lambda key: ranks[key]) == fields[1].split(",")


def _ordinal_pair(fields: list[str]) -> bool:
    left, right = ((key, _float(bits)) for key, bits in (field.split("=") for field in fields[:2]))
    result = ordinal_compare(left, right)
    return (result > 0) - (result < 0) == int(fields[2])


def _arm_differs(lines: list[list[str]], fused: bool) -> list[str]:
    return [
        " ".join(line)
        for line in lines
        if _bits(_TRANSCENDENTAL[line[0]](_float(line[1]), fused=fused)) != _bits(_float(line[2]))
    ]


def _plain(line: list[str], streams: dict[int, Callable[[], float]]) -> bool:
    kind, *fields = line
    if kind == "mulberry32":
        stream = streams.setdefault(int(fields[0]), mulberry32(int(fields[0])))
        return _bits(stream()) == _bits(_float(fields[2]))
    if kind == "round":
        return _bits(js_round(_float(fields[0]))) == _bits(_float(fields[1]))
    if kind == "ordinal":
        return _ordinal(fields)
    if kind == "ordcmp":
        return _ordinal_pair(fields)
    return _bits(_BINARY[kind](_float(fields[0]), _float(fields[1]))) == _bits(_float(fields[2]))


def judge(text: Iterable[str], fused: bool | None) -> VectorCheck:
    """Every line of one source. `fused` is the arm the source must match; None (the running node)
    takes the arm that matches every transcendental line, if exactly one does."""
    lines = [line.split() for line in text if line.strip()]
    header = " ".join(lines[0])
    judges_pow = source_libm(header) == host_libm()
    transcendental = [line for line in lines[1:] if line[0] in _TRANSCENDENTAL]
    by_arm = {arm: _arm_differs(transcendental, arm) for arm in (True, False)}
    arm = fused if fused is not None else next((a for a, wrong in by_arm.items() if not wrong and by_arm[not a]), None)
    checked: Counter[str] = Counter(line[0] for line in transcendental)
    wrong: list[str] = list(by_arm[arm]) if arm is not None else []
    skipped: Counter[str] = Counter()
    streams: dict[int, Callable[[], float]] = {}
    for line in lines[1:]:
        if line[0] in _TRANSCENDENTAL:
            continue
        if line[0] == "pow" and not judges_pow:
            skipped["pow"] += 1
            continue
        checked[line[0]] += 1
        if not _plain(line, streams):
            wrong.append(" ".join(line))
    differing: Counter[str] = Counter(line.split()[0] for line in wrong)
    examples = {kind: tuple(line for line in wrong if line.split()[0] == kind)[:_EXAMPLES] for kind in differing}
    other = len(by_arm[not arm]) if arm is not None else 0
    return VectorCheck(header, arm, checked, differing, skipped, other, examples)


def run_live(count: int, seed: int) -> VectorCheck:
    """The running node's answers, judged with both arms."""
    completed = subprocess.run(
        ["npx", "tsx", str(_TS), str(count), str(seed)], cwd=_REPO, check=True, capture_output=True, text=True
    )
    return judge(completed.stdout.splitlines(), None)


def run_committed(vectors: Mapping[Path, bool] = COMMITTED_VECTORS) -> list[VectorCheck]:
    """Each committed vector file, judged with the arm its architecture computes."""
    checks = []
    for path, fused in vectors.items():
        with gzip.open(path, "rt") as handle:
            checks.append(judge(handle, fused))
    return checks
