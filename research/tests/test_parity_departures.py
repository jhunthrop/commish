"""A departure from the oracle is declared, never hidden (Lane 78): one key, one column, both values and
why. The declared difference matches; any other difference still fails, and a declared one that no
longer appears fails too, so the declaration cannot outlive the departure."""

from research.parity.diff import Departure, declared, unmatched_departures

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
