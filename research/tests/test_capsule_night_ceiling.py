"""The night's call ceiling (the coordinator's Lane 17 ruling): a page at the ceiling is left to the
next night, except that a page still unwritten may start one more generation that night, once."""

from research.nightly.capsule_step import NIGHT_CALLS_PER_PLAYER, spent_out_for

CALLS = {"fresh": 4, "at_ceiling": NIGHT_CALLS_PER_PLAYER, "graced": NIGHT_CALLS_PER_PLAYER + 6}


def test_a_page_at_the_ceiling_is_left_to_the_next_night() -> None:
    assert spent_out_for(CALLS, frozenset(), unwritten_only=False) == {"at_ceiling", "graced"}


def test_an_unwritten_page_at_the_ceiling_may_start_one_more_generation_once() -> None:
    assert spent_out_for(CALLS, frozenset(), unwritten_only=True) == frozenset()
    assert spent_out_for(CALLS, frozenset({"graced"}), unwritten_only=True) == {"graced"}
