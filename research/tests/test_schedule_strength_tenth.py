"""A slate's strength as the run writes it (the ruling on the sweep's X9): to a tenth, by the site's one
rounding rule, like every other figure a screen prints, so the schedule and club pages never print
9.26. The rank is the unrounded mean's, so two slates the tenth ties keep their order. No store."""

from datetime import UTC, datetime

from research.nightly.build.season import schedule_json
from research.nightly.reads.schedule import Game, OpponentValue, Slate, game_states, slates
from research.pipeline.nflverse.team_codes import NFL_TEAM_ABBREVIATIONS

READ = datetime(2026, 8, 1, tzinfo=UTC)
KICKOFF = datetime(2026, 9, 13, 17, tzinfo=UTC)
# The tenth both slates write.
WRITTEN = 9.3


def _game(opponent: str) -> Game:
    return Game(1, opponent, True, KICKOFF)


def test_strength_is_written_to_a_tenth() -> None:
    slate = Slate("ARI", (_game("BUF"),), 9.264705882352942, 1, (READ, READ))
    written = schedule_json(2026, [slate], {"BUF": OpponentValue(10.5, READ)}, {("ARI", 1): "upcoming"})
    assert written["slates"][0]["strength"] == WRITTEN


def test_the_rank_is_the_unrounded_means_so_a_tie_on_the_tenth_keeps_its_order() -> None:
    # ARI meets BUF (9.26), ATL meets MIA (9.34): both write 9.3, ATL's is the harder slate. Every
    # other club meets ARI, the easiest value, so the two lead the league.
    values = {club: OpponentValue(1.0, READ) for club in NFL_TEAM_ABBREVIATIONS} | {
        "BUF": OpponentValue(9.26, READ),
        "MIA": OpponentValue(9.34, READ),
    }
    games = {club: [_game("ARI")] for club in NFL_TEAM_ABBREVIATIONS} | {
        "ARI": [_game("BUF")],
        "ATL": [_game("MIA")],
    }
    states = game_states(games, frozenset(), READ)
    measured = slates(games, values, states)
    rank = {s.club: s.rank for s in measured}
    assert (rank["ATL"], rank["ARI"]) == (1, 2)
    written = {s["abbr"]: s["strength"] for s in schedule_json(2026, measured, values, states)["slates"]}
    assert (written["ATL"], written["ARI"]) == (WRITTEN, WRITTEN)
