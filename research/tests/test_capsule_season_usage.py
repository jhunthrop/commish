"""This season's usage and play on the writer's sheet: floors, team shares and their rank pools,
weighted averages, the FTN switch, absent-never-zero, and every printed number on the ledger."""

from collections.abc import Mapping
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

from research.capsules.facts.model import SeasonFigure, SeasonUsage
from research.capsules.facts.season_usage import Figure, SeasonInputs, Week, metric_key, season_usage_for
from research.capsules.facts.season_usage_ledger import usage_names, usage_numbers
from research.capsules.grounding import extract_numbers, is_derived_from_ledger
from research.capsules.render import label_sections
from research.capsules.render_usage import season_usage_section
from research.capsules.voice_rules import EM_DASH, SEMICOLON
from research.model.domain import Position
from research.pipeline.nflverse.ftn import FTN_SOURCE, FtnMetric
from research.pipeline.nflverse.ngs import NGS_SOURCE
from research.pipeline.nflverse.pbp import PBP_PLAYER_SOURCE, PbpPlayerMetric

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

_RZ_CARRIES = metric_key(PBP_PLAYER_SOURCE, PbpPlayerMetric.RED_ZONE_CARRIES)
_RZ_TARGETS = metric_key(PBP_PLAYER_SOURCE, PbpPlayerMetric.RED_ZONE_TARGETS)
_CARRIES = metric_key(PBP_PLAYER_SOURCE, PbpPlayerMetric.CARRIES)
_TARGETS = metric_key(PBP_PLAYER_SOURCE, PbpPlayerMetric.TARGETS)
_SEPARATION = metric_key(NGS_SOURCE, "rec_avg_separation")
_NGS_TARGETS = metric_key(NGS_SOURCE, "rec_targets")


def _rb_week(week: int, carries: float, red_zone: float, team_red_zone: float) -> Week:
    own = {_CARRIES: carries, _TARGETS: 0.0, _RZ_CARRIES: red_zone, _RZ_TARGETS: 0.0}
    return Week(week, own, {_RZ_CARRIES: team_red_zone, _RZ_TARGETS: 0.0})


def _inputs(weeks: dict[str, list[Week]], positions: dict[str, Position]) -> SeasonInputs:
    names = {pid: f"Player {pid}" for pid in positions}
    return SeasonInputs(2026, 1, 3, weeks, positions, names)


def _figure(usage: Mapping[str, SeasonUsage], player: str, key: str) -> SeasonFigure | None:
    held = usage.get(player)
    return None if held is None else next((f for f in held.figures if f.key == key), None)


def test_a_team_share_is_his_count_over_his_clubs_in_his_games_ranked_among_real_roles() -> None:
    weeks = {
        "starter": [_rb_week(1, 18, 4, 6), _rb_week(2, 20, 3, 5)],
        "backup": [_rb_week(1, 3, 1, 6), _rb_week(2, 2, 1, 5)],
        "other": [_rb_week(1, 15, 2, 8), _rb_week(2, 16, 2, 6)],
    }
    usage = season_usage_for(_inputs(weeks, dict.fromkeys(weeks, "RB")), ftn_on=False)
    starter = _figure(usage, "starter", Figure.RED_ZONE_SHARE)
    assert starter is not None
    assert (starter.value, starter.count, starter.out_of, starter.weeks) == (7 / 11, 7, 11, (1, 2))
    assert starter.rank is not None and (starter.rank.position_rank, starter.rank.qualifier_count) == (1, 2)
    backup = _figure(usage, "backup", Figure.RED_ZONE_SHARE)
    assert backup is not None and backup.rank is None, "five carries of his own is no role to rank"


def test_under_its_floor_a_figure_is_absent_and_a_player_with_none_is_absent() -> None:
    weeks = {"cameo": [_rb_week(1, 4, 1, 4)]}
    assert season_usage_for(_inputs(weeks, {"cameo": "RB"}), ftn_on=False) == {}


def test_an_average_is_weighted_by_the_count_it_was_taken_over() -> None:
    def week(n: int, separation: float, targets: float) -> Week:
        return Week(n, {_SEPARATION: separation, _NGS_TARGETS: targets}, {})

    weeks = {"wr": [week(1, 4.0, 2), week(2, 2.0, 14), week(3, 3.0, 4)]}
    usage = season_usage_for(_inputs(weeks, {"wr": "WR"}), ftn_on=False)
    separation = _figure(usage, "wr", Figure.SEPARATION)
    assert separation is not None
    assert separation.value == (4.0 * 2 + 2.0 * 14 + 3.0 * 4) / 20
    assert (separation.count, separation.out_of) == (None, 20)


def test_a_week_a_feed_has_no_row_for_is_left_out_never_read_as_zero() -> None:
    def week(n: int, separation: float | None) -> Week:
        own = {_NGS_TARGETS: 8.0} if separation is None else {_SEPARATION: separation, _NGS_TARGETS: 8.0}
        return Week(n, own, {})

    weeks = {"wr": [week(1, 3.0), week(2, None), week(3, 2.0)]}
    separation = _figure(season_usage_for(_inputs(weeks, {"wr": "WR"}), ftn_on=False), "wr", Figure.SEPARATION)
    assert separation is not None
    assert (separation.value, separation.weeks) == (2.5, (1, 3))


def test_ftn_charting_reaches_the_sheet_only_when_switched_on() -> None:
    def week(n: int) -> Week:
        own = {
            metric_key(FTN_SOURCE, FtnMetric.CONTESTED_CATCHES): 2.0,
            metric_key(FTN_SOURCE, FtnMetric.CONTESTED_TARGETS): 4.0,
        }
        return Week(n, own, {})

    weeks = {"wr": [week(1), week(2)]}
    assert season_usage_for(_inputs(weeks, {"wr": "WR"}), ftn_on=False) == {}
    on = season_usage_for(_inputs(weeks, {"wr": "WR"}), ftn_on=True)
    contested = _figure(on, "wr", Figure.CONTESTED_CATCH_RATE)
    assert contested is not None
    assert (contested.value, contested.count, contested.out_of) == (0.5, 4, 8)


def _sheet(usage: object, position: Position = "RB") -> "PlayerFacts":
    return cast(
        "PlayerFacts",
        SimpleNamespace(
            season_usage=usage,
            identity=SimpleNamespace(position=position),
            evidence=(),
            last_season_story=None,
            usage=None,
            trend=None,
        ),
    )


def test_every_number_the_section_prints_is_on_the_ledger_and_the_copy_rules_hold() -> None:
    weeks = {
        "starter": [_rb_week(1, 18, 4, 6), _rb_week(2, 20, 3, 5), Week(3, {_CARRIES: 22.0}, {})],
        "other": [_rb_week(1, 15, 2, 8), _rb_week(2, 16, 2, 6)],
    }
    usage = season_usage_for(_inputs(weeks, dict.fromkeys(weeks, "RB")), ftn_on=False)["starter"]
    section = season_usage_section(_sheet(usage))
    assert section is not None
    assert section.startswith("This season's usage and play (weeks 1 to 3 of 2026):")
    assert "weeks 1 and 2 of 2026 only" in section, "a figure over fewer weeks than his names them"
    assert "RB1 among 2 running backs with 20 or more carries and targets of their own" in section
    ledger = usage_numbers(usage)
    for raw, value in extract_numbers(section):
        assert is_derived_from_ledger(value, ledger), raw
    assert EM_DASH not in section and SEMICOLON not in section
    assert usage_names(usage) == []


def test_the_section_is_a_labelled_stat_the_span_gate_exempts() -> None:
    weeks = {"starter": [_rb_week(1, 18, 4, 6), _rb_week(2, 20, 3, 5)]}
    usage = season_usage_for(_inputs(weeks, {"starter": "RB"}), ftn_on=False)["starter"]
    assert any(section.startswith("This season's usage and play") for section in label_sections(_sheet(usage)))
    assert label_sections(_sheet(None)) == []
