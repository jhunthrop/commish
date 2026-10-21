"""A departure from the oracle is declared, never hidden (Lane 78): one key, one column, both values and
why. The declared difference matches; any other difference still fails, and a declared one that no
longer appears fails too, so the declaration cannot outlive the departure."""

from research.parity.diff import Departure, TableSpec, _Collector, _compare_key, _Rules, declared, unmatched_departures

_SPELLING = Departure(("4569682",), "name", "Audric Estime", "Audric Estimé", "a name as he spells it")


def test_a_declared_departure_matches_only_itself() -> None:
    departures = (_SPELLING,)
    assert declared(departures, ("4569682",), "name", "Audric Estime", "Audric Estimé") is _SPELLING
    assert declared(departures, ("4569682",), "name", "Audric Estime", "Audric Estim") is None
    assert declared(departures, ("4569682",), "team", "Audric Estime", "Audric Estimé") is None
    assert declared(departures, ("4040",), "name", "Audric Estime", "Audric Estimé") is None


def test_a_declared_departure_that_never_appears_fails() -> None:
    assert unmatched_departures((_SPELLING,), seen=set()) == [
        "('4569682',) name: the declared departure (ts='Audric Estime' py='Audric Estimé') did not appear"
    ]
    assert unmatched_departures((_SPELLING,), seen={_SPELLING}) == []


def _compare(provider: dict[str, object], python: dict[str, object]) -> _Collector:
    out = _Collector()
    rules = _Rules({}, (_SPELLING,))
    _compare_key(("4569682",), ([provider], [python]), columns=("id", "name", "team"), rules=rules, out=out)
    return out


def test_the_row_comparison_clears_the_declared_difference_and_fails_any_other() -> None:
    oracle: dict[str, object] = {"id": "4569682", "name": "Audric Estime", "team": "DEN"}
    both = _compare(oracle, {**oracle, "name": "Audric Estimé", "team": "KC"})
    assert both.departed == {_SPELLING}
    assert both.differing == ["('4569682',) team: ts='DEN' py='KC'"]
    only_declared = _compare(oracle, {**oracle, "name": "Audric Estimé"})
    assert (only_declared.departed, only_declared.differing) == ({_SPELLING}, [])
    neither = _compare(oracle, oracle)
    assert (neither.departed, neither.differing) == (set(), [])
    assert unmatched_departures((_SPELLING,), neither.departed) != []


def test_a_departure_scoped_to_a_pass_is_declared_in_that_pass_alone() -> None:
    """Lane 116: a departure only a later release makes (a moved game retired) is declared in `later` alone,
    so the first passes, which hold no moved game, do not fail it as one that never appeared."""
    moved = Departure(("20270109_SEA@LAR",), "superseded_by", None, "20270110_SEA@LAR", "retired", passes=("later",))
    spec = TableSpec("provider_games", ("game_id",), departures=(_SPELLING, moved))
    assert spec.in_pass("first").departures == (_SPELLING,)
    assert spec.in_pass("later").departures == (_SPELLING, moved)
