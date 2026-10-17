"""THE ADMITTED PAIRS: every (source, metric) a round 4 read may select, by read kind, as code.

The round 4 preregistration, section 5 ("each admitted by an explicit list of (source, metric)
pairs, never by source alone and never by a stamp window") and amendment 1 item 3. A table read is
a list of (table, column) pairs, an observation read a list of (source, metric) pairs. Every read
of the feature store goes through `admit_read`: a pair outside its kind's list is refused with
`InputRuleError` before the stamp rule of round 3's wrapper (`weekly3.ledger.admit`) is applied, so
a week-W `game_result` or `points_allowed` row can reach no feature by any read kind (item 5).

Item by item:

1. filings: (`nflverse_injuries`, `injury_report_status`), week W at t_g;
2. the game's figures: (`nflverse_kickoff`, `implied_team_total`) and (`nflverse_kickoff`,
   `point_spread`) for week W stamped at the kickoff (`figures`). Live (`live_figures`): the
   `tank01_lines` figures at or before t_g, and the game table's weekly read
   (`nflverse_game_figures`), the default of section 2.10 when the capture is stale;
3. the recorded weather and roof: (`game_weather`, `temperature_f`, `wind_mph`, `precipitation`,
   `roof`) and the row's source columns, week W, admitted at t_g by name (`weather`). Live
   (`forecast`): `nws_forecast` at or before t_g;
4. schedule knowledge (`schedule`): the kickoff, home field, rest days, division game and indoors
   rows of week W, the `stadiums` row, and the game rows' pairing columns where the play-by-play
   pairing has none (a game still to be played), and the game's surface (`nflverse_games`,
   `surface`) by name (amendment 2 item 1);
5. no other (`nflverse_kickoff`, metric) pair of week W: `game_result` and `points_allowed` are in
   no list;
6. the depth chart (`depth`, or `depth_prior` on the check's fallback): `nflverse_depth_chart_weeks`;
7. play rows of earlier weeks (`plays`): `nflverse_pbp_plays`; the play-by-play club rows and the
   box-score rows of earlier weeks (`box`), round 3's;
8. NGS and PFR rows of earlier weeks (`charted`), admitted at the Wednesday 18:00 ET pass after
   their week.
"""

from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from types import MappingProxyType
from typing import Final, Protocol

from research.model.weekly3.ledger import InputRuleError, ReadKind, Stamp, Stamped, admit
from research.model.weekly3.snapshot import TEAM_METRICS
from research.model.weekly3.work import USAGE_ROWS
from research.model.weekly4.features.plays import PLAY_COLUMNS
from research.pipeline.game_figures import FigureMetric
from research.pipeline.nflverse.games import GAME_FIGURES_SOURCE
from research.pipeline.nflverse.injury_reports import INJURY_SOURCE, InjuryMetric
from research.pipeline.nflverse.ngs import NGS_SOURCE
from research.pipeline.nflverse.pbp import PBP_SOURCE, PbpMetric
from research.pipeline.nflverse.pfr_advstats import PFR_SOURCE
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource
from research.pipeline.nws.forecast import FORECAST_SOURCE, ForecastMetric
from research.pipeline.tank01.lines import LINES_SOURCE

Pair = tuple[str, str]

GAME_WEATHER: Final = "game_weather"
DEPTH_CHARTS: Final = "nflverse_depth_chart_weeks"
PLAYS: Final = "nflverse_pbp_plays"
STADIUMS: Final = "stadiums"
CLUB_EDGES: Final = "player_week_teams"

FIGURE_METRICS: Final = (ScheduleMetric.IMPLIED_TEAM_TOTAL, ScheduleMetric.POINT_SPREAD)
LIVE_FIGURE_METRICS: Final = (FigureMetric.IMPLIED_TEAM_TOTAL, FigureMetric.POINT_SPREAD, FigureMetric.GAME_TOTAL)
LIVE_FIGURE_SOURCES: Final = (LINES_SOURCE, GAME_FIGURES_SOURCE)
WEATHER_COLUMNS: Final = ("temperature_f", "wind_mph", "precipitation", "roof")
WEATHER_SOURCE_COLUMNS: Final = (
    "temperature_source",
    "wind_source",
    "precipitation_source",
    "precipitation_kind",
    "precipitation_mm",
    "isd_station",
    "isd_distance_km",
    "isd_precipitation",
    "isd_precipitation_station",
)
WEATHER_KEY_COLUMNS: Final = (
    "game_id",
    "season",
    "week",
    "home_team",
    "away_team",
    "stadium_id",
    "kickoff_at",
    "as_of",
)
FORECAST_METRICS: Final = (
    ForecastMetric.TEMPERATURE,
    ForecastMetric.WIND,
    ForecastMetric.PRECIPITATION_PROBABILITY,
    ForecastMetric.ISSUED_AT,
)
SCHEDULE_METRICS: Final = (ScheduleMetric.REST_DAYS, ScheduleMetric.DIVISION_GAME, ScheduleMetric.INDOORS)
STADIUM_COLUMNS: Final = ("stadium_id", "roof_type", "international", "surface", "read_at")
# Amendment 2 item 1: the game's surface by name, schedule knowledge (never a figure's source).
GAMES: Final = "nflverse_games"
GAME_SURFACE_COLUMNS: Final = ("game_id", "season", "week", "surface")
# The game rows' pairing columns: who plays whom each week, the pairing's own four columns (item 4),
# read where the play-by-play pairing has no row yet (a game still to be played).
GAME_PAIRING_COLUMNS: Final = ("season", "week", "home_team", "away_team")
DEPTH_COLUMNS: Final = ("season", "week", "team", "slot", "depth_order", "player_id", "as_of", "position")
NGS_METRICS: Final = (
    "rush_attempts",
    "rush_yards_over_expected_per_att",
    "rec_targets",
    "rec_avg_separation",
    "pass_attempts",
    "pass_completion_pct_above_expectation",
    "pass_avg_time_to_throw",
)
# Amendment 2 item 7: live, the filing is Tank01's word from lane 63's status rows, by the universe
# player its provider id is crosswalked to, read at the capture's last check of its feed.
LIVE_FILING_PAIRS: Final = frozenset(
    {
        ("published_boards", "player_id"),
        ("published_boards", "status"),
        ("published_boards", "status_source"),
        ("player_crosswalk", "player_id"),
        ("capture_checks", "checked_at"),
    }
)
PRESSURED_METRIC: Final = "times_pressured"
PFR_METRICS: Final = ("receiving_broken_tackles", "rushing_broken_tackles", PRESSURED_METRIC)
# Round 3's club rows (`snapshot.TEAM_METRICS`) and the pass rate over expectation round 4 adds (2.4).
BOX_TEAM_METRICS: Final = (*TEAM_METRICS, PbpMetric.PASS_RATE_OVER_EXPECTED)

_EXPLICIT_REFUSALS: Final = frozenset(
    {(ScheduleSource.KICKOFF, ScheduleMetric.GAME_RESULT), (ScheduleSource.KICKOFF, ScheduleMetric.POINTS_ALLOWED)}
)


def _pairs(source: str, names: Iterable[str]) -> frozenset[Pair]:
    return frozenset((source, name) for name in names)


ADMITTED: Final[Mapping[ReadKind, frozenset[Pair]]] = MappingProxyType(
    {
        "filings": frozenset({(INJURY_SOURCE, InjuryMetric.REPORT_STATUS)}) | LIVE_FILING_PAIRS,
        "figures": _pairs(ScheduleSource.KICKOFF, FIGURE_METRICS),
        "live_figures": frozenset(p for s in LIVE_FIGURE_SOURCES for p in _pairs(s, LIVE_FIGURE_METRICS)),
        "weather": _pairs(GAME_WEATHER, (*WEATHER_KEY_COLUMNS, *WEATHER_COLUMNS, *WEATHER_SOURCE_COLUMNS)),
        "forecast": _pairs(FORECAST_SOURCE, FORECAST_METRICS),
        "schedule": _pairs(ScheduleSource.SCHEDULE, SCHEDULE_METRICS)
        | _pairs(STADIUMS, STADIUM_COLUMNS)
        | _pairs(GAME_WEATHER, GAME_PAIRING_COLUMNS)
        | _pairs(GAMES, GAME_SURFACE_COLUMNS)
        | {(ScheduleSource.KICKOFF, ScheduleMetric.KICKOFF_INSTANT)},
        "depth": _pairs(DEPTH_CHARTS, DEPTH_COLUMNS),
        "depth_prior": _pairs(DEPTH_CHARTS, DEPTH_COLUMNS),
        "plays": _pairs(PLAYS, PLAY_COLUMNS),
        "charted": _pairs(NGS_SOURCE, NGS_METRICS) | _pairs(PFR_SOURCE, PFR_METRICS),
        "box": frozenset(USAGE_ROWS)
        | _pairs(PBP_SOURCE, BOX_TEAM_METRICS)
        | {(CLUB_EDGES, "team"), (INJURY_SOURCE, InjuryMetric.REPORT_STATUS)},
        "prior": frozenset(USAGE_ROWS) | {(CLUB_EDGES, "team")} | _pairs(PLAYS, PLAY_COLUMNS),
    }
)


def _refuse_outcome_pairs() -> None:
    """Item 5, held at import: no read kind's list admits a week-W outcome pair."""
    for kind, pairs in ADMITTED.items():
        if _EXPLICIT_REFUSALS & pairs:
            raise InputRuleError(f"item 5: the {kind} list admits {sorted(_EXPLICIT_REFUSALS & pairs)}")


_refuse_outcome_pairs()


class SourcedRow(Stamped, Protocol):
    """An observation row: its stamp, and the (source, metric) it carries."""

    @property
    def source(self) -> str: ...
    @property
    def metric(self) -> str: ...


def refused_pairs(kind: ReadKind, pairs: Iterable[Pair]) -> list[Pair]:
    allowed = ADMITTED.get(kind)
    if allowed is None:
        raise InputRuleError(f"no admitted pairs are written for the read kind {kind!r}")
    return sorted(set(pairs) - allowed)


def admit_read(  # noqa: PLR0913, PLR0917 - a read's every coordinate, named
    kind: ReadKind, pairs: Iterable[Pair], rows: Sequence[Stamped], season: int, week: int, moment: datetime
) -> Stamp:
    """The read's stamp: refused when it selected a pair outside its kind's list, else by round 3's rule."""
    outside = refused_pairs(kind, pairs)
    if outside:
        raise InputRuleError(f"the allow-list refuses {outside} in a {kind} read of {season} week {week}")
    return admit(rows, season, week, moment, kind)


def admit_observations(kind: ReadKind, rows: Sequence[SourcedRow], season: int, week: int, moment: datetime) -> Stamp:
    """An observation read: its pairs are the rows' own (source, metric)."""
    return admit_read(kind, ((r.source, r.metric) for r in rows), rows, season, week, moment)
