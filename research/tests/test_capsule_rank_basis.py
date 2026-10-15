"""A usage rank cut to "RB31 of 36" loses who it is among: the validator asks for the basis back, and
the board-rank rule no longer reads it as a board rank (the Lane 23 review's M2)."""

from research.capsules.board_ranks import rank_claims_off_page
from research.capsules.rank_basis import rank_basis_violation, ranks_without_basis

_TRIAL = (
    "Thirteen points a game through five weeks from a guy we had at RB5, and the reason is on the tape: "
    "minus 0.4 yards a carry over expected, RB31 of 36, and 1.3 yards after contact, RB49 of 53."
)


def test_a_usage_rank_cut_to_of_n_is_a_violation_that_asks_for_its_basis() -> None:
    assert ranks_without_basis(_TRIAL, "RB", 5) == ["RB31 of 36", "RB49 of 53"]
    assert "without who it ranks among" in rank_basis_violation("RB31 of 36")


def test_a_rank_with_its_basis_or_his_page_rank_is_not() -> None:
    assert ranks_without_basis("RB31 among 36 running backs with 25 or more tracked carries", "RB", 5) == []
    assert ranks_without_basis("He sits at RB5 of our board's backs, and WR3 of 40 is not his position.", "RB", 5) == []


def test_an_of_n_usage_rank_is_not_read_as_a_board_rank() -> None:
    assert rank_claims_off_page(_TRIAL, "RB", 5, 20) == []
    assert rank_claims_off_page("We have him at RB9 now.", "RB", 5, 20) == ["RB9"]
