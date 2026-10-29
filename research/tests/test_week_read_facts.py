"""Lane 299 (the founder, 2026-10-29: "they need to be accurate"): each class the live week 8 audit found wrong at
write time, closed with a test built from the real failing sentence.

- His place on the depth chart: the sheet had read the week-one chart (`week.depth`), and the validator now holds
  a place said of him to the sheet's (`fact_rules.place_violations`).
- A game's figure tied to the wrong week (`fact_rules.week_figure_violations`).
- The opponent's rank against his position: the sheet counted a line with no club edge under his board club,
  where the card's Opp rank (the API's `rankAllowed`) counts no such line (`collect.allowed_by_opponent`).
- The cadence writes a stored read again once tonight's sheet no longer bears out a fact it states
  (`cadence.FACT_STALE`).
"""

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import Any, cast

from research.capsules.sentences import split_sentences
from research.capsules.week.cadence import FACT_STALE, PRIORITY, RULE_STALE, STATUS_CHANGED, due_reason
from research.capsules.week.collect import allowed_by_opponent
from research.capsules.week.depth import charts_from_rows, weekly_place
from research.capsules.week.fact_rules import (
    fact_violations,
    place_violations,
    standing_violations,
    weather_violations,
    week_figure_violations,
)
from research.capsules.week.rules import week_rule_violations
from research.capsules.week.sheet import Allowed, DepthPlace, GameLine, Status, Weather, WeekSheet
from research.capsules.week.store import StoredWeekRead
from research.db.schema.boards import WEEK_READ_REASONS
from research.nightly.build.player_season import SeasonContext
from research.tests.week_read_fixtures import LINES, REPORT, WRITTEN_AT, starter

RELEASED = datetime(2026, 10, 27, 6, 1, tzinfo=UTC)
CHART_AT_THE_WRITE = WRITTEN_AT - timedelta(hours=20)


def _white(slot: float, around: tuple[tuple[str, float], ...]) -> WeekSheet:
    return replace(
        starter(),
        player_id="00-0036999",
        name="Rachaad White",
        position="RB",
        team="WSH",
        depth=DepthPlace(slot, around, CHART_AT_THE_WRITE),
        allowed=Allowed(16, 32, 21.2, "RB", 7, LINES),
        points_per_game=9.8,
    )


# Rachaad White's live read, written Wed Oct 28 12:31 am CT, when Washington's week 8 chart listed him first.
WHITE = (
    "Rachaad White's second job behind Jacory Croskey-Merritt in the Washington backfield fits a quiet week. "
    "Philadelphia sits 16th of 32 against running backs through week 7 of 2026, nothing special."
)


def _place(text: str, sheet: WeekSheet) -> list[str]:
    return place_violations(split_sentences(text), sheet)


def test_rachaad_whites_week_one_place_is_refused_against_this_weeks_chart() -> None:
    """The sheet had his week-one place (second, behind Croskey-Merritt); this week's chart lists him first."""
    now = _white(1.0, (("Jacory Croskey-Merritt", 2.0), ("Chris Rodriguez Jr.", 3.0)))
    found = _place(WHITE, now)
    assert len(found) == 1 and 'places him second on the depth chart ("Rachaad White\'s second job")' in found[0]
    assert "The facts list him first on this week's depth chart" in found[0]
    assert _place(WHITE, _white(2.0, (("Jacory Croskey-Merritt", 1.0),))) == []


def test_a_place_said_of_him_is_the_sheets_in_each_of_its_live_forms() -> None:
    """Live sentences, each read against the place the week 8 chart gave him at the write."""
    kmet = replace(_white(3.0, (("Colston Loveland", 1.0), ("Sam Roush", 2.0))), name="Cole Kmet", team="CHI")
    assert _place("He's second among the Bears' tight ends behind Colston Loveland anyway.", kmet)
    holani = replace(_white(3.0, (("Emanuel Wilson", 1.0), ("Zach Charbonnet", 2.0))), name="George Holani")
    assert _place("Seattle lists him second among its backs, behind Emanuel Wilson.", holani)
    assert _place("Seattle lists him third among its backs, behind Emanuel Wilson and Zach Charbonnet.", holani) == []
    # "running second behind Alec Pierce" (Josh Downs) is his place, and true.
    downs = replace(_white(2.0, (("Alec Pierce", 1.0),)), name="Josh Downs", position="WR", team="IND")
    assert (
        _place("Downs has no designation, so his spot running second behind Alec Pierce stands for Sunday.", downs)
        == []
    )
    assert _place("Downs has no designation, so his spot running third behind Alec Pierce stands for Sunday.", downs)


def test_a_teammate_named_ahead_of_him_is_one_the_sheet_lists_ahead() -> None:
    """J.J. McCarthy's live read put Jaxson Dart and Jameis Winston ahead of him; the week 8 chart listed him
    first."""
    mccarthy = replace(
        _white(1.0, (("Jaxson Dart", 2.0), ("Jameis Winston", 3.0))), name="J.J. McCarthy", position="QB", team="NYG"
    )
    text = "He's still behind Jaxson Dart and Jameis Winston on the depth chart, so there is no rush to bring him back."
    found = _place(text, mccarthy)
    assert len(found) == 1 and "puts Jaxson Dart, Jameis Winston ahead of him" in found[0]
    assert _place(text, replace(mccarthy, depth=DepthPlace(3.0, (("Jaxson Dart", 1.0), ("Jameis Winston", 2.0))))) == []


def test_a_teammates_place_is_never_read_as_his() -> None:
    """Jonnu Smith's live read: "Tucker Kraft sits first among Green Bay tight ends" is Kraft's place."""
    smith = replace(_white(2.0, (("Tucker Kraft", 1.0),)), name="Jonnu Smith", position="TE", team="GB")
    assert _place("Tucker Kraft sits first among Green Bay tight ends, so the targets don't reach him.", smith) == []


def test_with_no_place_on_the_sheet_the_read_states_none() -> None:
    """Jamari Thrash's live read placed him seventh among Las Vegas receivers; this week's chart lists him nowhere."""
    thrash = replace(_white(7.0, ()), name="Jamari Thrash", position="WR", team="LV", depth=None)
    text = "He hasn't played a down through seven weeks, and he's listed seventh among Las Vegas receivers."
    found = _place(text, thrash)
    assert len(found) == 1 and "no place on this week's depth chart" in found[0]


def _claiborne() -> WeekSheet:
    return replace(
        starter(),
        name="Demond Claiborne",
        position="RB",
        team="MIN",
        last_games=(GameLine(5, "NO", True, 1.6), GameLine(4, "MIA", False, 1.2), GameLine(3, "TB", True, 0.1)),
        depth=None,
    )


def test_a_game_figure_is_tied_to_its_own_week_and_club() -> None:
    """Demond Claiborne's live read: 1.6 PPR points came in week 5 against New Orleans, not week 4."""
    sheet = _claiborne()
    found = week_figure_violations(
        ["He has topped out at 1.6 PPR points, back in week 4 of 2026 at New Orleans."], sheet
    )
    assert len(found) == 1 and "The facts list week 4 as at MIA, 1.2 PPR points" in found[0]
    fixed = "He has topped out at 1.6 PPR points, back in week 5 of 2026 against New Orleans."
    assert week_figure_violations([fixed], sheet) == []
    # The right figure with the wrong club is refused too, and a week the sheet does not list has no figure.
    assert week_figure_violations(["He posted 1.2 PPR points in week 4 at Tampa Bay."], sheet)
    assert week_figure_violations(["He posted 2.2 PPR points in week 1."], sheet)
    assert week_figure_violations(["Week 5's 1.6 points was his best."], sheet) == []


def test_a_span_from_a_week_is_no_weeks_game() -> None:
    """DJ Rogers's live read: "3.7 PPR points from week 8 on" is his rest-of-season figure."""
    assert week_figure_violations(["Our order gives him 3.7 PPR points from week 8 on."], _claiborne()) == []


def test_the_validator_holds_the_read_to_both_fact_rules() -> None:
    sheet = _white(1.0, (("Jacory Croskey-Merritt", 2.0),))
    assert any("places him second" in v for v in week_rule_violations(WHITE, sheet, "sit"))


def test_the_sheet_reads_this_weeks_chart_at_his_best_place() -> None:
    """The newest week's newest load, each player at his best place across the position's slots."""
    earlier = datetime(2026, 10, 26, 14, 7, tzinfo=UTC)
    rows = [
        ("WAS", "RB", 7, "white", "Rachaad White", 2, earlier),
        ("WAS", "RB", 8, "jcm", "Jacory Croskey-Merritt", 1, earlier),
        ("WAS", "RB", 8, "white", "Rachaad White", 2, earlier),
        ("WAS", "RB", 8, "white", "Rachaad White", 1, RELEASED),
        ("WAS", "RB", 8, "white", "Rachaad White", 4, RELEASED),
        ("WAS", "RB", 8, "jcm", "Jacory Croskey-Merritt", 2, RELEASED),
        ("WAS", "RB", 8, "rod", "Chris Rodriguez Jr.", 3, RELEASED),
    ]
    charts = charts_from_rows(rows)
    place = weekly_place(charts, "WSH", "RB", "white")
    assert place == DepthPlace(1.0, (("Jacory Croskey-Merritt", 2.0), ("Chris Rodriguez Jr.", 3.0)), RELEASED)
    assert weekly_place(charts, "WSH", "RB", "someone else") is None
    assert weekly_place(charts, "WSH", "WR", "white") is None


def test_a_line_with_no_club_edge_counts_against_no_opponent() -> None:
    """The card's Opp rank counts a line only under the club the store says he played for; the sheet had put
    such a line under his board club (Cody White's week 2 at Arizona on the dev copy), parting the two ranks."""

    def log(opponent: str, points: float) -> dict[str, Any]:
        return {"week": 2, "opponent": opponent, "status": "played", "points": points}

    store = SimpleNamespace(
        teams={"edge": {2: "SEA"}, "no-edge": {}, "other": {2: "LAR"}},
        in_records=frozenset({("SEA", 2), ("ARI", 2), ("LAR", 2), ("SF", 2)}),
    )
    context = cast("SeasonContext", SimpleNamespace(store=store, through=2))
    blocks = {
        "edge": {"log": [log("ARI", 10.0)]},
        "no-edge": {"log": [log("ARI", 16.4)]},
        "other": {"log": [log("SF", 12.0)]},
    }
    players = {"edge": ("WR", "SEA"), "no-edge": ("WR", "SEA"), "other": ("WR", "LAR")}
    allowed = allowed_by_opponent(context, blocks, cast("Any", players), WRITTEN_AT)
    assert allowed[("ARI", "WR")].points_a_game == 10.0  # noqa: PLR2004 - the edged line alone
    assert allowed[("ARI", "WR")].rank < allowed[("SF", "WR")].rank


_NOW = WRITTEN_AT


def _stored(body: str, **changes: object) -> StoredWeekRead:
    row = StoredWeekRead(
        player_id="00-0036999", season=2026, week=6, source="llm", body=body, model="m/x",
        written_at=_NOW - timedelta(hours=2), facts_at=REPORT - timedelta(days=1), stamps={}, projection_points=11.2,
        status=None, reason="first", call="sit", attempt_day=date(2026, 10, 16), attempts=1,
    )  # fmt: skip
    return replace(row, **changes)  # type: ignore[arg-type]


STANDING = (
    "Philadelphia sits 16th of 32 against running backs through week 7 of 2026, nothing special. He leads the "
    "Washington backfield on early downs. Sit him this week."
)


def test_a_read_whose_place_tonights_sheet_does_not_bear_out_is_due_once_a_night() -> None:
    """FACT_STALE: nightly only, once a Central day, after a status change and before the rule-stale ones."""
    sheet, tomorrow = _white(1.0, (("Jacory Croskey-Merritt", 2.0),)), _NOW + timedelta(days=1)
    body = f"{STANDING} He runs second among Washington's backs."
    assert fact_violations(body, sheet)
    assert due_reason(sheet, _stored(body), tomorrow) == FACT_STALE
    assert due_reason(sheet, _stored(body), tomorrow, hourly=True) is None
    assert due_reason(sheet, _stored(body, attempt_day=date(2026, 10, 17)), tomorrow) is None  # asked today
    assert due_reason(replace(sheet, status=Status("out", REPORT)), _stored(body), tomorrow) == STATUS_CHANGED
    assert due_reason(sheet, _stored(STANDING), tomorrow) is None
    # A place that still holds stands; one that broke a body rule too is the fact reason's first.
    assert due_reason(_white(2.0, (("Jacory Croskey-Merritt", 1.0),)), _stored(body), tomorrow) is None
    assert due_reason(sheet, _stored(f"{body} The published projection likes him."), tomorrow) == FACT_STALE
    assert PRIORITY.index(FACT_STALE) < PRIORITY.index(RULE_STALE)
    assert FACT_STALE in WEEK_READ_REASONS


def _downs(chance: float | None, kind: str | None, wind: float = 15.0) -> WeekSheet:
    weather = Weather("outdoors", 76.0, wind, chance, kind, CHART_AT_THE_WRITE)
    return replace(starter(), name="Josh Downs", team="IND", weather=weather, depth=None)


def test_the_kickoff_forecast_a_read_states_is_the_weather_cells() -> None:
    """Greg Dulcich's live read said "a 75% chance of thunderstorms", true at the write; the forecast now names 89%.
    Josh Downs's "thunderstorms and wind in the forecast" stands while the cell names thunderstorms."""
    dulcich = "The forecast at kickoff carries a 75% chance of thunderstorms."
    assert weather_violations([dulcich], _downs(75.0, "thunderstorms")) == []
    found = weather_violations([dulcich], _downs(89.0, "thunderstorms"))
    assert len(found) == 1 and "75 % chance" in found[0]
    downs = "His production is the drag, with thunderstorms and wind in the forecast."
    assert weather_violations([downs], _downs(57.0, "thunderstorms")) == []
    # Storms that cleared below the share the cell names a chance from, a wind that moved, a dome.
    assert weather_violations([downs], _downs(12.0, "thunderstorms"))
    assert weather_violations(["Kickoff brings 16 mph wind."], _downs(57.0, "thunderstorms", wind=17.3))
    roofed = replace(_downs(None, None), weather=Weather("dome", None, None, None, None, None, CHART_AT_THE_WRITE))
    assert weather_violations(["Expect 64 degrees at kickoff."], roofed)


def test_an_undated_rank_or_average_is_tonights() -> None:
    """Puka Nacua's live read had "a defense 13th of 32 against receivers" from the sheet's rank before it counted
    lines as the card does (the card prints 8th); a rank dated to an earlier week stands; an Avg the card no longer
    prints is refused."""
    puka = replace(starter(), allowed=Allowed(8, 32, 27.6, "WR", 7, LINES))
    said = "He draws the Chargers at home, a defense 13th of 32 against receivers."
    assert standing_violations([said], puka)
    assert standing_violations([said], replace(puka, allowed=Allowed(13, 32, 29.1, "WR", 7, LINES))) == []
    assert standing_violations(["Atlanta sits 27th of 32 against receivers through week 6."], puka) == []
    assert standing_violations(["He averages 24.1 PPR points a game this season."], puka)
    assert standing_violations(["He averages 25.9 PPR points a game this season."], puka) == []
    assert standing_violations(["The Chargers allow 27.6 PPR points a game to receivers."], puka) == []


def test_true_weather_shapes_are_never_refused() -> None:
    """The review's L1: thunderstorms carry rain, a denied kind is no claim, and ice has its own words."""
    storms = _downs(68.0, "thunderstorms")
    assert weather_violations(["A 68% chance of thunderstorms and heavy rain hangs over kickoff."], storms) == []
    clear = _downs(None, "none")
    assert weather_violations(["Clear skies, no rain in the forecast."], clear) == []
    assert weather_violations(["He plays without snow or storms to worry about."], clear) == []
    assert weather_violations(["Rain is coming at kickoff."], clear)
    ice = _downs(45.0, "ice")
    assert weather_violations(["Freezing rain is in the forecast."], ice) == []
    assert weather_violations(["Sleet and an icy field await."], ice) == []
    assert weather_violations(["Freezing rain is in the forecast."], storms)


def test_a_first_look_at_a_club_is_no_place() -> None:
    """The review's L2: "his first look at the Jaguars" is a game, not a place on the chart."""
    second = replace(_white(2.0, (("Brian Thomas Jr.", 1.0),)), name="Parker Washington", position="WR", team="JAX")
    assert _place("Sunday is his first look at the Colts this season.", second) == []
