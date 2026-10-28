"""Week-ahead sheets for the tests (Lane 72): a starter, a Questionable player and a player on bye, built
from the dataclasses alone, so no test needs a store."""

from collections.abc import Mapping
from dataclasses import fields, is_dataclass, replace
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Any, Final

from research.capsules.week.sheet import (
    Allowed,
    BoardPlace,
    DepthPlace,
    ExpectedScore,
    GameLine,
    LastRead,
    PublishedProjection,
    Status,
    Weather,
    WeekGame,
    WeekSheet,
)

# Friday 2026-10-16, 9:00 pm Central.
WRITTEN_AT = datetime(2026, 10, 17, 2, 0, tzinfo=UTC)
KICKOFF = datetime(2026, 10, 18, 20, 5, tzinfo=UTC)  # Sunday 3:05 pm Central
CAPTURED = datetime(2026, 10, 16, 18, 0, tzinfo=UTC)
BEFORE = datetime(2026, 10, 15, 18, 0, tzinfo=UTC)
REPORT = datetime(2026, 10, 16, 21, 0, tzinfo=UTC)
FIGURES = datetime(2026, 10, 16, 23, 52, tzinfo=UTC)
BOARD = datetime(2026, 10, 16, 12, 0, tzinfo=UTC)
LINES = datetime(2026, 10, 14, 0, 0, tzinfo=UTC)


def starter() -> WeekSheet:
    """A receiver at home, indoors, against a defense that allows his position plenty."""
    return WeekSheet(
        player_id="00-0039075",
        name="Puka Nacua",
        position="WR",
        team="LAR",
        season=2026,
        week=6,
        written_at=WRITTEN_AT,
        game=WeekGame(6, "ARI", home=True, kickoff=KICKOFF),
        bye=False,
        projection=PublishedProjection(18.4, CAPTURED, 17.9, BEFORE),
        expected=ExpectedScore(32.5, 20.0, FIGURES),
        weather=Weather("dome", None, None, None, None, None, FIGURES),
        allowed=Allowed(26, 32, 41.3, "WR", 5, LINES),
        status=Status(None, REPORT),
        depth=DepthPlace(1.0, (("Davante Adams", 2.0),)),
        last_games=(GameLine(5, "SF", False, 24.1), GameLine(4, "IND", True, 31.2), GameLine(1, "HOU", True, 22.5)),
        points_per_game=25.9,
        games_played=3,
        touchdowns=4.0,
        through=5,
        played=(1, 4, 5),
        missed=(2, 3),
        board=BoardPlace(3, 2, 230.0, "rest_of_season", 6, BOARD),
        last_read=None,
    )


def questionable() -> WeekSheet:
    """A back on the injury report as Questionable, outdoors in wind, his projection moved since the last read."""
    return replace(
        starter(),
        player_id="00-0038542",
        name="Bijan Robinson",
        position="RB",
        team="ATL",
        game=WeekGame(6, "CHI", home=True, kickoff=datetime(2026, 10, 18, 17, 0, tzinfo=UTC)),
        projection=PublishedProjection(15.2, CAPTURED, 17.0, BEFORE),
        expected=ExpectedScore(25.0, 26.5, FIGURES),
        weather=Weather("outdoors", 61.0, 14.0, 30.0, "rain", FIGURES),
        allowed=Allowed(9, 32, 18.7, "RB", 5, LINES),
        status=Status("questionable", REPORT),
        depth=DepthPlace(1.0, (("Tyler Allgeier", 2.0),)),
        last_games=(GameLine(5, "TB", False, 21.4), GameLine(4, "WSH", True, 9.8), GameLine(3, "CAR", False, 17.3)),
        points_per_game=17.6,
        games_played=5,
        touchdowns=3.0,
        played=(1, 2, 3, 4, 5),
        missed=(),
        board=BoardPlace(8, 4, 196.0, "rest_of_season", 6, BOARD),
        last_read=LastRead(datetime(2026, 10, 16, 2, 0, tzinfo=UTC), 17.0, None),
    )


def on_bye() -> WeekSheet:
    """A back whose club does not play in week 6."""
    return replace(
        starter(),
        player_id="00-0038120",
        name="Jahmyr Gibbs",
        position="RB",
        team="DET",
        game=WeekGame(7, "GB", home=True, kickoff=datetime(2026, 10, 25, 20, 25, tzinfo=UTC)),
        bye=True,
        projection=None,
        expected=None,
        weather=None,
        allowed=None,
        status=Status(None, REPORT),
        depth=DepthPlace(1.0, (("David Montgomery", 2.0),)),
        last_games=(GameLine(5, "KC", False, 28.6), GameLine(4, "CLE", True, 19.0), GameLine(3, "BAL", False, 14.2)),
        points_per_game=21.3,
        games_played=5,
        touchdowns=5.0,
        played=(1, 2, 3, 4, 5),
        missed=(),
        board=BoardPlace(5, 3, 214.0, "rest_of_season", 6, BOARD),
    )


def heaviest() -> WeekSheet:
    """The heaviest sheet a week read is written from (Lane 286, the prompt bound): every section the sheet
    prints, each at its longest, and nothing of the starter's, so the writer test's drafts (written for Puka
    Nacua) break every rule they can on it, as on Terry McLaurin's sheet, the copy's heaviest correction. A
    longer name than any on the copy, four teammates on the chart (the copy's most), three games in the log,
    a week he missed, an Out status (a player who cannot play, so a draft that starts him breaks the most
    rules), an outdoor forecast with every figure, a rank said by its rank, the projection and the one before it, the read
    before this one, and every stamp. His voice is table talk, the voice with the longest reminder."""
    return replace(
        starter(),
        player_id="00-0039003",
        name="Jean-Baptiste Montgomery-Smith Jr.",
        team="WAS",
        game=WeekGame(6, "CHI", home=False, kickoff=KICKOFF, scheduled_at=BEFORE),
        projection=PublishedProjection(11.3, CAPTURED, 13.6, BEFORE),
        expected=ExpectedScore(23.5, 21.0, FIGURES),
        status=Status("out", REPORT, FIGURES),
        weather=Weather("outdoors", 83.0, 14.0, 55.0, "thunderstorms", FIGURES, BEFORE),
        allowed=Allowed(22, 32, 20.2, "WR", 5, LINES),
        depth=DepthPlace(
            2.0,
            (
                ("Christian Montgomery-Watson", 1.0),
                ("Demarcus Robinson-Whitfield", 3.0),
                ("Jaxon Smith-Njigba-Ellington Jr.", 4.0),
                ("Marquez Valdes-Scantling", 5.0),
            ),
            BEFORE,
        ),
        last_games=(GameLine(4, "NYG", False, 7.6), GameLine(3, "LV", True, 12.9), GameLine(1, "NYG", True, 19.4)),
        points_per_game=13.3,
        games_played=4,
        touchdowns=1.0,
        played=(1, 3, 4, 5),
        missed=(2,),
        board=BoardPlace(61, 27, 98.4, "rest_of_season", 6, BOARD),
        last_read=LastRead(datetime(2026, 10, 16, 2, 0, tzinfo=UTC), 13.6, "questionable"),
        lines_at=FIGURES,
    )


def on_injured_reserve() -> WeekSheet:
    """A starter whose status keeps him out: he cannot play this week."""
    return replace(starter(), status=Status("injured_reserve", REPORT))


# --- the recorded fixture's sheets, as JSON --------------------------------------------------------

Json = dict[str, Any]
_NESTED: Final[Mapping[str, type]] = MappingProxyType(
    {
        "game": WeekGame,
        "projection": PublishedProjection,
        "expected": ExpectedScore,
        "weather": Weather,
        "allowed": Allowed,
        "status": Status,
        "depth": DepthPlace,
        "board": BoardPlace,
        "last_read": LastRead,
    }
)
_INSTANTS: Final = frozenset(
    {"kickoff", "written_at", "captured_at", "previous_captured_at", "read_at", "published_at", "scheduled_at"}
    | {"roof_read_at", "released_at", "checked_at"}
)


def _encode(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if is_dataclass(value) and not isinstance(value, type):
        return {f.name: _encode(getattr(value, f.name)) for f in fields(value)}
    if isinstance(value, tuple):
        return [_encode(item) for item in value]
    return value


def sheet_json(sheet: WeekSheet) -> Json:
    """A sheet as the recorded fixture keeps it."""
    encoded: Json = _encode(sheet)
    return encoded


def _inner_value(name: str, raw: Any) -> Any:
    if raw is not None and name in _INSTANTS:
        return datetime.fromisoformat(raw)
    if name == "around":
        return tuple((teammate, slot) for teammate, slot in raw)
    return raw


def _field_value(name: str, raw: Any) -> Any:
    if name in _NESTED:
        return None if raw is None else _NESTED[name](**{k: _inner_value(k, v) for k, v in raw.items()})
    if name in ("written_at", "lines_at") and raw is not None:
        return datetime.fromisoformat(raw)
    if name == "last_games":
        return tuple(GameLine(**line) for line in raw)
    if name in ("played", "missed"):
        return tuple(raw)
    return raw


def sheet_from_json(raw: Json) -> WeekSheet:
    """The recorded fixture's sheet, read back."""
    return WeekSheet(**{f.name: _field_value(f.name, raw[f.name]) for f in fields(WeekSheet)})
