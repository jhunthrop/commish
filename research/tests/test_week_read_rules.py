"""Lane 72, the week-ahead read: its sheet, its caption and its rules (fix round 1 included).

The sheet carries only stamped facts, each line with its read, and names the projection as published,
never ours; the caption is the page's "Written Fri 9:00 pm Central, for week 6"; the read is held to the
writer's rules and to the week's own: no betting or trading word, no provider or rival product, no tip;
the published projection named with its exact figure and nothing else put on it (H4); a player who may
not be started never recommended, by his call or in any wording (H2); every figure with its unit (M1);
his place in our order said with which order (M2); the season named once (the ruling on L5); three to
five sentences; no sentence shape another page carries (M4). The season read in season refuses the
draft-time sentence."""

from dataclasses import replace
from datetime import UTC, datetime

import pytest

from research.capsules.narrative import ShapeMasks
from research.capsules.season_voice import SeasonClock, time_frame_hits
from research.capsules.voice_rules import gate_hits
from research.capsules.week.caption import written_caption
from research.capsules.week.rank_words import rank_words
from research.capsules.week.render import render_week_facts_block, render_week_sheet
from research.capsules.week.rules import WEEK_NEVER_WORDS, stated_figures, week_rule_violations
from research.capsules.week.sheet import (
    Allowed,
    BoardPlace,
    DepthPlace,
    PublishedProjection,
    Status,
    Weather,
    WeekGame,
    WeekSheet,
)
from research.capsules.week.start_advice import start_advice_in
from research.capsules.week.validate import sentence_shapes, validate_week_read, week_masks, with_season
from research.tests.week_read_fixtures import (
    BEFORE,
    BOARD,
    CAPTURED,
    FIGURES,
    KICKOFF,
    LINES,
    REPORT,
    WRITTEN_AT,
    on_bye,
    on_injured_reserve,
    questionable,
    starter,
)

STARTER_READ = (
    "Puka Nacua gets Arizona at home in week 6 of 2026, and the Cardinals rank 26th of 32 against receivers. "
    "The published projection has him at 18.4 points, up 0.5 points from the published figure before it. "
    "The Rams play indoors, so nothing about the weather gets in his way. Start him with confidence."
)
BYE_READ = (
    "Jahmyr Gibbs and the Lions are on their bye in week 6 of 2026, so he does not play this week. Keep him "
    "on your roster, because his 21.3 PPR points a game over 5 games make him a weekly starter. Fill his spot "
    "with a back who has a game, and bring Gibbs straight back for week 7 against Green Bay."
)


def _words(text: str) -> list[str]:
    return [rule.name for rule in WEEK_NEVER_WORDS if rule.pattern.search(text)]


def test_the_sheet_names_the_week_the_projection_as_published_and_the_order() -> None:
    sheet = render_week_sheet(starter())
    assert "week 6 of 2026" in sheet
    assert "published projection" in sheet.lower() and "not ours" in sheet
    assert "18.4 points" in sheet and "+0.5" in sheet
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
        if not line.startswith("Injury report"):
            assert "(as of " in line, line
    assert "on Friday's report" in text
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
    # The change is the card's Delta Proj cell; the figure before it and the change since our last read are
    # in no cell, so the sheet holds neither (Lane 100, B17).
    assert "-1.8" in sheet and "17 points" not in sheet and "since our last read" not in sheet.lower()
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


def test_a_tip_is_refused() -> None:
    result = validate_week_read(f"{STARTER_READ} Pro tip: check the inactives.", starter(), call="start")
    assert any("tip" in v for v in result.violations), result.violations


def test_the_projection_is_never_called_ours() -> None:
    text = STARTER_READ.replace("The published projection has him at", "Our projection has him at")
    assert any("ours" in v for v in week_rule_violations(text, starter()))


def test_the_projection_figure_needs_the_word_published() -> None:
    text = STARTER_READ.replace(
        "The published projection has him at 18.4 points, up 0.5 points from the published figure before it.",
        "He is projected for 18.4 points this week.",
    )
    violations = week_rule_violations(text, starter())
    assert any("without saying it is published" in v for v in violations), violations
    assert any("never names the published projection" in v for v in violations), violations


def test_another_figure_put_on_the_published_projection_is_refused() -> None:
    """The review's H4: 25.9 is his points a game, grounded but not the projection."""
    text = STARTER_READ.replace("has him at 18.4 points", "has him at 25.9 points")
    violations = validate_week_read(text, starter(), call="start").violations
    assert any("puts 25.9 on the published projection" in v for v in violations), violations


def test_the_published_projection_named_without_its_figure_is_refused() -> None:
    text = STARTER_READ.replace(
        "The published projection has him at 18.4 points, up 0.5 points from the published figure before it.",
        "The published projection likes him a lot this week.",
    )
    violations = validate_week_read(text, starter(), call="start").violations
    assert any("without its figure" in v for v in violations), violations


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


def test_a_figure_without_its_unit_is_refused_and_week_numbers_and_clock_times_are_not_figures() -> None:
    """The review's M1, in the recorded reads' own words."""
    bare = "The expected score has the Rams at 32 to Arizona's 19.5 this week."
    assert any('"32", "19.5" without its unit' in v for v in week_rule_violations(bare, starter()))
    honest = "The Rams are expected to score 32.5 points in week 6 of 2026, kicking off at 3:05 pm Central."
    assert not any("without its unit" in v for v in week_rule_violations(honest, starter()))


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


def test_a_bare_week_before_the_season_is_named_is_refused() -> None:
    text = STARTER_READ.replace("in week 6 of 2026", "in week 6").replace("Start him", "Start him in 2026")
    assert not validate_week_read(text, starter(), call="start").ok


@pytest.mark.parametrize("count", [2, 6])
def test_a_read_runs_three_to_five_sentences(count: int) -> None:
    sentences = [
        "Puka Nacua faces Arizona at home in week 6 of 2026.",
        "The published projection has him at 18.4 points.",
        "The Cardinals allow receivers 41.3 PPR points a game.",
        "The Rams are expected to score 32.5 points.",
        "He has 25.9 PPR points a game.",
        "Start him every week.",
    ]
    assert any("sentences" in v for v in week_rule_violations(" ".join(sentences[:count]), starter()))


def test_a_sentence_shaped_like_one_on_another_page_is_refused() -> None:
    """The review's M4: the same skeleton with another name and other numbers is the same sentence."""
    theirs = "The Bears play indoors, so nothing about the weather gets in his way."
    taken = frozenset(sentence_shapes(theirs, week_masks((starter(),))))
    result = validate_week_read(STARTER_READ, starter(), taken, call="start")
    assert any("shaped like one another page carries" in v for v in result.violations), result.violations
    # The ask shows the shape, its names, clubs and numbers as placeholders.
    assert any('"the [club] play indoors so nothing about the weather gets in his way"' in v for v in result.violations)


def test_the_same_shape_with_a_longer_name_or_another_ordinal_is_the_same_shape() -> None:
    """Lane 265: a name is one placeholder however many words it runs (a word-by-word mask counted them),
    and an ordinal's suffix goes with its number."""
    masks = ShapeMasks.of(("Puka Nacua", "Amon-Ra St. Brown"))
    ours = "Puka Nacua faces the Cardinals, who rank 26th of 32 against receivers this year."
    theirs = "Amon-Ra St. Brown faces the New York Jets, who rank 23rd of 32 against receivers this year."
    assert set(sentence_shapes(ours, masks)) == set(sentence_shapes(theirs, masks))
    assert set(sentence_shapes("St. Brown's matchup is the best on the board this week.", masks)) == set(
        sentence_shapes("Nacua's matchup is the best on the board this week.", masks)
    )


def test_a_shape_under_six_words_is_the_calls_vocabulary_and_never_held() -> None:
    masks = ShapeMasks.of(("Puka Nacua",))
    assert sentence_shapes("Start Puka Nacua in week 6.", masks) == {}
    assert sentence_shapes("Start Puka Nacua in week 6 of 2026.", masks) != {}


def test_a_lower_case_word_that_spells_a_surname_is_kept() -> None:
    masks = ShapeMasks.of(("Jordan Love",))
    assert next(iter(sentence_shapes("He would love a game against a soft defense this week.", masks))).startswith(
        "he would love"
    )


def test_a_call_is_required() -> None:
    assert any("no call" in v for v in validate_week_read(STARTER_READ, starter(), call=None).violations)


def test_a_number_the_sheet_never_printed_is_refused() -> None:
    text = STARTER_READ.replace("18.4 points", "18.7 points")
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


def test_a_ranks_of_32_is_never_a_second_figure_on_the_projection() -> None:
    """Lane 117 fix round 1 (H2): "21st of 32" is the opponent's rank, the 32 its own, so Christian
    McCaffrey's sentence puts nothing on the published projection and states one figure."""
    sheet = replace(
        questionable(),
        name="Christian McCaffrey",
        team="SF",
        game=WeekGame(6, "ATL", home=True, kickoff=KICKOFF),
        projection=PublishedProjection(18.6, CAPTURED, None, None),
        allowed=Allowed(21, 32, 22.0, "RB", 5, LINES),
    )
    sentence = "The published projection has him at 18.6 points, and Atlanta sits 21st of 32 against running backs."
    violations = week_rule_violations(f"{sentence} He plays. Start him.", sheet, "start")
    assert not [v for v in violations if "on the published projection" in v or "draws in no cell" in v], violations
    assert stated_figures(sentence, sheet.season) == [("18.6", 18.6)]


def test_the_sheet_prints_a_chance_of_rain_only_as_the_cell_names_it() -> None:
    """Lane 100 review M2 and LOW-2: below 20% the cell names no chance, so the sheet prints none; the
    weather rounds as the page's Math.round does (60.5 is 61)."""
    low = replace(questionable(), weather=Weather("outdoors", 60.5, 14.0, 10.0, "rain", FIGURES))
    text = render_week_sheet(low)
    assert "chance of rain" not in text and "61 degrees" in text
    assert "a 30% chance of rain" in render_week_sheet(questionable())


def test_a_read_states_at_most_three_figures_and_one_paragraph() -> None:
    """Lane 100 (B44): the cells carry his numbers; the read says what they cannot, in one paragraph."""
    four = STARTER_READ.replace(
        "Start him with confidence.",
        "He brings 25.9 PPR points a game, and the Rams are expected to score 32.5 points.",
    )
    assert any("states 4 figures" in v for v in week_rule_violations(four, starter(), "start"))
    split = STARTER_READ.replace(" The Rams play", "\n\nThe Rams play")
    assert any("more than one paragraph" in v for v in week_rule_violations(split, starter(), "start"))


def test_the_cap_is_ninety_five_words_with_no_overrun() -> None:
    """Lane 100 (B44), the cap 95 since Lane 117 fix round 3: at most 95 words, whatever the read was asked
    before."""
    padded = STARTER_READ.replace(
        "Start him with confidence.",
        "He has been the steadiest part of a passing game that runs through him on every down that matters, "
        "and nothing in the facts says that changes now that the Rams are at home. The rest of the room "
        "behind him has not moved in weeks, and the plays still run his way. Start him.",
    )
    assert len(padded.split()) > 95  # noqa: PLR2004 - the cap
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


@pytest.mark.parametrize(
    "sentence",
    [
        "The published projection has him at 18.4 points, which looks light.",
        "The published projection of 18.4 points is too low for him.",
        "The published projection has him at only 18.4 points.",
        "The published projection, a generous 18.4 points, says enough.",
    ],
)
def test_the_published_projection_is_stated_and_never_graded(sentence: str) -> None:
    """The re-review's F2: no round of ours has passed to back a judgment of the week's number."""
    text = STARTER_READ.replace(
        "The published projection has him at 18.4 points, up 0.5 points from the published figure before it.", sentence
    )
    assert any("grades the published projection" in v for v in week_rule_violations(text, starter(), "start"))


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


@pytest.mark.parametrize(
    "opener",
    [
        "Gibbs runs into the kind of matchup a manager hopes for: Green Bay ranks 31st of 32 against running backs.",
        "Sunday brings a fine afternoon for Puka Nacua and the Rams.",
    ],
)
def test_the_read_leads_with_the_call_or_the_fact(opener: str) -> None:
    """Lane 139 (C25): no scene-setting opener; the first sentence carries the call, a figure or his status."""
    text = f"{opener} {STARTER_READ}"
    assert any("opens" in v for v in week_rule_violations(text, starter(), "start"))


@pytest.mark.parametrize(
    "opener",
    [
        "Start Puka Nacua this week.",
        "Arizona ranks 26th of 32 against receivers, the softest matchup he has had.",
        "Puka Nacua is Questionable on the Tuesday-night list.",
        "The Lions are off in week 6 of 2026, so Gibbs does not play.",
    ],
)
def test_a_read_that_opens_on_the_call_the_fact_or_his_status_is_taken(opener: str) -> None:
    assert not any("opens" in v for v in week_rule_violations(opener, starter(), "start"))


def test_a_change_under_half_a_point_is_no_cell_a_read_may_quote() -> None:
    """Lane 139 (C21): the Proj change tile shows no move under 0.5, so neither the sheet nor a read says one."""
    sheet = replace(starter(), projection=PublishedProjection(18.4, CAPTURED, 18.3, BEFORE))
    assert "It moved" not in render_week_sheet(sheet)
    text = "Puka Nacua's published projection is 18.4 points, up 0.1 points since the figure before it."
    assert any("a figure the page draws in no cell" in v for v in week_rule_violations(text, sheet, "start"))
    assert not any("no cell" in v for v in week_rule_violations(text.replace("0.1", "0.5"), starter(), "start"))


@pytest.mark.parametrize(
    "opener",
    [
        "Nacua is listed Out on Friday's report.",
        "Puka Nacua is healthy and leads the Rams in targets again.",
        "Puka Nacua is on injured reserve and does not play.",
        "Keep him on your bench this week.",
    ],
)
def test_a_status_first_opener_is_taken_for_every_status(opener: str) -> None:
    """Review MEDIUM-1: the status words are the sheet's own (`STATUS_WORDS`), Out among them."""
    assert not any("opens" in v for v in week_rule_violations(opener, starter(), "start"))


def test_a_loose_call_word_does_not_carry_a_scene_set_opener() -> None:
    """Review MEDIUM-1: "sits first among" is no call."""
    text = "Gibbs sits first among Detroit running backs as the week opens."
    assert any("opens" in v for v in week_rule_violations(text, starter(), "start"))
    # Review LOW-11: a verb off the call list is no call, even said of a club.
    text = "The Rams play Arizona at home this week in a game that suits him."
    assert any("opens" in v for v in week_rule_violations(text, starter(), "start"))
    assert not any("opens" in v for v in week_rule_violations("Trust Nacua this week.", starter(), "start"))


def test_a_superlative_of_his_own_is_not_read_as_the_opponent_s_rank() -> None:
    """Review LOW-1: only a sentence about what an opponent allows is held to Opp rank."""
    text = "Nacua has scored the most PPR points of any Rams receiver this season."
    assert not any("Opp rank counts" in v for v in week_rule_violations(text, starter()))


def test_a_short_list_names_the_nearer_end() -> None:
    """Review LOW-2: 1st of 4 is the fewest, never among the most."""
    assert rank_words(1, 4) == "the fewest"
    assert rank_words(4, 4) == "the most"
