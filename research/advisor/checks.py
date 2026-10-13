"""THE ORACLE'S BOUNDARY CHECKS, WORD FOR WORD: zod 4's issues for the JSON types `POST /advise` takes.

`research-ts/src/advisor/request.ts` validates with zod, and its 400 names every issue as zod words
it. These are those checks and those words, so a refused body is refused with the oracle's text,
byte for byte (`parity decide advise-refusals`):
- a value of the wrong type, an option that is not one, and a number that is not an int abort: the
  value is checked no further, and the schema's `superRefine` does not run;
- a bound (too small, too big, an int past the safe range) is reported and the checks go on.

Numbers are JavaScript's: every JSON number is a double (`parse_body` reads them so), an
overflowing literal is Infinity, and Infinity is not a number to zod.
"""

import json
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Final

type Path = tuple[str | int, ...]

MISSING: Final = object()
NOT_JSON: Final = "the body is not JSON"
_SAFE_INTEGER: Final = 2**53 - 1


class NotJsonError(ValueError):
    """`JSON.parse` would throw."""


@dataclass(frozen=True, slots=True)
class Issue:
    path: Path
    message: str
    aborts: bool

    def text(self) -> str:
        """As the oracle's server joins it: the dotted path, or "body", then the message."""
        return f"{'.'.join(str(part) for part in self.path) or 'body'}: {self.message}"


@dataclass(frozen=True, slots=True)
class Bound:
    """One number check after the type: `>=`, `>` or `<=` a value, in the schema's order."""

    relation: str
    value: int

    def broken_by(self, number: float) -> bool:
        if self.relation == ">=":
            return number < self.value
        if self.relation == ">":
            return number <= self.value
        return number > self.value

    def message(self, kind: str) -> str:
        size = "Too big" if self.relation == "<=" else "Too small"
        return f"{size}: expected {kind} to be {self.relation}{self.value}"


def _reject_constant(name: str) -> float:
    raise NotJsonError(name)


def parse_body(raw: str | bytes) -> object:
    """The body as `JSON.parse` reads it (every number a double), or `NotJsonError`."""
    text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw
    try:
        return json.loads(text, parse_int=float, parse_constant=_reject_constant)
    except (ValueError, RecursionError) as error:
        raise NotJsonError(NOT_JSON) from error


def received(value: object) -> str:
    """zod's name for what it was given."""
    if value is MISSING:
        return "undefined"
    names: Mapping[type, str] = {bool: "boolean", float: "number", str: "string", list: "array", dict: "object"}
    return "null" if value is None else names.get(type(value), "unknown")


def _wrong_type(path: Path, expected: str, value: object) -> list[Issue]:
    return [Issue(path, f"Invalid input: expected {expected}, received {received(value)}", aborts=True)]


def number(value: object, path: Path, bounds: Sequence[Bound] = (), *, integer: bool = False) -> list[Issue]:
    """`z.number()`, then `.int()` when `integer`, then each bound in order."""
    if type(value) is not float or not math.isfinite(value):
        return _wrong_type(path, "number", value)
    issues: list[Issue] = []
    if integer:
        if not value.is_integer():
            return _wrong_type(path, "int", value)
        if value > _SAFE_INTEGER:
            issues.append(Issue(path, f"Too big: expected int to be <={_SAFE_INTEGER}", aborts=False))
        elif value < -_SAFE_INTEGER:
            issues.append(Issue(path, f"Too small: expected int to be >=-{_SAFE_INTEGER}", aborts=False))
    issues += [Issue(path, b.message("number"), aborts=False) for b in bounds if b.broken_by(value)]
    return issues


def string(value: object, path: Path) -> list[Issue]:
    """`z.string().min(1)`."""
    if type(value) is not str:
        return _wrong_type(path, "string", value)
    return [] if value else [Issue(path, "Too small: expected string to have >=1 characters", aborts=False)]


def option(value: object, path: Path, options: Sequence[str]) -> list[Issue]:
    """`z.enum(options)`."""
    if type(value) is str and value in options:
        return []
    listed = "|".join(f'"{name}"' for name in options)
    return [Issue(path, f"Invalid option: expected one of {listed}", aborts=True)]


def array(value: object, path: Path, element: Callable[[object, Path], list[Issue]], *, non_empty: bool) -> list[Issue]:
    """`z.array(element)`, `.min(1)` when `non_empty`."""
    if type(value) is not list:
        return _wrong_type(path, "array", value)
    issues = [issue for index, item in enumerate(value) for issue in element(item, (*path, index))]
    if non_empty and not value:
        issues.append(Issue(path, "Too small: expected array to have >=1 items", aborts=False))
    return issues


def obj(value: object, path: Path) -> list[Issue]:
    """`z.object(...)`'s own type check; its fields are checked by the caller, in the shape's order."""
    return [] if type(value) is dict else _wrong_type(path, "object", value)
