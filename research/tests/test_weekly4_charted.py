"""Round 4's charted features (preregistration section 5 item 8, amendment 1 note 5): NGS and PFR
rows admitted at the Wednesday 18:00 New York pass after their week, whatever the stored stamp, and
the season-to-date features weighted as the feeds weight them, missing with their indicators."""

import math
from datetime import UTC, datetime

import pytest

from research.model.weekly4.features.charted import (
    PFR_BROKEN_TACKLES,
    PFR_PRESSURED,
    charted_features,
    missing_indicator,
    restamp,
    wednesday_pass_after,
)
from research.model.weekly4.features.plays import Counts, PlayerTally
from research.pipeline.observations import PlayerWeekObservation

_STORED = datetime(2024, 10, 1, tzinfo=UTC)


def _row(week: int, metric: str, value: float) -> PlayerWeekObservation:
    return PlayerWeekObservation(2024, week, "p", "nflverse_ngs", metric, value, _STORED)


def test_the_wednesday_pass_after_a_monday_game_and_after_a_christmas_wednesday_game() -> None:
    monday_night = datetime(2024, 10, 1, 0, 15, tzinfo=UTC)  # Monday 20:15 New York
    assert wednesday_pass_after(monday_night) == datetime(2024, 10, 2, 22, 0, tzinfo=UTC)
    christmas = datetime(2024, 12, 25, 21, 30, tzinfo=UTC)  # Wednesday 16:30 New York, over 20:30
    assert wednesday_pass_after(christmas) == datetime(2025, 1, 1, 23, 0, tzinfo=UTC)


def test_rows_are_restamped_at_their_weeks_pass() -> None:
    passes = {5: datetime(2024, 10, 9, 22, tzinfo=UTC)}
    assert [r.as_of for r in restamp([_row(5, "rec_targets", 6.0)], passes)] == [passes[5]]


def test_season_to_date_features_are_weighted_and_missing_ones_flagged() -> None:
    rows = [
        _row(4, "rec_avg_separation", 3.0),
        _row(4, "rec_targets", 10.0),
        _row(5, "rec_avg_separation", 2.0),
        _row(5, "rec_targets", 5.0),
        _row(5, "receiving_broken_tackles", 2.0),
    ]
    tallies = {4: PlayerTally("KC", Counts(targets=10.0), receptions=7.0), 5: PlayerTally("KC", receptions=4.0)}
    found, missing = charted_features(rows, tallies)
    assert found["ngs_average_separation"] == pytest.approx((30.0 + 10.0) / 15.0)
    assert found[PFR_BROKEN_TACKLES] == pytest.approx(2.0 / 4.0)
    assert math.isnan(found[PFR_PRESSURED]) and missing_indicator(PFR_PRESSURED) in missing
    assert missing_indicator("ngs_average_separation") not in missing
