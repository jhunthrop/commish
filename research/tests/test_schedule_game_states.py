"""Each game's state and each slate's rest-of-season strength as the run writes them (Lane 80). No store.

A game is final once the store holds its result or a line from either side (Lane 66s's rule, the API's
gameStateAt), kicked off from its kickoff until then, upcoming before, all at the run's instant. The
rest-of-season strength is the mean of the opponents still to play (upcoming games only), to a tenth,
ranked among the clubs with a game left, the unrounded mean's order; a club with none has no rest."""

from datetime import UTC, datetime, timedelta

from research.nightly.build.season import schedule_json
from research.nightly.reads.schedule import Game, OpponentValue, game_states, slates
from research.pipeline.nflverse.team_codes import NFL_TEAM_ABBREVIATIONS

READ = datetime(2026, 8, 1, tzinfo=UTC)
THURSDAY = datetime(2026, 10, 16, 0, 15, tzinfo=UTC)
SUNDAY = datetime(2026, 10, 18, 17, tzinfo=UTC)
NEXT_SUNDAY = SUNDAY + timedelta(days=7)
# The run of the Monday after: 05:00 UTC.
MONDAY_RUN = datetime(2026, 10, 19, 5, tzinfo=UTC)
# MIA's rest of season: KC (10.5) and NYJ (4.5) still to play.
REST_MIA = 7.5


def _slate(club: str, *games: Game) -> dict[str, list[Game]]:
    return {club: list(games)}


def test_a_game_is_final_kicked_off_or_upcoming_at_the_run() -> None:
    games = {
        **_slate("SEA", Game(6, "DEN", False, THURSDAY), Game(7, "ARI", True, NEXT_SUNDAY)),
        **_slate("DEN", Game(6, "SEA", True, THURSDAY)),
        **_slate("BUF", Game(6, "MIA", False, SUNDAY)),
        **_slate("MIA", Game(6, "BUF", True, SUNDAY)),
    }
    # Thursday's lines are in for SEA alone: DEN's side is final too.
    states = game_states(games, frozenset({("SEA", 6)}), MONDAY_RUN)
    assert states[("SEA", 6)] == "final"
    assert states[("DEN", 6)] == "final"
    assert states[("BUF", 6)] == "kicked_off"
    assert states[("MIA", 6)] == "kicked_off"
    assert states[("SEA", 7)] == "upcoming"


def _league(games: dict[str, list[Game]]) -> dict[str, list[Game]]:
    """Every other club plays ARI in week 7, still to come."""
    return {club: [Game(7, "ARI", True, NEXT_SUNDAY)] for club in NFL_TEAM_ABBREVIATIONS} | games


def test_rest_of_season_strength_is_the_mean_of_the_games_still_to_play() -> None:
    values = {club: OpponentValue(5.0, READ) for club in NFL_TEAM_ABBREVIATIONS} | {
        "BUF": OpponentValue(11.5, READ),
        "KC": OpponentValue(10.5, READ),
        "NYJ": OpponentValue(4.5, READ),
    }
    # MIA played BUF (kicked off, not to play), meets KC and NYJ still: rest (10.5 + 4.5) / 2.
    games = _league(
        {"MIA": [Game(6, "BUF", True, SUNDAY), Game(7, "KC", False, NEXT_SUNDAY), Game(8, "NYJ", True, NEXT_SUNDAY)]}
    )
    states = game_states(games, frozenset(), MONDAY_RUN)
    measured = {s.club: s for s in slates(games, values, states)}
    rest = measured["MIA"].rest
    assert rest is not None
    assert rest.strength == REST_MIA
    # Whole-season strength is unchanged: every game, played or not.
    assert measured["MIA"].strength == (11.5 + 10.5 + 4.5) / 3
    written = {s["abbr"]: s for s in schedule_json(2026, list(measured.values()), values, states)["slates"]}
    assert written["MIA"]["rest"]["strength"] == REST_MIA
    assert written["MIA"]["rest"]["rank"] == 1
    assert written["MIA"]["rest"]["method"].startswith("the average of each club's remaining opponents'")
    assert [g["state"] for g in written["MIA"]["games"]] == ["kicked_off", "upcoming", "upcoming"]


def test_a_club_with_no_game_left_has_no_rest() -> None:
    values = {club: OpponentValue(5.0, READ) for club in NFL_TEAM_ABBREVIATIONS}
    games = _league({"MIA": [Game(6, "BUF", True, SUNDAY)]})
    states = game_states(games, frozenset({("BUF", 6)}), MONDAY_RUN)
    measured = {s.club: s for s in slates(games, values, states)}
    assert measured["MIA"].rest is None
    written = {s["abbr"]: s for s in schedule_json(2026, list(measured.values()), values, states)["slates"]}
    assert written["MIA"]["rest"] is None
    # Ranked among the 31 with a game left.
    assert max(s["rest"]["rank"] for s in written.values() if s["rest"] is not None) == len(NFL_TEAM_ABBREVIATIONS) - 1
