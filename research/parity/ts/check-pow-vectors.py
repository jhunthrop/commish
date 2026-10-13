"""Checks the `pow` lines of a committed V8 vector file against this interpreter's libm `pow`
(with V8's two special cases), stdlib only, so it runs in a bare Python image of the same
platform the vectors were made on:

    docker run --rm --platform linux/amd64 -v "$PWD/research/parity:/p" python:3.13-slim \\
      python /p/ts/check-pow-vectors.py /p/fixtures/numerics-v8-x64/vectors.txt.gz
"""

import gzip
import math
import struct
import sys


def v8_pow(x: float, y: float) -> float:
    if y == 2:
        return x * x
    if y == 0.5 and x > 0 and not math.isinf(x):  # noqa: PLR2004 - V8's own special case
        return math.sqrt(x)
    try:
        return math.pow(x, y)
    except (OverflowError, ValueError):
        return math.inf


def main(path: str) -> int:
    unpack = struct.Struct(">d").unpack
    checked = differing = 0
    for line in gzip.open(path, "rt"):
        if not line.startswith("pow"):
            continue
        _, a, b, c = line.split()
        x, y, expected = (unpack(bytes.fromhex(h))[0] for h in (a, b, c))
        checked += 1
        if struct.pack(">d", v8_pow(x, y)) != struct.pack(">d", expected):
            differing += 1
    sys.stdout.write(f"pow: {checked} checked, {differing} differ\n")
    return 1 if differing else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
