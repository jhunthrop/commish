"""THE ONE CALL'S ANSWER: both reads and the narrative object, out of one completion.

Ported from `research-ts/src/capsules/bundle.ts`. The object is read between the first `{` and the
last `}`; a raw line break inside a string (the commonest malformation) is repaired before a second
parse. A part left out is None, for the generator to write on its own.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

_ESCAPES: Final = {"\n": "\\n", "\r": "\\r", "\t": "\\t"}


@dataclass(frozen=True, slots=True)
class CapsuleBundle:
    compact: str | None
    full: str | None
    narrative: Mapping[str, object] | None


def _repair(text: str) -> str:
    out: list[str] = []
    in_string = escaped = False
    for character in text:
        if in_string and not escaped and character in _ESCAPES:
            out.append(_ESCAPES[character])
            continue
        out.append(character)
        if escaped:
            escaped = False
        elif character == "\\":
            escaped = in_string
        elif character == '"':
            in_string = not in_string
    return "".join(out)


def _object(text: str) -> dict[str, object] | None:
    try:
        parsed = json.loads(text)
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() != "" else None


def parse_bundle(content: str) -> CapsuleBundle | None:
    """`parseBundle`: the bundle out of a completion, or None when no object can be read."""
    start, end = content.find("{"), content.rfind("}")
    if start == -1 or end == -1 or end < start:
        return None
    body = content[start : end + 1]
    found = _object(body)
    if found is None:
        found = _object(_repair(body))
    if found is None:
        return None
    narrative = found.get("narrative")
    return CapsuleBundle(
        _text(found.get("compact")), _text(found.get("full")), narrative if isinstance(narrative, dict) else None
    )
