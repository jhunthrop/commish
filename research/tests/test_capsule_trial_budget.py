"""The paid trial's call budget (`capsules.trial.within_calls`, `write --budget`): a hard stop that never
starts a player whose worst case would cross it."""

import pytest

from research.capsules.__main__ import main
from research.capsules.config import CAPSULE_CONFIG
from research.capsules.trial import within_calls

WORST = CAPSULE_CONFIG.max_gateway_calls_per_player
# argparse's exit status for a malformed argument.
ARGPARSE_USAGE_ERROR = 2


def _run(calls: list[int], budget: int | None) -> tuple[list[int], list[int]]:
    """Writes subjects 0..n-1, subject i spending calls[i]; returns (done, unstarted) by index."""
    return within_calls(list(range(len(calls))), lambda i: i, lambda i: calls[i], budget)


def test_no_budget_writes_every_player() -> None:
    assert _run([6, 6, 6], None) == ([0, 1, 2], [])


def test_a_player_starts_only_when_his_worst_case_fits() -> None:
    # Two worst cases fit exactly; the third would cross, so it is never started.
    assert _run([WORST, WORST, WORST], 2 * WORST) == ([0, 1], [2])
    # Cheap pages leave room: 2 + 2 spent, and 4 + the worst case still fits in 4 + WORST.
    assert _run([2, 2, 2], 4 + WORST) == ([0, 1, 2], [])
    # Even when actual spend would have fitted, a start whose worst case crosses is refused.
    assert _run([1, 1], WORST) == ([0], [1])


def test_a_budget_below_one_worst_case_starts_nobody() -> None:
    assert _run([1, 1], WORST - 1) == ([], [0, 1])


def test_the_write_command_takes_a_budget() -> None:
    with pytest.raises(SystemExit) as exit_:
        main(["write", "--budget", "not-a-number"])
    assert exit_.value.code == ARGPARSE_USAGE_ERROR
