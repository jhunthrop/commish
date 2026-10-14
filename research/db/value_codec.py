"""AN EXACT JSON FORM FOR A READ'S RESULT: frozen dataclasses, mappings, lists and tuples of numbers
and text, written so that reading it back gives a value equal to the one written, bit for bit.

What a cached read hands back must be indistinguishable from what the read itself returns, since a
capsule's facts hash is taken over the sheet those values fill. So the form keeps what plain JSON
loses: a tuple stays a tuple, a mapping keeps its order and its key types, a dataclass comes back as
its own class (named on an explicit list, never imported by name), and a float keeps its exact bits
(Python's `repr` round-trips, `-0.0` included). Anything else (a set, an enum, a datetime) is
refused with `UnencodableError`, and the caller reads without the cache.
"""

import json
import math
from collections.abc import Iterable, Mapping
from dataclasses import fields, is_dataclass
from typing import Any, Final

_DATACLASS: Final = "d"
_MAPPING: Final = "m"
_TUPLE: Final = "t"
_FLOAT: Final = "f"
_SCALARS: Final = (str, int, bool)


class UnencodableError(TypeError):
    """A value the codec has no exact form for."""


class ValueCodec:
    """Encodes and decodes values whose dataclasses are among `classes`."""

    def __init__(self, classes: Iterable[type]) -> None:
        self._by_name: dict[str, type] = {}
        for cls in classes:
            if not is_dataclass(cls):
                raise TypeError(f"{cls.__name__} is not a dataclass")
            self._by_name[cls.__qualname__] = cls

    def dumps(self, value: Any) -> str:
        return json.dumps(self._encode(value), separators=(",", ":"), allow_nan=False)

    def loads(self, text: str) -> Any:
        return self._decode(json.loads(text))

    def _encode(self, value: Any) -> Any:
        if value is None or type(value) in _SCALARS:
            return value
        if type(value) is float:
            # repr round-trips exactly; JSON numbers would drop -0.0 and refuse a NaN.
            return {_FLOAT: repr(value)} if not math.isfinite(value) or value == 0 else value
        if is_dataclass(value) and not isinstance(value, type):
            name = type(value).__qualname__
            if self._by_name.get(name) is not type(value):
                raise UnencodableError(f"{name} is not on the codec's list")
            return {_DATACLASS: name, "v": [self._encode(getattr(value, f.name)) for f in fields(value)]}
        if type(value) is list:
            return [self._encode(item) for item in value]
        if type(value) is tuple:
            return {_TUPLE: [self._encode(item) for item in value]}
        if type(value) is dict:
            return {_MAPPING: [[self._encode(k), self._encode(v)] for k, v in value.items()]}
        raise UnencodableError(f"no exact form for {type(value).__name__}")

    def _decode(self, raw: Any) -> Any:
        if raw is None or type(raw) in (*_SCALARS, float):
            return raw
        if type(raw) is list:
            return [self._decode(item) for item in raw]
        if not isinstance(raw, Mapping):
            raise UnencodableError(f"no value is written as {type(raw).__name__}")
        if _FLOAT in raw:
            return float(raw[_FLOAT])
        if _TUPLE in raw:
            return tuple(self._decode(item) for item in raw[_TUPLE])
        if _MAPPING in raw:
            return {self._decode(k): self._decode(v) for k, v in raw[_MAPPING]}
        cls = self._by_name.get(raw[_DATACLASS])
        if cls is None:
            raise UnencodableError(f"{raw[_DATACLASS]} is not on the codec's list")
        return cls(*(self._decode(item) for item in raw["v"]))
