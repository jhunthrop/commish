"""THE ARITHMETIC A BOARD IS COMPUTED IN, CHOSEN BY THE BOARDS IT MUST MATCH, NEVER BY THE HOST.

Two things decide a board's last bits beyond IEEE 754's basic operations:

1. **Fused multiply-add inside V8's fdlibm** (`log`, `exp`, `sin`). The V8 node ships on Apple
   silicon was built with clang's `-ffp-contract=on`, so each `a * b + c` inside one C expression
   is one rounding; x86-64 builds have no FMA to fuse into. The stored 2026 boards reproduce bit
   for bit only with the fused arm (proven by the board parity cases), so `ARM64_BOARDS` is the
   policy every board, check and nightly runs with, on any host: a nightly on x86-64 Cloud Run
   must run fused to keep matching the arm64-made boards. The unfused arm is proven against a
   real x86-64 V8 by the committed vectors (`parity/fixtures/numerics-v8-x64`).
2. **`pow`** (`**`, outside V8's `x ** 2` and `x ** 0.5`), which V8 on macOS takes from the host
   libm, and Python takes from its host libm too. Apple's libm and glibc disagree on about 1 input
   in 500 (96 of 50,000 random inputs, measured against the committed arm64 vectors in a Linux
   Python), so a Linux host reproduces an Apple-made board's `pow` calls exactly except where
   those disagree. The board's `pow` calls are `decay ** weeks` and the scheme elasticities; the
   host's libm is recorded beside the policy, and a board made on a different libm than the one
   that made the stored board can differ there by an ulp, never by a printed decimal.

The arithmetic is recorded on every board this lane writes (`preseason_projections.arithmetic`).
"""

import os
import subprocess
import sys
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from types import MappingProxyType
from typing import Final

from research.errors import ConfigurationError

_REPO: Final = Path(__file__).resolve().parents[2]
_COMMIT_VARIABLE: Final = "RESEARCH_MODEL_COMMIT"


@dataclass(frozen=True, slots=True)
class Arithmetic:
    fused_multiply_add: bool

    @property
    def label(self) -> str:
        fma = "fused" if self.fused_multiply_add else "unfused"
        return f"v8-fdlibm-{fma}/pow-{host_libm()}"


ARM64_BOARDS: Final = Arithmetic(fused_multiply_add=True)
X86_64_BOARDS: Final = Arithmetic(fused_multiply_add=False)
# The command-line names of the two arms; `fused` is the default everywhere (see above).
ARITHMETIC_BY_NAME: Final = MappingProxyType({"fused": ARM64_BOARDS, "unfused": X86_64_BOARDS})


@dataclass(frozen=True, slots=True)
class Provenance:
    """What a written board records beside its rows: the code that made it and its arithmetic."""

    model_version: str
    arithmetic: Arithmetic


def host_libm() -> str:
    """The libm this process's `math.pow` calls."""
    if sys.platform == "darwin":
        return "apple-libm"
    if sys.platform.startswith("linux"):
        return "glibc"
    return sys.platform


@cache
def model_version() -> str:
    """`research@<sha>`: the commit of this lane's code (and so of its pinned artifact catalog).
    From `RESEARCH_MODEL_COMMIT` when the deploy sets it, else from git; a board is never written
    without one."""
    commit = os.environ.get(_COMMIT_VARIABLE, "").strip()
    if not commit:
        completed = subprocess.run(
            ["git", "rev-parse", "--short=8", "HEAD"], cwd=_REPO, capture_output=True, text=True, check=False
        )
        commit = completed.stdout.strip()
    if not commit:
        raise ConfigurationError(
            f"{_COMMIT_VARIABLE} is not set and git cannot name this tree's commit: a board needs its model version."
        )
    return f"research@{commit}"
