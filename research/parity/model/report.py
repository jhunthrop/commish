"""THE MODEL CASES' REPORT: one line per comparison, the notes, and the one-line verdict."""

import sys
from collections.abc import Sequence

from research.parity.model.outcome import CaseResult


def _line(text: str = "") -> None:
    sys.stdout.write(text + "\n")


def report_model(results: Sequence[CaseResult]) -> None:
    _line(f"{'case':<24} {'comparison':<62} {'left':>7} {'right':>7} {'diff':>6} {'worst':>9}  result")
    _line("-" * 128)
    compared = 0
    differing = 0
    for result in results:
        for diff in result.diffs:
            compared += max(diff.left_rows, diff.right_rows)
            differing += diff.differing + len(diff.only_left) + len(diff.only_right)
            verdict = "match" if diff.matches else "DIFFERENT"
            _line(
                f"{result.name:<24} {diff.what[:62]:<62} {diff.left_rows:>7} {diff.right_rows:>7} "
                f"{diff.differing + len(diff.only_left) + len(diff.only_right):>6} {diff.worst:>9.4f}  {verdict}"
            )
            for example in diff.examples:
                _line(f"{'':<24}   {example}")
        for claim in result.claims:
            _line(f"{result.name:<24} claim: {claim.what}: {'holds' if claim.holds else 'DOES NOT HOLD'}")
        for note in result.notes:
            _line(f"{result.name:<24} note: {note}")
        if not result.refusals_agree:
            _line(f"{result.name:<24} REFUSALS DISAGREE")
    matching = sum(1 for result in results if result.matches)
    _line(
        f"model parity: {len(results)} case(s), {matching} matching; {compared} rows compared; {differing} differences"
    )
