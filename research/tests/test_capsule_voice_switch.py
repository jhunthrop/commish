"""The voice switch, the lane's core contract (review M5): the first kickoff picks the voice, the
preseason sheet and rules are the drafting ones, and the in-season sheet's edges (L3) read true."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

from research.capsules.facts.model import InjuryClean, InjuryDesignated, SeasonSoFar, SeasonTotals, SeasonWeek
from research.capsules.facts.season_so_far import is_in_season
from research.capsules.prompt import IN_SEASON_RULES, PRESEASON_RULES, writer_rules_for
from research.capsules.render import _adp_line
from research.capsules.render_season import bye_line, injury_line, season_section, today_line
from research.capsules.season_voice import SeasonClock, time_frame_hits

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

KICKOFF = datetime(2026, 9, 10, 0, 20, tzinfo=UTC)
_TOTALS = SeasonTotals(None, None, None, None, None, None, None, None)


def _facts(season: SeasonSoFar | None, *, bye: int | None = 11, injury: object = None) -> "PlayerFacts":
    stand_in = SimpleNamespace(
        season=season,
        run_day="2026-08-20" if season is None else "2026-10-14",
        product_season=2026,
        bye_week=bye,
        injury=injury or InjuryClean("clean", "2026-08-01"),
    )
    return cast("PlayerFacts", stand_in)


def _season(through: int, weeks: tuple[SeasonWeek, ...] = (), from_week: int | None = None) -> SeasonSoFar:
    return SeasonSoFar(2026, through, 0, None, _TOTALS, weeks, from_week)


def test_the_first_kickoff_picks_the_voice() -> None:
    assert is_in_season(KICKOFF, KICKOFF)
    assert not is_in_season(KICKOFF, KICKOFF - timedelta(seconds=1))
    assert not is_in_season(None, KICKOFF)


def test_preseason_sheet_and_rules_speak_to_a_drafter() -> None:
    facts = _facts(None)
    assert writer_rules_for(facts) is PRESEASON_RULES
    assert "manager about to draft" in PRESEASON_RULES
    assert '"draft him"' in PRESEASON_RULES and '"let him fall"' in PRESEASON_RULES
    assert "draft him" not in IN_SEASON_RULES.split("TIME")[0].split("WORDS")[1]
    assert today_line(facts) == (
        "Today is 2026-08-20, before the 2026 season's first kickoff. The reader is getting ready to draft."
    )
    assert season_section(facts) == "No games played yet: the 2026 season has not kicked off."
    assert bye_line(facts) == "Bye: week 11 of 2026."
    assert injury_line(facts) == "Injury report: no designation since 2026-08-01."


def test_in_season_rules_and_lines() -> None:
    facts = _facts(_season(5, (SeasonWeek(4, "inactive", None),), 6), injury=InjuryDesignated("designated", "Q", "x"))
    assert writer_rules_for(facts) is IN_SEASON_RULES
    assert "week 6 of 2026 is the next to play" in today_line(facts)
    assert bye_line(facts) == "Bye: week 11 of 2026, still to come."
    assert injury_line(facts) == "Injury report: designation Q since before week 6 of 2026."
    assert "Weeks he has missed this season: week 4 of 2026 (1 in all)." in season_section(facts)


def test_the_in_season_instructions_carry_no_phrase_the_in_season_floor_refuses() -> None:
    for phrase in ("a round earlier", "a few picks after his ADP", "wait on him", "rounded pick", "around pick"):
        assert phrase not in IN_SEASON_RULES, phrase
        assert not any(rule.startswith("draft voice") for rule in _floor(IN_SEASON_RULES.split("TIME")[0]))
    assert "a round earlier than that" in PRESEASON_RULES and "we would take him" in PRESEASON_RULES
    assert "we would hold him" in IN_SEASON_RULES


def test_the_in_season_sheet_prints_adp_as_on_file_with_no_pick_word() -> None:
    market = SimpleNamespace(adp=7.4, position_adp=None)
    october = cast("PlayerFacts", SimpleNamespace(market=market, season=_season(5)))
    august = cast("PlayerFacts", SimpleNamespace(market=market, season=None))
    assert _adp_line(october) == "ADP before the season 7.4 (where drafters took him)."
    assert "around pick 7" in _adp_line(august)
    none_on_file = cast(
        "PlayerFacts", SimpleNamespace(market=SimpleNamespace(adp=None, position_adp=None), season=_season(5))
    )
    assert "pick" not in _adp_line(none_on_file)


def _floor(text: str) -> list[str]:
    return [hit.rule for hit in time_frame_hits(text, SeasonClock(2026, 5))]


def test_the_next_week_reads_true_at_the_edges() -> None:
    assert "next to play" not in today_line(_facts(_season(18)))
    opener = _facts(_season(0, (SeasonWeek(1, "played", 12.0),)))
    assert "no week's games are in our records yet, and week 1 of 2026 is under way" in today_line(opener)
