"""This season's usage read against a stand-in store: club totals from everyone, a played week with no
touch counted at zero, a special-teams week left out, the read's span from the play-by-play."""

from collections.abc import Iterator, Mapping
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

from sqlalchemy import Connection

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts.season_usage import Figure
from research.capsules.facts.season_usage_reads import season_usage_by_player
from research.pipeline.nflverse.participation import NflverseSource, ParticipationMetric
from research.pipeline.nflverse.pbp import PBP_PLAYER_SOURCE, PbpPlayerMetric

_ON = CAPSULE_CONFIG.sources_on_pages
_AS_OF = datetime(2026, 10, 15, tzinfo=UTC)
_SNAPS = (NflverseSource.SNAP_COUNTS, ParticipationMetric.OFFENSIVE_SNAPS)


class _Store:
    """Answers the three statements the read makes: the facts, the player-team edges, the names."""

    def __init__(self, facts: list[tuple[int, str, str, str, float]], teams: Mapping[tuple[str, int], str]) -> None:
        self._facts = facts
        self._teams = teams

    def execute(self, statement: object, params: Mapping[str, Any] | None = None) -> Iterator[SimpleNamespace]:
        sql = str(statement)
        if "player_week_observations" in sql:
            return iter(
                SimpleNamespace(week=w, player_id=p, source=s, metric=m, value=v) for w, p, s, m, v in self._facts
            )
        if "player_week_teams" in sql:
            return iter(
                SimpleNamespace(season=2026, week=w, player_id=p, team=t, as_of=_AS_OF)
                for (p, w), t in self._teams.items()
            )
        return iter(SimpleNamespace(id=p, name=p.upper()) for p in {f[1] for f in self._facts})


def _touches(week: int, player: str, carries: float, red_zone: float) -> list[tuple[int, str, str, str, float]]:
    return [
        (week, player, PBP_PLAYER_SOURCE, PbpPlayerMetric.CARRIES, carries),
        (week, player, PBP_PLAYER_SOURCE, PbpPlayerMetric.TARGETS, 0.0),
        (week, player, PBP_PLAYER_SOURCE, PbpPlayerMetric.RED_ZONE_CARRIES, red_zone),
        (week, player, PBP_PLAYER_SOURCE, PbpPlayerMetric.RED_ZONE_TARGETS, 0.0),
    ]


def test_club_totals_count_everyone_and_a_quiet_played_week_counts_at_zero() -> None:
    facts = [
        *_touches(1, "back", 20, 6),
        *_touches(2, "back", 22, 5),
        (3, "back", *_SNAPS, 30.0),  # played week 3, touched nothing in the red zone or anywhere
        *_touches(1, "teammate", 5, 4),  # not in the population, still in his club's total
        *_touches(2, "teammate", 6, 3),
        *_touches(3, "teammate", 9, 6),
        (4, "back", *_SNAPS, 0.0),  # special teams alone
    ]
    teams = {(p, w): "ATL" for p in ("back", "teammate") for w in (1, 2, 3, 4)}
    store = cast(Connection, _Store(facts, teams))
    usage = season_usage_by_player(store, 2026, {"back": "RB"}, _AS_OF, on_pages=_ON)["back"]
    share = next(f for f in usage.figures if f.key == Figure.RED_ZONE_SHARE)
    assert (share.count, share.out_of, share.weeks) == (11, 24, (1, 2, 3))
    assert usage.weeks == (1, 2, 3), "a week of special teams alone is not his"
    assert (usage.first_week, usage.last_week) == (1, 3)
    assert set(season_usage_by_player(store, 2026, {"back": "RB"}, _AS_OF, on_pages=_ON)) == {"back"}


def test_nothing_before_the_season_has_a_play_by_play_week() -> None:
    store = cast(Connection, _Store([(1, "back", *_SNAPS, 30.0)], {("back", 1): "ATL"}))
    assert season_usage_by_player(store, 2026, {"back": "RB"}, _AS_OF, on_pages=_ON) == {}
