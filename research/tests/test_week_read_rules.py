"""Lane 72, the week-ahead read: its sheet, its caption and its rules (fix round 1 included).

The sheet carries only stamped facts, each line with its read, and names the projection as published,
never ours, for the writer alone; the caption is the page's "Written Fri 9:00 pm Central, for week 6"; the read is held to the
writer's rules and to the week's own: no betting or trading word, no provider or rival product, no tip;
the published projection never named in the read, nor its figure or its change (H4, Lane 275); a player who may
not be started never recommended, by his call or in any wording (H2); every figure with its unit (M1);
his place in our order said with which order (M2); the season named once (the ruling on L5); three to
five sentences; no sentence shape another page carries (M4). The season read in season refuses the
draft-time sentence."""

from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from research.capsules.narrative import NAMES_KIND, WORDS_KIND, ShapeMasks
from research.capsules.season_voice import SeasonClock, time_frame_hits
from research.capsules.sentences import split_sentences
from research.capsules.voice_rules import gate_hits
from research.capsules.week.caption import written_caption
from research.capsules.week.rank_words import rank_words
from research.capsules.week.render import render_week_facts_block, render_week_sheet
from research.capsules.week.rules import (
    WEEK_NEVER_WORDS,
    names_the_projection,
    stated_figures,
    week_rule_violations,
)
from research.capsules.week.sheet import (
    Allowed,
    BoardPlace,
    DepthPlace,
    GameLine,
    PublishedProjection,
    Status,
    Weather,
    WeekGame,
    WeekSheet,
)
from research.capsules.week.start_advice import start_advice_in
from research.capsules.week.validate import sentence_shapes, validate_week_read, week_masks, with_season
from research.tests.week_read_fixtures import (
    BOARD,
    CAPTURED,
    FIGURES,
    KICKOFF,
    LINES,
    REPORT,
    WRITTEN_AT,
    main_sheet,
    on_bye,
    on_injured_reserve,
    questionable,
    starter,
)

STARTER_READ = (
    "Puka Nacua gets Arizona at home in week 6 of 2026, and the Cardinals rank 26th of 32 against receivers. "
    "He leads the Rams' receivers with 25.9 PPR points a game over his 3 games this season, and nothing about his "
    "role has moved since. The Rams play indoors, so nothing about the weather gets in his way. The passing game "
    "still runs through him on the downs that matter. Arizona has no answer for a receiver who wins this often. "
    "Start him with confidence."
)
BYE_READ = (
    "Jahmyr Gibbs and the Lions are on their bye in week 6 of 2026, so he does not play this week. Keep him "
    "rostered, because his 21.3 PPR points a game over 5 games make him a weekly starter the moment Detroit is "
    "back. Fill his spot with a back who has a game and steady work of his own, and do not let an empty week push "
    "you into a panic move. Gibbs goes straight back into the lineup for week 7 against Green Bay."
)


def _words(text: str) -> list[str]:
    return [rule.name for rule in WEEK_NEVER_WORDS if rule.pattern.search(text)]


def test_the_sheet_names_the_week_the_projection_as_published_and_the_order() -> None:
    sheet = render_week_sheet(starter())
    assert "week 6 of 2026" in sheet
    assert "published projection" in sheet.lower() and "not ours" in sheet
    # Lane 275: the writer knows the week's figure and is told never to name it; the change is not on the sheet.
    assert "18.4 points" in sheet and "never name it, its figure or its change in the read" in sheet
    assert "+0.5" not in sheet and "It moved" not in sheet
    assert "26th of 32" in sheet and "1st allowed the fewest" in sheet
    assert "Sunday 3:05 pm Central" in sheet
    assert "32.5" in sheet and "indoors" in sheet
    assert "Our rest-of-season order" in sheet and "WR2" in sheet and '"in our rest-of-season order"' in sheet


def test_a_preseason_board_is_named_as_the_preseason_order() -> None:
    sheet = replace(starter(), board=BoardPlace(1, 1, None, "preseason", None, BOARD))
    text = render_week_sheet(sheet)
    assert "Our preseason order" in text and '"in our preseason order"' in text


def test_every_line_carries_its_stamp_and_the_report_its_day() -> None:
    sheet = replace(
        starter(),
        game=WeekGame(6, "ARI", True, KICKOFF, LINES),
        depth=DepthPlace(1.0, (("Davante Adams", 2.0),), LINES),
        lines_at=LINES,
    )
    text = render_week_sheet(sheet)
    for line in text.splitlines()[2:]:
        if not line.startswith("Injury report") and line != "No injury designation.":
            assert "(as of " in line, line
    # Lane 307: no designation is one short line, no stamp and no report day; a designation keeps both.
    assert "No injury designation." in text and "Friday's report" not in text
    assert "on Friday's report" in render_week_sheet(replace(sheet, status=Status("questionable", REPORT)))
    assert set(sheet.stamps()) >= {"schedule", "projection", "status", "expected", "allowed", "board", "stat_lines"}
    assert set(sheet.stamps()) >= {"depth_chart"}


def test_the_sheet_never_prints_a_betting_word_or_a_provider() -> None:
    for sheet in (starter(), questionable(), on_bye(), on_injured_reserve()):
        text = render_week_sheet(sheet)
        assert gate_hits(text, ()) == [], text
        assert _words(text) == []


def test_the_sheet_states_a_bye_and_a_status_that_keeps_him_out() -> None:
    bye = render_week_sheet(on_bye())
    assert "does not play in week 6 of 2026" in bye
    assert "published projection" not in bye.lower()
    out = render_week_sheet(on_injured_reserve())
    assert "injured reserve" in out and "cannot play in week 6 of 2026" in out


def test_the_questionable_sheet_names_the_designation_the_change_and_the_forecast() -> None:
    sheet = render_week_sheet(questionable())
    assert "Questionable on Friday's report" in sheet
    # The change is the card's Delta Proj cell alone (Lane 275): the read never states it, so the sheet holds it
    # no more than the figure before it or the change since our last read (Lane 100, B17).
    assert "-1.8" not in sheet and "17 points" not in sheet and "since our last read" not in sheet.lower()
    assert "18.7" not in sheet and "touchdowns" not in sheet
    assert "61 degrees" in sheet and "14 mph" in sheet and "30% chance of rain" in sheet


def test_the_facts_block_is_labelled_facts_and_no_sentence() -> None:
    lines = render_week_facts_block(starter()).splitlines()
    assert all(": " in line for line in lines)
    assert any(line.startswith("Published projection: 18.4 points") for line in lines)
    assert any(line == "In our rest-of-season order: WR2" for line in lines)
    assert not any(line.rstrip().endswith(".") for line in lines)


def test_the_stamps_are_every_fact_at_or_before_the_write() -> None:
    sheet = starter()
    assert all(datetime.fromisoformat(at) <= WRITTEN_AT for at in sheet.stamps().values())
    assert sheet.facts_at == max(CAPTURED, REPORT, FIGURES, BOARD)


def test_a_fact_stamped_after_the_write_is_refused() -> None:
    late = datetime(2026, 10, 17, 3, 0, tzinfo=UTC)
    with pytest.raises(ValueError, match="after the write"):
        replace(starter(), projection=PublishedProjection(18.4, late, None, None))


@pytest.mark.parametrize(
    ("written_at", "week", "caption"),
    [
        (WRITTEN_AT, 6, "Written Fri Oct 16, 9:00 pm CT, for week 6"),
        (datetime(2026, 10, 18, 16, 5, tzinfo=UTC), 6, "Written Sun Oct 18, 11:05 am CT, for week 6"),
        (datetime(2026, 12, 1, 6, 30, tzinfo=UTC), 13, "Written Tue Dec 1, 12:30 am CT, for week 13"),
    ],
)
def test_the_caption_is_the_write_in_central_time_and_the_week(written_at: datetime, week: int, caption: str) -> None:
    assert written_caption(written_at, week) == caption


def test_an_honest_starter_read_passes() -> None:
    result = validate_week_read(STARTER_READ, starter(), call="start")
    assert result.ok, result.violations


def test_an_honest_bye_read_passes_and_says_he_does_not_play() -> None:
    result = validate_week_read(BYE_READ, on_bye(), call="hold")
    assert result.ok, result.violations


@pytest.mark.parametrize(
    "sentence",
    [
        "The odds favor the Rams.",
        "The Rams are favoured on the scoreboard.",
        "ARI is a big underdog this week.",
        "The line on this game moved.",
        "Vegas likes this spot.",
        "The spread is wide.",
        "It is a safe bet he scores.",
        "The books expect points.",
        "Buy him now before the price climbs.",
    ],
)
def test_a_betting_or_trading_word_is_refused(sentence: str) -> None:
    result = validate_week_read(f"{STARTER_READ} {sentence}", starter(), call="start")
    assert not result.ok
    assert any(sentence in v for v in result.violations), result.violations


def test_football_senses_of_line_and_spread_pass() -> None:
    assert _words("His offensive line held up and his stat line was full.") == []
    assert _words("The goal line is his, on the line of scrimmage.") == []
    assert _words("He lines up in the slot, and the Rams spread the ball to his favorite target.") == []


@pytest.mark.parametrize("name", ["Tank01", "nflverse", "the National Weather Service", "Sleeper app", "ESPN"])
def test_a_provider_or_a_rival_product_is_refused(name: str) -> None:
    assert not validate_week_read(f"{STARTER_READ} {name} agrees.", starter(), call="start").ok


def test_a_tip_word_is_no_longer_refused() -> None:
    """Lane 307: the tip words refused a true sentence for its wording ("don't forget the bye") and are retired."""
    result = validate_week_read(f"{STARTER_READ} Don't forget him.", starter(), call="start")
    assert not any("tip" in v for v in result.violations), result.violations


def test_the_projection_is_never_called_ours() -> None:
    text = STARTER_READ.replace("He leads the Rams' receivers", "Our projection says he leads the Rams' receivers")
    assert any("ours" in v for v in week_rule_violations(text, starter(), "start"))


@pytest.mark.parametrize(
    "sentence",
    [
        "The published projection has him at 18.4 points.",
        "The published projection likes him a lot this week.",
        "His projection for the week sits where a WR2 lives.",
        "He is projected for a big afternoon.",
        "The projections are friendly to him this week.",
    ],
)
def test_a_sentence_naming_the_published_projection_is_refused(sentence: str) -> None:
    """Lane 275 (the founder, 2026-10-28): the read never names the published projection, with a figure or
    without one, and never grades it: the card's Wk cell prints it."""
    text = STARTER_READ.replace("The Rams play indoors", f"{sentence} The Rams play indoors")
    violations = week_rule_violations(text, starter(), "start")
    assert any("names the published projection" in v for v in violations), violations


@pytest.mark.parametrize("figure", ["18.4 points", "18.4", "0.5 points", "17.9 points"])
def test_the_published_projections_figure_is_refused_with_or_without_a_unit(figure: str) -> None:
    """The figure, the change and the one before it, as a cell or bare, are the Wk cell's alone (Lane 275)."""
    text = STARTER_READ.replace("Start him with confidence.", f"Count on {figure} from him. Start him.")
    violations = week_rule_violations(text, starter(), "start")
    raw = figure.removesuffix(" points")
    assert any(f'states the published projection\'s figure "{raw}"' in v for v in violations), violations


@pytest.mark.parametrize(
    "sentence",
    [
        "The number on his card undersells him this week.",
        "His Wk figure looks light for this matchup.",
        "The week's number feels conservative for him.",
        "The Wk cell sells him short.",
        "The Proj tile is too cautious about him.",
    ],
)
def test_a_sentence_naming_the_card_is_refused(sentence: str) -> None:
    """Lane 275 fix round 2 (review M2): the card, its cells and the week's number by name grade the published
    projection without its words; the read never names them, and the cadence counts such a read stale."""
    text = STARTER_READ.replace("The Rams play indoors", f"{sentence} The Rams play indoors")
    assert any("names the card" in v for v in week_rule_violations(text, starter(), "start"))
    assert names_the_projection(text) and not names_the_projection(STARTER_READ)


def test_a_figure_another_cell_prints_too_is_that_cells_to_quote() -> None:
    """A last game of 18.4 points is the game log's figure, whatever the projection prints (Lane 275)."""
    sheet = replace(starter(), last_games=(GameLine(5, "SF", False, 18.4), *starter().last_games[1:]))
    text = STARTER_READ.replace(
        "He leads the Rams' receivers with 25.9 PPR points a game over his 3 games this season.",
        "He put up 18.4 points in his last game.",
    )
    assert not any("published projection" in v for v in week_rule_violations(text, sheet, "start"))


def test_our_rest_of_season_projection_is_not_the_weeks() -> None:
    text = STARTER_READ.replace("Start him with confidence.", "He is WR2 in our rest-of-season order. Start him.")
    assert not any("published projection" in v for v in week_rule_violations(text, starter(), "start"))


def test_an_honest_read_names_no_projection_at_all() -> None:
    """The rule the read once had to meet (a read with a projection names it) is gone (Lane 275)."""
    assert not any("projection" in v for v in week_rule_violations(STARTER_READ, starter(), "start"))


@pytest.mark.parametrize(
    "advice",
    [
        "You can't sit him, start him.",
        "He is a must-start in your lineup this week anyway.",
        "Start Puka Nacua this week.",
    ],
)
@pytest.mark.parametrize("sheet_of", [on_injured_reserve, lambda: replace(starter(), bye=True)])
def test_a_player_who_may_not_be_started_is_never_recommended_in_any_wording(advice: str, sheet_of: object) -> None:
    sheet = sheet_of()  # type: ignore[operator]
    text = f"Puka Nacua does not play in week 6 of 2026. His 25.9 PPR points a game wait for week 7. {advice}"
    assert any("recommends starting" in v for v in week_rule_violations(text, sheet, "sit")), advice


@pytest.mark.parametrize("status", ["out", "doubtful", "injured_reserve", "suspended"])
def test_a_start_call_on_a_sheet_that_may_not_start_him_is_refused(status: str) -> None:
    sheet = replace(starter(), status=Status(status, REPORT))
    assert any("call is start" in v for v in week_rule_violations(STARTER_READ, sheet, "start"))
    assert not any("call is start" in v for v in week_rule_violations(STARTER_READ, starter(), "start"))


def test_a_negation_in_its_own_clause_is_no_recommendation() -> None:
    text = "Puka Nacua is on injured reserve and does not play in week 6 of 2026. Do not start him. Hold the spot."
    assert not any("recommends" in v for v in week_rule_violations(text, on_injured_reserve(), "sit"))


def test_what_a_bye_does_to_a_lineup_is_not_a_recommendation() -> None:
    sheet = on_bye()
    stated = "Detroit is on its bye in week 6 of 2026, so Gibbs does not play and puts a zero in your lineup this week."
    assert not any("recommends" in v for v in week_rule_violations(stated, sheet, "hold"))
    advice = "Detroit is on its bye in week 6 of 2026. Put him in your lineup anyway."
    assert any("recommends" in v for v in week_rule_violations(advice, sheet, "hold"))


def test_a_read_must_say_he_does_not_play_when_he_cannot() -> None:
    text = "Jahmyr Gibbs has 21.3 PPR points a game over 5 games in 2026. The Lions back is a weekly starter. Hold him."
    assert any("does not play" in v for v in week_rule_violations(text, on_bye(), "hold"))


def test_a_rank_in_our_order_says_which_order() -> None:
    plain = "We have him WR2 on our board for the weeks ahead."
    assert any("which order" in v for v in week_rule_violations(plain, starter()))
    said = "He is WR2 in our rest-of-season order."
    assert not any("which order" in v for v in week_rule_violations(said, starter()))
    preseason = replace(starter(), board=BoardPlace(1, 1, None, "preseason", None, BOARD))
    assert any("which order" in v for v in week_rule_violations("He is WR1 in our rest-of-season order.", preseason))


def test_the_season_is_named_once_and_weeks_after_it_go_bare() -> None:
    twice = STARTER_READ.replace("so nothing about", "in week 6 of 2026, so nothing about")
    assert any("names the season 2 times" in v for v in week_rule_violations(twice, starter()))
    assert validate_week_read(BYE_READ, on_bye(), call="hold").ok


def test_a_bare_week_with_no_season_named_passes() -> None:
    """Lane 307 retired the season on every week: "week 6" with no season is this season's."""
    text = STARTER_READ.replace("in week 6 of 2026", "in week 6")
    assert validate_week_read(text, starter(), call="start").ok


def test_a_sentence_shaped_like_one_on_another_page_is_refused() -> None:
    """The review's M4: the same skeleton with another name and other numbers is the same sentence."""
    theirs = "The Bears play indoors, so nothing about the weather gets in his way."
    taken = frozenset(sentence_shapes(theirs, week_masks((starter(),))))
    result = validate_week_read(STARTER_READ, starter(), taken, call="start")
    assert any("shaped like one another page carries" in v for v in result.violations), result.violations
    # The ask shows the shape, its names, clubs and numbers as placeholders.
    assert any('"the [club] play indoors so nothing about the weather gets in his way"' in v for v in result.violations)


def _named(text: str, masks: ShapeMasks) -> set[str]:
    return {shape for shape in sentence_shapes(text, masks) if shape.startswith(NAMES_KIND)}


def test_the_same_shape_with_a_longer_name_or_another_ordinal_is_the_same_shape() -> None:
    """Lane 265: a name is one placeholder however many words it runs (a word-by-word mask counted them),
    and an ordinal's suffix goes with its number."""
    masks = ShapeMasks.of(("Puka Nacua", "Amon-Ra St. Brown"))
    ours = "Puka Nacua faces the Cardinals, who rank 26th of 32 against receivers this year."
    theirs = "Amon-Ra St. Brown faces the New York Jets, who rank 23rd of 32 against receivers this year."
    assert _named(ours, masks) == _named(theirs, masks)
    assert _named("St. Brown's matchup is the best on the board this week.", masks) == _named(
        "Nacua's matchup is the best on the board this week.", masks
    )


@pytest.mark.parametrize(
    ("ours", "theirs"),
    [
        # The Lane 265 review's H1: a club's plural possessive, straight or curled, and a player's.
        (
            "The Rams' defense allows 21 points a game to receivers this year.",
            "The Bears\u2019 defense allows 18 points a game to receivers this year.",
        ),
        (
            "Jones' role grew to 9 targets a game over his last 3 games.",
            "Nacua's role grew to 11 targets a game over his last 4 games.",
        ),
    ],
)
def test_a_possessive_name_or_club_is_its_placeholder(ours: str, theirs: str) -> None:
    masks = ShapeMasks.of(("Puka Nacua", "Aaron Jones"))
    assert _named(ours, masks) == _named(theirs, masks) != set()


def test_a_placeholder_shape_under_six_words_is_held_only_by_its_word_shape() -> None:
    """The call's vocabulary ("Start Puka Nacua in week 6.") is no placeholder shape; main's word shape, four
    words or more, still holds it, as main did."""
    masks = ShapeMasks.of(("Puka Nacua",))
    assert set(sentence_shapes("Start Puka Nacua in week 6.", masks)) == {f"{WORDS_KIND}x x x in week"}
    assert _named("Start Puka Nacua in week 6 of 2026.", masks) != set()


def test_a_lower_case_word_that_spells_a_surname_is_kept() -> None:
    masks = ShapeMasks.of(("Jordan Love",))
    assert _named("He would love a game against a soft defense this week.", masks) == {
        f"{NAMES_KIND}he would love a game against a soft defense this week"
    }


@pytest.mark.parametrize(
    ("ours", "theirs"),
    [
        # A pronoun against a name, a first name against a full one, a name off the board: main's word mask
        # equates each pair, so the check does too (the Lane 265 review's L1).
        ("He has drawn at least 9 targets in each of his last 3 games.",
         "Nacua has drawn at least 7 targets in each of his last 4 games."),
        ("Puka has drawn at least 9 targets in each of his last 3 games.",
         "Puka Nacua has drawn at least 7 targets in each of his last 4 games."),
        ("Smith has drawn at least 9 targets in each of his last 3 games.",
         "Nacua has drawn at least 7 targets in each of his last 4 games."),
    ],
)  # fmt: skip
def test_every_pair_mains_word_mask_equates_still_shares_a_shape(ours: str, theirs: str) -> None:
    masks = ShapeMasks.of(("Puka Nacua",))
    assert set(sentence_shapes(ours, masks)) & set(sentence_shapes(theirs, masks))


def test_a_call_is_required() -> None:
    assert any("no call" in v for v in validate_week_read(STARTER_READ, starter(), call=None).violations)


def test_a_number_the_sheet_never_printed_is_refused() -> None:
    text = STARTER_READ.replace("25.9 PPR points", "18.7 PPR points")
    assert any('"18.7"' in v for v in validate_week_read(text, starter(), call="start").violations)


def test_a_figure_the_page_draws_in_no_cell_is_refused() -> None:
    """Lane 100 (B17): the read quotes only the page's cells. The points the opponent allows a game, a
    full-season preseason figure and his touchdowns are on no cell, even when the facts once held them."""
    sheet = starter()
    allowed = sheet.allowed
    assert allowed is not None
    for figure in (f"{allowed.points_a_game:g}", "262.1", "9"):
        text = STARTER_READ.replace("Start him with confidence.", f"He is at {figure} points on that count. Start him.")
        hits = [v for v in week_rule_violations(text, sheet, "start") if "draws in no cell" in v]
        assert hits and f'"{figure}"' in hits[0], (figure, hits)
    # His points a game and the games behind it are the Avg cell's.
    avg = STARTER_READ.replace("Start him with confidence.", "He brings 25.9 PPR points a game. Start him.")
    assert not [v for v in week_rule_violations(avg, sheet, "start") if "draws in no cell" in v]


def test_a_cells_figure_named_as_another_cell_is_refused() -> None:
    """Lane 100 review M1: a game's 37.7 said as his points a game, where his Avg is 25.9; his rest-of-season
    figure named as such passes, another figure under that name does not."""
    sheet = starter()
    wrong = STARTER_READ.replace("Start him with confidence.", "He scores 37.7 PPR points a game. Start him.")
    assert any("as his points a game (Avg)" in v for v in week_rule_violations(wrong, sheet, "start"))
    right = STARTER_READ.replace("Start him with confidence.", "He scores 25.9 PPR points a game. Start him.")
    assert not any("a cell that prints another figure" in v for v in week_rule_violations(right, sheet, "start"))
    board = sheet.board
    assert board is not None and board.points is not None
    rest = f"{board.points:g} PPR points for the rest of the season"
    named = STARTER_READ.replace("Start him with confidence.", f"He holds {rest}. Start him.")
    assert not any("a cell that prints another figure" in v for v in week_rule_violations(named, sheet, "start"))
    off = named.replace(f"{board.points:g} PPR", "25.9 PPR")
    assert any("as his rest-of-season points" in v for v in week_rule_violations(off, sheet, "start"))


_NAMED = "a cell that prints another"


def _named_hits(sentence: str, sheet: WeekSheet, read: str = STARTER_READ, call: str = "start") -> list[str]:
    last = read.rsplit(". ", maxsplit=1)[-1]
    text = read.replace(last, f"{sentence} {last}")
    return [v for v in week_rule_violations(text, sheet, call) if _NAMED in v]


@pytest.mark.parametrize(
    ("sentence", "cell"),
    [
        ("He averages 24.1 PPR points.", "his points a game (Avg)"),
        ("His rest-of-season figure of 25.9 points stands.", "his rest-of-season points"),
        ("He put up 25.9 points in his last game.", "his last game's points (Last)"),
        ("His last game, he scored 31.2 points.", "his last game's points (Last)"),
        ("He brings 24.1 points in his next game.", "his next game's points"),
    ],
)
def test_every_drawn_cell_name_carries_its_own_figure(sentence: str, cell: str) -> None:
    """Lane 117 (B80): Avg, Rest of season, Last and his next game are checked by name before or after the
    figure, beside "a game" and "rest of season"."""
    hits = _named_hits(sentence, starter())
    assert hits and f"as {cell}" in hits[0], hits


@pytest.mark.parametrize(
    "sentence",
    [
        "He averages 25.9 PPR points.",
        "His rest-of-season figure of 230 points stands.",
        "He put up 24.1 points in his last game.",
        "He brings 18.4 points in his next game.",
        "The Cardinals rank 26th of 32 against receivers.",
    ],
)
def test_a_figure_named_as_its_own_cell_passes(sentence: str) -> None:
    assert not _named_hits(sentence, starter())


def test_the_opponents_rank_is_opp_ranks_and_a_bye_has_none() -> None:
    """Lane 117 (B80): a rank against his position is the Opp rank cell's; on his bye the sheet carries no
    opponent's rank, so any one stated is refused, and a figure named as this week's is too."""
    hits = _named_hits("The Cardinals rank 12th of 32 against receivers.", starter())
    assert hits and "Opp rank" in hits[0]
    assert _named_hits("Arizona sits 12th against receivers.", starter())
    assert not _named_hits("He ranks 8th in our rest-of-season order.", starter())
    bye = on_bye()
    assert any("Opp rank" in v for v in _named_hits("Green Bay is 12th of 32 against backs.", bye, BYE_READ, "hold"))
    assert any(
        "on a week the card shows his bye" in v
        for v in _named_hits("He has 21.3 points this week.", bye, BYE_READ, "hold")
    )
    assert any("next week" in v for v in _named_hits("He brings 21.3 points next week.", bye, BYE_READ, "hold"))
    # Review M3: for a player who plays, next week is a week the sheet carries no figure for; his next game
    # is this week's.
    assert any("next week" in v for v in _named_hits("He brings 18.4 points next week.", starter()))
    assert not _named_hits("He brings 18.4 points in his next game.", starter())
    assert not _named_hits("He brings 21.3 PPR points a game.", bye, BYE_READ, "hold")


def test_a_ranks_of_32_is_its_rank_and_no_figure() -> None:
    """Lane 117 fix round 1 (H2): "21st of 32" is the opponent's rank, the 32 its own, so Christian
    McCaffrey's sentence states one figure, his points a game."""
    sheet = replace(
        questionable(),
        name="Christian McCaffrey",
        team="SF",
        game=WeekGame(6, "ATL", home=True, kickoff=KICKOFF),
        projection=PublishedProjection(18.6, CAPTURED, None, None),
        allowed=Allowed(21, 32, 22.0, "RB", 5, LINES),
        points_per_game=19.2,
    )
    sentence = "He brings 19.2 PPR points a game, and Atlanta sits 21st of 32 against running backs."
    violations = week_rule_violations(f"{sentence} He plays. Start him.", sheet, "start")
    assert not [v for v in violations if "published projection" in v or "draws in no cell" in v], violations
    assert stated_figures(sentence, sheet.season) == [("19.2", 19.2)]


def test_the_sheet_prints_a_chance_of_rain_only_as_the_cell_names_it() -> None:
    """Lane 100 review M2 and LOW-2: below 20% the cell names no chance, so the sheet prints none; the
    weather rounds as the page's Math.round does (60.5 is 61)."""
    low = replace(questionable(), weather=Weather("outdoors", 60.5, 14.0, 10.0, "rain", FIGURES))
    text = render_week_sheet(low)
    assert "chance of rain" not in text and "61 degrees" in text
    assert "a 30% chance of rain" in render_week_sheet(questionable())


def test_a_read_is_one_paragraph_with_no_cap_on_its_figures() -> None:
    """Lane 100 (B44): one paragraph. Lane 307 retired the cap on figures with the checklist prompt."""
    four = STARTER_READ.replace(
        "Start him with confidence.",
        "He brings 25.9 PPR points a game, and the Rams are expected to score 32.5 points.",
    )
    assert not any("figures" in v for v in week_rule_violations(four, starter(), "start"))
    split = STARTER_READ.replace(" The Rams play", "\n\nThe Rams play")
    assert any("more than one paragraph" in v for v in week_rule_violations(split, starter(), "start"))


def test_the_cap_is_one_hundred_ten_words_with_no_overrun() -> None:
    """Lane 100 (B44), the cap 110 since Lane 307: at most 110 words, whatever the read was asked before."""
    padded = STARTER_READ.replace(
        "Start him with confidence.",
        "He has been the steadiest part of a passing game that runs through him on every down that matters, "
        "and nothing in the facts says that changes now that the Rams are at home. The rest of the room "
        "behind him has not moved in weeks, and the plays still run his way. Start him.",
    )
    assert len(padded.split()) > 110  # noqa: PLR2004 - the cap
    result = validate_week_read(padded, starter(), call="start")
    assert result.band_failure is not None and not result.ok


def test_the_in_season_season_read_refuses_the_draft_time_sentence() -> None:
    """Item 3: the season read keeps its place in season, and the writer's rules (never a template)
    retire "take him at pick 3": the validator and the page gate both read it as draft voice."""
    october = SeasonClock(2026, 5, (1, 4, 5), (2, 3))
    hits = time_frame_hits("Take him at pick 3 without blinking.", october)
    assert any(hit.rule.startswith("draft voice") for hit in hits)
    assert time_frame_hits("Take him at pick 3 without blinking.", SeasonClock(2026)) == []


def test_a_bare_week_beside_a_figure_takes_the_season_and_never_the_figure() -> None:
    """The recorded run's second draft for Jahmyr Gibbs: "in week 5 and 41.4 PPR points" read as a week
    list made "2026.4", a figure no sheet prints."""
    text = "Lions bye in week 6 of 2026. He had 37.7 PPR points in week 5 and 41.4 PPR points in week 3."
    assert with_season(text, 2026).endswith("in week 5 of 2026 and 41.4 PPR points in week 3 of 2026.")


# The re-review's F1: the double negations and the phrasings the first list missed. The judge
# (`test_week_read_judge`) must refuse each too; this is the list's share.
REVIEW_START_PHRASINGS = (
    "There's no reason not to start him this week.",
    "Don't hesitate to start Gibbs in week 7 of 2026.",
    "You can't go wrong if you start him.",
    "Nothing should stop you from starting him.",
    "Fire him up.",
    "Ride with Gibbs this week.",
    "Go with him this week.",
    "Slide him into your flex this week.",
    "Keep him active this week.",
    "Never bench him this week.",
    "Don't sit him this week.",
    "He's a locked-in starter for you.",
    "He belongs in your lineup this week, nothing changes.",
)


@pytest.mark.parametrize("advice", REVIEW_START_PHRASINGS)
@pytest.mark.parametrize("status", [None, "doubtful"])
def test_the_list_refuses_every_start_phrasing_the_re_review_found(advice: str, status: str | None) -> None:
    sheet = on_bye() if status is None else replace(on_bye(), bye=False, status=Status(status, REPORT))
    assert start_advice_in(advice, sheet.name) is not None, advice
    assert any("recommends starting" in v for v in week_rule_violations(advice, sheet, "hold")), advice


def test_a_wait_and_see_read_calls_itself_hold() -> None:
    """The re-review's F4: Lamb's "Wait on his status ... before you start him" is a hold."""
    text = "Wait on his status right up to Sunday night before you start him."
    assert any("calls itself hold" in v for v in week_rule_violations(text, questionable(), "start"))
    assert not any("calls itself hold" in v for v in week_rule_violations(text, questionable(), "hold"))


def test_a_club_is_named_by_name_never_by_its_code() -> None:
    """The re-review's F7: "ARI", "BUF" and "LAR" in the recorded reads."""
    assert any('code ("ARI")' in v for v in week_rule_violations("The matchup with ARI is soft.", starter()))
    assert not any(
        "code" in v for v in week_rule_violations("The matchup with Arizona is soft. He is a WR2.", starter())
    )


@pytest.mark.parametrize(
    ("rank", "words"),
    [
        (1, "the fewest"),
        (2, "the second fewest"),
        (4, "among the fewest"),
        (5, None),
        (16, None),
        (28, None),
        (29, "among the most"),
        (31, "the second most"),
        (32, "the most"),
    ],
)
def test_a_rank_is_said_by_the_footer_s_count_1st_the_fewest(rank: int, words: str | None) -> None:
    """Lane 139 (C01): "the most" only at 32nd of 32, "the second most" at 31st, "among the most" from 29th."""
    assert rank_words(rank, 32) == words


_GIBBS_OPENER = "Green Bay has {said} PPR points to running backs, 31st of 32 through week 6 of 2026."


@pytest.mark.parametrize(
    ("said", "refused"),
    [
        ("allowed the most", True),
        ("allowed the fewest", True),
        ("allowed among the fewest", True),
        ("allowed the second most", False),
        ("allowed the second-most", False),
        ("allowed among the most", False),
    ],
)
def test_a_points_superlative_follows_the_opponent_s_rank(said: str, refused: bool) -> None:
    """Lane 139 (C01): the sentence the verb rests on calls 31st of 32 "the second most", never "the most"."""
    sheet = replace(starter(), allowed=Allowed(31, 32, 30.2, "RB", 6, LINES))
    found = [v for v in week_rule_violations(_GIBBS_OPENER.format(said=said), sheet) if "Opp rank counts" in v]
    assert bool(found) is refused
    if refused:
        assert '31 of 32 is "the second most"' in found[0]


def test_a_superlative_on_a_rank_between_the_ends_is_refused_with_its_rank() -> None:
    """A rank between the ends is said by its rank: 26th of 32 is neither the most nor among the fewest."""
    found = [
        v
        for v in week_rule_violations("Arizona has allowed among the most PPR points to receivers.", starter())
        if "Opp rank counts" in v
    ]
    assert found and "26 of 32 is said by its rank" in found[0]


def test_the_sheet_hands_the_writer_the_rank_in_words() -> None:
    """The writer is told the words its rank is said with (Lane 139, C01)."""
    sheet = replace(starter(), allowed=Allowed(31, 32, 30.2, "WR", 6, LINES))
    assert 'say it as "the second most"' in render_week_sheet(sheet)
    assert "say it by its rank" in render_week_sheet(starter())


def test_a_superlative_of_his_own_is_not_read_as_the_opponent_s_rank() -> None:
    """Review LOW-1: only a sentence about what an opponent allows is held to Opp rank."""
    text = "Nacua has scored the most PPR points of any Rams receiver this season."
    assert not any("Opp rank counts" in v for v in week_rule_violations(text, starter()))


def test_a_short_list_names_the_nearer_end() -> None:
    """Review LOW-2: 1st of 4 is the fewest, never among the most."""
    assert rank_words(1, 4) == "the fewest"
    assert rank_words(4, 4) == "the most"


@pytest.fixture(autouse=True)
def _main_sheet() -> Iterator[None]:
    """These tests pin main's sheet, its lines and the reads written from it (Lane 300 turned the angles on; the
    angles' sheet is `test_week_read_angles`'s)."""
    with main_sheet():
        yield


# Lane 300 fix round 4: a name's suffix or initials never end a sentence, and the opener knows the call's forms.
@pytest.mark.parametrize(
    ("text", "first"),
    [
        (
            "Harold Fannin Jr. is listed first for the Browns. Start him.",
            "Harold Fannin Jr. is listed first for the Browns.",
        ),
        ("Kyle Pitts Sr. leads the Falcons in targets. Sit him.", "Kyle Pitts Sr. leads the Falcons in targets."),
        ("Michael Pittman Jr. is on injured reserve. Find a fill-in.", "Michael Pittman Jr. is on injured reserve."),
        ("Aaron Jones Sr. carries 60% of the work. Start him.", "Aaron Jones Sr. carries 60% of the work."),
        ("J.K. Dobbins runs for the Broncos. Start him.", "J.K. Dobbins runs for the Broncos."),
        ("Amon-Ra St. Brown draws the targets. Start him.", "Amon-Ra St. Brown draws the targets."),
    ],
)
def test_a_names_suffix_or_initials_never_end_a_sentence(text: str, first: str) -> None:
    assert split_sentences(text)[0] == first


def test_a_suffix_before_a_capital_still_ends_its_sentence() -> None:
    assert split_sentences("Start Michael Pittman Jr. He is back this week.") == [
        "Start Michael Pittman Jr.",
        "He is back this week.",
    ]
