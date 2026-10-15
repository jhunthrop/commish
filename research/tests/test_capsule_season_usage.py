"""This season's usage and play on the writer's sheet: floors, team shares and their rank pools,
weighted averages, the FTN switch, absent-never-zero, and every printed number on the ledger."""

from collections.abc import Mapping
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

from research.capsules.config import CAPSULE_CONFIG
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
from research.pipeline.nflverse.pbp_passers import PBP_PASSER_SOURCE, PasserMetric
from research.pipeline.nflverse.pfr_advstats import PFR_SOURCE

_ON = CAPSULE_CONFIG.sources_on_pages

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
    usage = season_usage_for(_inputs(weeks, dict.fromkeys(weeks, "RB")), on_pages=_ON)
    starter = _figure(usage, "starter", Figure.RED_ZONE_SHARE)
    assert starter is not None
    assert (starter.value, starter.count, starter.out_of, starter.weeks) == (7 / 11, 7, 11, (1, 2))
    assert starter.rank is not None and (starter.rank.position_rank, starter.rank.qualifier_count) == (1, 2)
    backup = _figure(usage, "backup", Figure.RED_ZONE_SHARE)
    assert backup is None, "five carries of his own is no role: no share printed at all"


def test_under_its_floor_a_figure_is_absent_and_a_player_with_none_is_absent() -> None:
    weeks = {"cameo": [_rb_week(1, 4, 1, 4)]}
    assert season_usage_for(_inputs(weeks, {"cameo": "RB"}), on_pages=_ON) == {}


def test_an_average_is_weighted_by_the_count_it_was_taken_over() -> None:
    def week(n: int, separation: float, targets: float) -> Week:
        return Week(n, {_SEPARATION: separation, _NGS_TARGETS: targets}, {})

    weeks = {"wr": [week(1, 4.0, 2), week(2, 2.0, 14), week(3, 3.0, 4)]}
    usage = season_usage_for(_inputs(weeks, {"wr": "WR"}), on_pages=_ON)
    separation = _figure(usage, "wr", Figure.SEPARATION)
    assert separation is not None
    assert separation.value == (4.0 * 2 + 2.0 * 14 + 3.0 * 4) / 20
    assert (separation.count, separation.out_of) == (None, 20)


def test_a_week_a_feed_has_no_row_for_is_left_out_never_read_as_zero() -> None:
    def week(n: int, separation: float | None) -> Week:
        own = {_NGS_TARGETS: 8.0} if separation is None else {_SEPARATION: separation, _NGS_TARGETS: 8.0}
        return Week(n, own, {})

    weeks = {"wr": [week(1, 3.0), week(2, None), week(3, 2.0)]}
    separation = _figure(season_usage_for(_inputs(weeks, {"wr": "WR"}), on_pages=_ON), "wr", Figure.SEPARATION)
    assert separation is not None
    assert (separation.value, separation.weeks) == (2.5, (1, 3))


_AIR = metric_key(PBP_PLAYER_SOURCE, PbpPlayerMetric.AIR_YARDS)


def test_a_negative_air_yards_share_is_left_off() -> None:
    def week(n: int, own_air: float) -> Week:
        return Week(n, {_CARRIES: 0.0, _TARGETS: 12.0, _AIR: own_air}, {_AIR: 200.0})

    screens = season_usage_for(_inputs({"wr": [week(1, -6.0), week(2, -4.0)]}, {"wr": "WR"}), on_pages=_ON)
    assert _figure(screens, "wr", Figure.AIR_YARDS_SHARE) is None
    deep = season_usage_for(_inputs({"wr": [week(1, 90.0), week(2, 60.0)]}, {"wr": "WR"}), on_pages=_ON)
    assert _figure(deep, "wr", Figure.AIR_YARDS_SHARE) is not None


def test_a_role_figure_is_ranked_without_best_at_the_position() -> None:
    def week(n: int) -> Week:
        own = {_AIR: 150.0, metric_key(PBP_PLAYER_SOURCE, PbpPlayerMetric.AIR_YARD_TARGETS): 10.0}
        return Week(n, own, {})

    usage = season_usage_for(_inputs({"wr": [week(1), week(2)]}, {"wr": "WR"}), on_pages=_ON)["wr"]
    section = season_usage_section(_sheet(usage, "WR"))
    assert section is not None
    assert "WR1 among 1 receivers with 15 or more targets." in section
    assert "best at the position" not in section


def test_each_source_is_its_own_licence_gate() -> None:
    def week(n: int) -> Week:
        return Week(n, {_SEPARATION: 3.0, _NGS_TARGETS: 10.0}, {})

    weeks = {"wr": [week(1), week(2)]}
    assert season_usage_for(_inputs(weeks, {"wr": "WR"}), on_pages=_ON - {NGS_SOURCE}) == {}
    assert _figure(season_usage_for(_inputs(weeks, {"wr": "WR"}), on_pages=_ON), "wr", Figure.SEPARATION)
    # FTN's charting is on pages from Lane 41, its credit on the site's `/data` page.
    assert FTN_SOURCE in CAPSULE_CONFIG.sources_on_pages


def test_ftn_charting_reaches_the_sheet_only_when_switched_on() -> None:
    def week(n: int) -> Week:
        own = {
            metric_key(FTN_SOURCE, FtnMetric.CONTESTED_CATCHES): 2.0,
            metric_key(FTN_SOURCE, FtnMetric.CONTESTED_TARGETS): 4.0,
        }
        return Week(n, own, {})

    weeks = {"wr": [week(1), week(2)]}
    assert season_usage_for(_inputs(weeks, {"wr": "WR"}), on_pages=_ON - {FTN_SOURCE}) == {}
    on = season_usage_for(_inputs(weeks, {"wr": "WR"}), on_pages=_ON)
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
    usage = season_usage_for(_inputs(weeks, dict.fromkeys(weeks, "RB")), on_pages=_ON)["starter"]
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
    usage = season_usage_for(_inputs(weeks, {"starter": "RB"}), on_pages=_ON)["starter"]
    assert any(section.startswith("This season's usage and play") for section in label_sections(_sheet(usage)))
    assert label_sections(_sheet(None)) == []


def test_a_sheet_carries_at_most_four_figures_the_most_telling_first() -> None:
    own = {
        _CARRIES: 10.0, _TARGETS: 10.0, _RZ_CARRIES: 1.0, _RZ_TARGETS: 2.0, _AIR: 120.0,
        metric_key(PBP_PLAYER_SOURCE, PbpPlayerMetric.AIR_YARD_TARGETS): 10.0,
        metric_key(PBP_PLAYER_SOURCE, PbpPlayerMetric.INSIDE_TEN_CARRIES): 1.0,
        metric_key(PBP_PLAYER_SOURCE, PbpPlayerMetric.INSIDE_TEN_TARGETS): 2.0,
        _SEPARATION: 3.0, _NGS_TARGETS: 10.0,
    }  # fmt: skip
    team = {_RZ_CARRIES: 6.0, _RZ_TARGETS: 6.0, _AIR: 300.0}
    team |= {k: 4.0 for k in own if "inside_ten" in k}
    weeks = {"wr": [Week(1, own, team), Week(2, own, team)]}
    usage = season_usage_for(_inputs(weeks, {"wr": "WR"}), on_pages=_ON)["wr"]
    assert [f.key for f in usage.figures] == [
        Figure.RED_ZONE_SHARE, Figure.AIR_YARDS_SHARE, Figure.SEPARATION, Figure.INSIDE_TEN_SHARE,
    ]  # fmt: skip


def test_ftn_figures_sit_inside_the_four_figure_cap_never_a_fifth() -> None:
    """A passer with every figure: the cap keeps the NFL's and PFR's three, then FTN's blitz rate, and
    leaves interception-worthy throws off (Lane 41: FTN joins inside the priority order)."""
    own = {
        metric_key(PFR_SOURCE, "times_pressured"): 12.0,
        metric_key(PBP_PASSER_SOURCE, PasserMetric.DROPBACKS): 40.0,
        metric_key(NGS_SOURCE, "pass_avg_time_to_throw"): 2.8,
        metric_key(NGS_SOURCE, "pass_completion_pct_above_expectation"): 1.5,
        metric_key(NGS_SOURCE, "pass_attempts"): 35.0,
        metric_key(FTN_SOURCE, FtnMetric.BLITZED_DROPBACKS): 12.0,
        metric_key(FTN_SOURCE, FtnMetric.DROPBACKS): 40.0,
        metric_key(FTN_SOURCE, FtnMetric.INTERCEPTION_WORTHY_THROWS): 1.0,
        metric_key(FTN_SOURCE, FtnMetric.PASS_ATTEMPTS): 35.0,
    }
    weeks = {"qb": [Week(1, own, {}), Week(2, own, {})]}
    usage = season_usage_for(_inputs(weeks, {"qb": "QB"}), on_pages=_ON)["qb"]
    assert [f.key for f in usage.figures] == [
        Figure.PRESSURE_RATE, Figure.COMPLETION_OVER_EXPECTED, Figure.TIME_TO_THROW, Figure.BLITZ_RATE,
    ]  # fmt: skip
