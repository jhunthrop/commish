"""The read cache's value form: what is read back equals what was written, bit for bit, or is refused."""

import math
from dataclasses import dataclass

import pytest

from research.db.value_codec import UnencodableError, ValueCodec


@dataclass(frozen=True, slots=True)
class Inner:
    week: int
    points: float


@dataclass(frozen=True, slots=True)
class Outer:
    name: str
    inner: Inner | None
    weeks: tuple[Inner, ...]
    flag: bool


@dataclass(frozen=True, slots=True)
class Unlisted:
    value: int


CODEC = ValueCodec((Inner, Outer))


def test_a_nested_value_comes_back_equal_with_its_types() -> None:
    value = {
        "b": [Outer("x", Inner(1, 0.1 + 0.2), (Inner(2, 1e-300),), True)],
        "a": [Outer("y", None, (), False)],
        3: (1, 2.0, None),
    }
    back = CODEC.loads(CODEC.dumps(value))
    assert back == value
    assert list(back) == ["b", "a", 3], "a mapping keeps its order and its key types"
    assert type(back[3]) is tuple
    assert type(back["b"]) is list
    assert type(back["b"][0].weeks) is tuple
    assert back["b"][0].inner.points == 0.1 + 0.2


def test_a_float_keeps_its_exact_bits() -> None:
    for number in (-0.0, 0.0, math.inf, -math.inf, 5e-324, 1.7976931348623157e308, 2.0):
        back = CODEC.loads(CODEC.dumps(number))
        assert type(back) is float
        assert math.copysign(1.0, back) == math.copysign(1.0, number)
        assert back == number
    nan = CODEC.loads(CODEC.dumps(math.nan))
    assert math.isnan(nan)


def test_a_bool_and_an_int_stay_apart() -> None:
    assert CODEC.loads(CODEC.dumps([True, 1, 1.0])) == [True, 1, 1.0]
    assert [type(v) for v in CODEC.loads(CODEC.dumps([True, 1, 1.0]))] == [bool, int, float]


@pytest.mark.parametrize("value", [{1, 2}, Unlisted(1), frozenset({1}), b"bytes"])
def test_a_value_without_an_exact_form_is_refused(value: object) -> None:
    with pytest.raises(UnencodableError):
        CODEC.dumps(value)


def test_a_class_off_the_list_is_never_built_from_its_name() -> None:
    written = ValueCodec((Unlisted,)).dumps(Unlisted(1))
    with pytest.raises(UnencodableError):
        CODEC.loads(written)
