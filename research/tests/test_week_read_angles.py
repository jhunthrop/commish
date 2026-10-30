"""Lane 300: each week read is built from his usage facts in full, each with how unusual it is, and the generic facts
reach the writer only when they bite (`capsules.week.angles`, `bites`, `render`, `prompt`, `cells`)."""

from collections.abc import Iterator
from dataclasses import replace

import pytest

from research.capsules.week import angles as angles_module
from research.capsules.week.angle_candidates import AngleFigure, Basis, Measure
from research.capsules.week.angles import (
    FAR_FROM,
    ORDINARY_UNDER,
    Angle,
    AnglePlayer,
    board_angles,
    place_words,
    summary,
    unusual_words,
)
from research.capsules.week.bites import RANK_EDGE, depth_bites, rank_bites, weather_bites
from research.capsules.week.prompt import (
    ANGLES_REMINDER,
    WEEK_RULES,
    WEEK_RULES_ANGLES,
    week_correction,
    week_rules,
)
from research.capsules.week.render import ANGLES_HEAD, NO_ANGLE, render_week_sheet
from research.capsules.week.rules import ANGLE_FIGURES, MAX_FIGURES, max_figures
from research.capsules.week.sheet import Allowed, DepthPlace, Status, Weather, WeekSheet, week_name_ledger
from research.capsules.week.usage_reads import UsageWeek
from research.capsules.week.validate import validate_week_read
from research.capsules.week.voices import VOICES, _brief
from research.explore.writer_bakeoff.angles_compare import categories
from research.explore.writer_bakeoff.blind import Masker, answer_letter
from research.nightly.week_reads import CHARS_PER_TOKEN, WORST_PROMPT_TOKENS
from research.tests.test_week_read_writer import BOUND_MARGIN, worst_correction
from research.tests.week_read_fixtures import heaviest, main_sheet, starter


@pytest.fixture
def angles_off() -> Iterator[None]:
    with main_sheet():
        yield


@pytest.fixture
def angles_on() -> Iterator[None]:
    """The switch on for the test (a run's arm sets it the same way)."""
    held = angles_module.ANGLES_ON
    setattr(angles_module, "ANGLES_ON", True)  # noqa: B010
    yield
    setattr(angles_module, "ANGLES_ON", held)  # noqa: B010


def _week(week: int, team: str = "LAR", *, snaps: float = 60, targets: float = 8, carries: float = 0) -> UsageWeek:
    return UsageWeek(
        week=week,
        team=team,
        snaps=snaps,
        team_snaps=65,
        targets=targets,
        team_targets=36,
        carries=carries,
        team_carries=25,
        air_yards=targets * 9,
        team_air_yards=300,
        air_yard_targets=targets,
        red_zone=1,
        team_red_zone=6,
        touchdowns=0,
    )


def _receiver(n: int, targets: float, weeks: int = 7, team: str = "LAR", out: str | None = None) -> AnglePlayer:
    usage = tuple(_week(w, team, targets=targets) for w in range(1, weeks + 1))
    return AnglePlayer(
        f"00-{n:07d}",
        f"Receiver Number{n}",
        "WR",
        team,
        usage,
        tuple((w, 10.0 + w) for w in range(1, weeks + 1)),
        (),
        out,
    )


def _board() -> list[AnglePlayer]:
    return [_receiver(n, 3 + n % 7, team=("KC" if n % 2 else "BUF")) for n in range(20)]


def test_a_receiver_far_above_his_peers_leads_on_his_target_share() -> None:
    star = _receiver(99, 14, team="LAR")
    got = board_angles([*_board(), star], {}, 8)[star.player_id]
    assert got and got[0].key in {"target_share", "air_yards_share", "snap_share"}
    lead = next(a for a in got if a.key == "target_share")
    assert (
        "39% of the Rams' targets in his games this season, the highest among the wide receivers we rank" in lead.text
    )
    assert AngleFigure(39.0, Measure.TARGETS) in lead.figures  # 14 of 36 targets
    assert lead.places == (("the highest", "among the wide receivers we rank"),)


def test_a_thin_basis_is_never_carried() -> None:
    rookie = _receiver(98, 14, weeks=2)
    assert board_angles([*_board(), rookie], {}, 8)[rookie.player_id] == ()


def test_a_teammate_ruled_out_names_him_and_his_share() -> None:
    gone = _receiver(97, 12, team="LAR", out="Out")
    mate = _receiver(96, 5, team="LAR")
    got = board_angles([*_board(), gone, mate], {}, 8)[mate.player_id]
    vacated = next(a for a in got if a.key == "vacated")
    assert vacated.names == (gone.name,)
    assert vacated.text.startswith(f"Vacated work: {gone.name} is Out this week, and he drew 33% of the Rams' targets")
    assert "targets in his games this season" in vacated.text


def test_a_teammate_out_for_weeks_vacates_nothing_new() -> None:
    long_gone = replace(_receiver(97, 12, weeks=3, team="LAR", out="on injured reserve"))
    mate = _receiver(96, 5, team="LAR")
    got = board_angles([*_board(), long_gone, mate], {}, 8)[mate.player_id]
    assert all(a.key != "vacated" for a in got)


def test_the_club_expected_score_is_an_angle_only_at_the_weeks_edges() -> None:
    clubs = {
        code: 20.0 + i for i, code in enumerate(("BUF", "KC", "LAR", "DAL", "SF", "DET", "MIA", "NYJ", "PHI", "SEA"))
    }
    top = _receiver(95, 5, team="SEA")
    middle = _receiver(94, 5, team="SF")
    got = board_angles([*_board(), top, middle], clubs, 8)
    assert any(a.key == "expected" and "the highest of the week" in a.text for a in got[top.player_id])
    assert all(a.key != "expected" for a in got[middle.player_id])


def _angle(key: str, score: float) -> Angle:
    return Angle(key, f"{key}.", (AngleFigure(1.0, Measure.SNAPS),), (), score, Basis(5, 100, "snaps"))


def test_the_summary_carries_every_fact_once_most_unusual_first() -> None:
    """The founder's direction (fix round 2): every fact, ordinary ones too, for the writer to weigh."""
    facts = [_angle("target_share", 2.0), _angle("target_trend", 1.5), _angle("snap_share", 0.2), _angle("spread", 1.1)]
    assert [a.key for a in summary([*facts, _angle("spread", 0.5)])] == [
        "target_share",
        "target_trend",
        "spread",
        "snap_share",
    ]


def test_a_facts_unusualness_is_said_in_plain_words() -> None:
    assert unusual_words(ORDINARY_UNDER - 0.01, "WR") == "ordinary for a wide receiver"
    assert unusual_words(ORDINARY_UNDER, "TE") == "out of the ordinary for a tight end"
    assert unusual_words(FAR_FROM, "RB") == "far out of the ordinary for a running back"
    assert unusual_words(0.1, "WR", club=True) == "ordinary this week"


def test_an_ordinary_share_reaches_the_sheet_with_its_words() -> None:
    middling = _receiver(93, 6)
    got = board_angles([*_board(), middling], {}, 8)[middling.player_id]
    share = next(a for a in got if a.key == "target_share")
    assert share.text.endswith("(ordinary for a wide receiver).")


def test_place_words_count_from_the_nearer_end() -> None:
    pool = [float(v) for v in range(10)]
    assert place_words(9.0, pool, ("highest", "lowest")) == "the highest"
    assert place_words(7.0, pool, ("highest", "lowest")) == "the 3rd-highest"
    assert place_words(1.0, pool, ("deepest", "shortest")) == "the 2nd-shortest"


def test_weather_bites_on_wind_rain_or_snow_and_never_under_a_roof() -> None:
    sheet = starter()
    outdoors = Weather("outdoors", 50.0, 14.9, 10.0, "rain", None)
    assert not weather_bites(replace(sheet, weather=outdoors))
    assert weather_bites(replace(sheet, weather=replace(outdoors, wind_mph=15.0)))
    assert weather_bites(replace(sheet, weather=replace(outdoors, precipitation_chance=60.0)))
    assert not weather_bites(replace(sheet, weather=replace(outdoors, precipitation_chance=59.0)))
    assert weather_bites(
        replace(sheet, weather=replace(outdoors, precipitation_chance=30.0, precipitation_kind="snow"))
    )
    assert not weather_bites(replace(sheet, weather=Weather("dome", None, 30.0, 90.0, "snow", None)))


def test_the_rank_bites_at_the_four_either_end() -> None:
    def at(rank: int) -> Allowed:
        return Allowed(rank, 32, 20.0, "WR", 7, starter().written_at)

    assert rank_bites(at(RANK_EDGE)) and rank_bites(at(32 - RANK_EDGE + 1))
    assert not rank_bites(at(RANK_EDGE + 1)) and not rank_bites(at(32 - RANK_EDGE))


def test_the_depth_chart_bites_on_a_split_or_a_fresh_move() -> None:
    sheet = starter()
    assert not depth_bites(sheet)
    assert depth_bites(replace(sheet, depth=DepthPlace(1.0, (("Davante Adams", 1.0),))))
    fresh = DepthPlace(2.0, (("Davante Adams", 1.0),), released_at=sheet.written_at)
    assert depth_bites(replace(sheet, depth=fresh, depth_moved_from=1.0))
    stale = replace(fresh, released_at=sheet.written_at.replace(month=9))
    assert not depth_bites(replace(sheet, depth=stale, depth_moved_from=1.0))


_TARGETS = Angle(
    "target_share",
    "Targets: 32% of the Rams' targets in his games this season, the 3rd-highest among the wide receivers we rank.",
    (AngleFigure(32.0, Measure.TARGETS),),
    (),
    2.2,
    Basis(5, 48, "targets"),
    (("the 3rd-highest", "among the wide receivers we rank"),),
)
_VACATED = Angle(
    "vacated",
    "Vacated work: Tutu Atwell is Out this week, and he drew 20% of the Rams' targets in his games this season.",
    (AngleFigure(20.0, Measure.TARGETS),),
    ("Tutu Atwell",),
    2.0,
    Basis(6, 40, "targets"),
)


def _angled() -> WeekSheet:
    return replace(starter(), angles=(_TARGETS, _VACATED))


@pytest.mark.usefixtures("angles_on")
def test_the_sheet_carries_every_fact_with_the_words_that_say_whether_it_bites() -> None:
    """Fix round 2 (ruling 2): the generic facts reach the writer below their lines too, said as ordinary."""
    text = render_week_sheet(_angled())
    assert ANGLES_HEAD in text and f"1. {_TARGETS.text}" in text and f"2. {_VACATED.text}" in text
    assert "Under a roof, the weather does not bite." in text
    assert "Neither among the week's highest nor its lowest: ordinary, it does not bite." in text
    assert "Unchanged: ordinary, it does not bite." in text
    # 26th of 32 is outside the four either end; 29th of 32 is inside.
    assert "In the middle of the league: an ordinary matchup, it does not bite." in text
    biting = replace(_angled(), allowed=Allowed(29, 32, 41.3, "WR", 5, starter().written_at))
    assert "Within 4 of either end of the league: it bites." in render_week_sheet(biting)
    assert NO_ANGLE in render_week_sheet(starter())


@pytest.mark.usefixtures("angles_off")
def test_with_the_switch_off_the_sheet_is_mains() -> None:
    text = render_week_sheet(_angled())
    assert ANGLES_HEAD not in text
    assert "Expected points:" in text and "Depth chart" in text and "ARI against WRs" in text


@pytest.mark.usefixtures("angles_on")
def test_an_angles_figures_and_names_are_the_reads_to_quote() -> None:
    sheet = _angled()
    assert "Tutu Atwell" in week_name_ledger(sheet)
    read = (
        "Puka Nacua draws 32% of the Rams' targets, and that is before the bump. Tutu Atwell is Out this week, "
        "and his 20% of the Rams' targets has to go somewhere in week 6 of 2026. Nacua is the obvious home for it "
        "against Arizona. Start him."
    )
    assert validate_week_read(read, sheet, call="start").ok
    made_up = read.replace("32%", "37%")
    assert not validate_week_read(made_up, sheet, call="start").ok


def test_a_sheet_with_angles_may_state_one_figure_more() -> None:
    assert max_figures(starter()) == MAX_FIGURES
    assert max_figures(_angled()) == MAX_FIGURES + ANGLE_FIGURES


@pytest.mark.usefixtures("angles_on")
def test_the_prompt_and_the_correction_carry_the_angles() -> None:
    assert week_rules() == WEEK_RULES_ANGLES
    assert "Never tour the list." in WEEK_RULES_ANGLES and "Never tour the list." not in WEEK_RULES
    assert "Pick the two or three facts" not in WEEK_RULES_ANGLES
    correction = week_correction(_angled(), "A read.", (), ())
    assert ANGLES_REMINDER in correction and _TARGETS.text in correction


@pytest.mark.usefixtures("angles_off")
def test_with_the_switch_off_the_prompt_is_mains() -> None:
    assert week_rules() == WEEK_RULES
    assert ANGLES_REMINDER not in week_correction(_angled(), "A read.", (), ())


def test_a_player_who_cannot_play_gets_no_angle_line() -> None:
    out = replace(_angled(), status=Status("out", starter().status.captured_at))
    with_switch = angles_module.ANGLES_ON
    setattr(angles_module, "ANGLES_ON", True)  # noqa: B010
    try:
        assert ANGLES_HEAD not in render_week_sheet(out) and NO_ANGLE not in render_week_sheet(out)
    finally:
        setattr(angles_module, "ANGLES_ON", with_switch)  # noqa: B010


def test_the_blind_judge_masks_names_clubs_and_figures() -> None:
    masker = Masker.of(["Puka Nacua", "Davante Adams"])
    masked = masker.mask("Nacua took 32% of the Rams' targets while Davante Adams sat, 21.8 points in week 7.")
    assert masked == "[player] took #% of the [club] targets while [player] sat, # points in week #."
    assert answer_letter("C") == "C" and answer_letter("The answer is B.") == "B" and answer_letter("none") is None


def test_the_category_tally_counts_mentions_and_where_they_do_not_bite() -> None:
    reads = [
        {"text": "A 63% chance of rain hits Sunday.", "bites": {"weather": False, "rank": False, "depth": False}},
        {"text": "He sits first among the Rams receivers.", "bites": {"weather": False, "rank": False, "depth": True}},
        {
            "text": "Arizona allows the most points to receivers.",
            "bites": {"weather": False, "rank": True, "depth": False},
        },
    ]
    got = categories(reads)
    assert got["weather"]["mentions"] == 1 and got["weather"]["where_it_does_not_bite"] == 1
    assert got["depth"]["mentions"] == 1 and got["depth"]["where_it_does_not_bite"] == 0
    assert got["rank"]["mentions"] == 1 and got["rank"]["bites_on_sheets"] == 1


@pytest.mark.usefixtures("angles_on")
def test_the_matchup_voice_leans_on_the_angle_unless_the_rank_bites() -> None:
    matchup = next(v for v in VOICES if v.key == "matchup")
    verdict = next(v for v in VOICES if v.key == "verdict")
    sheet = _angled()  # 26th of 32 does not bite
    assert _brief(matchup, sheet)[0] == matchup.angles_brief
    biting = replace(sheet, allowed=Allowed(30, 32, 41.3, "WR", 5, sheet.written_at))
    assert _brief(matchup, biting)[0] == matchup.brief
    assert _brief(verdict, sheet)[0] == verdict.angles_brief
    assert _brief(verdict, starter())[0] == verdict.brief  # no angles, its own brief


def _long_angle(n: int) -> Angle:
    mate = f"Jean-Baptiste Montgomery-Smith Teammate{n} Jr."
    text = (
        f"Vacated work: {mate} is on the physically unable to perform list this week, and he drew 33% of the "
        "Commanders' targets this season, the 2nd-highest among the wide receivers we rank."
    )
    return Angle("vacated", text, (AngleFigure(33.0, Measure.TARGETS),), (mate,), 3.0, Basis(7, 80, "targets"))


@pytest.mark.usefixtures("angles_on")
def test_the_heaviest_correction_with_three_angles_stays_inside_the_prompt_bound() -> None:
    """Ruling 3: the correction carries the angles inside `WORST_PROMPT_TOKENS`, at the bound's margin."""
    playing = Status("questionable", heaviest().status.captured_at)
    sheet = replace(heaviest(), status=playing, angles=tuple(_long_angle(n) for n in range(3)))
    system, user = worst_correction(sheet)
    assert system == WEEK_RULES_ANGLES and ANGLES_REMINDER in user and _long_angle(2).text in user
    tokens = (len(system) + len(user)) / CHARS_PER_TOKEN
    assert tokens <= (1 - BOUND_MARGIN) * WORST_PROMPT_TOKENS, tokens


# --- fix round 2: the review's H1, H2, M2, M3, M4 and L7 -----------------------------------------------------------

_ACCEPTED = (
    "Puka Nacua draws 32% of the Rams' targets, the 3rd-highest among the wide receivers we rank, in week 6 of "
    "2026. Tutu Atwell is Out this week, and his 20% of the Rams' targets has to go somewhere. Nacua is the obvious "
    "home for it against Arizona. Start him."
)
# The review's H1: each variant quotes an angle's figure as another measure, a share as a count, or a place among
# his peers no angle states.
_MISQUOTED = (
    ("32% of the Rams' targets", "32% of the Rams' offensive snaps"),
    ("32% of the Rams' targets", "32% of the Rams' red-zone work"),
    ("his 20% of the Rams' targets", "his 20% of the Rams' carries"),
    ("draws 32% of the Rams' targets", "has 32 targets"),
    ("the 3rd-highest among the wide receivers we rank", "1st among the receivers we rank"),
    ("the 3rd-highest among the wide receivers we rank", "the highest share among receivers we rank"),
    ("the 3rd-highest among the wide receivers we rank", "the 2nd-highest among the wide receivers we rank"),
)


@pytest.mark.usefixtures("angles_on")
def test_an_angle_said_as_its_angle_says_it_is_accepted() -> None:
    assert validate_week_read(_ACCEPTED, _angled(), call="start").ok


@pytest.mark.usefixtures("angles_on")
@pytest.mark.parametrize(("said", "misquoted"), _MISQUOTED)
def test_an_angle_figure_or_place_misquoted_is_refused(said: str, misquoted: str) -> None:
    read = _ACCEPTED.replace(said, misquoted)
    assert read != _ACCEPTED
    violations = validate_week_read(read, _angled(), call="start").violations
    assert any("usage fact" in v for v in violations), violations


@pytest.mark.usefixtures("angles_on")
def test_a_place_among_peers_on_a_sheet_with_no_angle_is_refused() -> None:
    read = (
        "Puka Nacua has the highest target share among the receivers we rank in week 6 of 2026, and Arizona comes "
        "to town. He averages 25.9 PPR points a game. Start him."
    )
    assert any("among his peers" in v for v in validate_week_read(read, starter(), call="start").violations)


def _thin_receiver(n: int) -> AnglePlayer:
    """2 snaps and 1 target a game over 5 games: 10 snaps and 5 targets of his own."""
    usage = tuple(replace(_week(w, snaps=2, targets=1)) for w in range(1, 6))
    return AnglePlayer(f"00-{n:07d}", "Thin Receiver", "WR", "LAR", usage, tuple((w, 1.0) for w in range(1, 6)), ())


def test_a_share_on_10_snaps_and_5_targets_of_his_own_is_never_carried() -> None:
    thin = _thin_receiver(90)
    got = board_angles([*_board(), thin], {}, 8)[thin.player_id]
    assert all(a.key not in {"snap_share", "target_share", "air_yards_share"} for a in got), got


def test_a_return_on_15_snaps_of_his_own_is_never_carried() -> None:
    weeks = (1, 2, 5, 6, 7)
    usage = tuple(_week(w, snaps=5 if w > 4 else 60) for w in weeks)  # noqa: PLR2004 - back from week 5
    back = AnglePlayer("00-0000091", "Back Receiver", "WR", "LAR", usage, tuple((w, 8.0) for w in weeks), (3, 4))
    assert all(a.key != "return" for a in board_angles([*_board(), back], {}, 8)[back.player_id])


def test_a_trend_waits_for_usage_to_reach_his_last_game() -> None:
    lagging = _receiver(89, 14)
    lagging = replace(lagging, weeks=lagging.weeks[:-1])  # the log has week 7; the usage stops at week 6
    built = angles_module.own_candidates(lagging)
    assert all(not c.key.endswith("_trend") for c in built) and any(c.key == "target_share" for c in built)


def test_a_screen_only_depth_is_left_out() -> None:
    usage = tuple(replace(_week(w), air_yards=-4.0) for w in range(1, 8))
    screens = replace(_receiver(88, 8), weeks=usage)
    assert all(c.key != "target_depth" for c in angles_module.own_candidates(screens))


def _back(n: int, carries: float, team: str = "LAR", out: str | None = None) -> AnglePlayer:
    usage = tuple(_week(w, team, carries=carries) for w in range(1, 8))
    player = _receiver(n, 2, team=team, out=out)
    return replace(player, position="RB", weeks=usage)


def test_a_receivers_targets_never_pass_to_a_back() -> None:
    gone = _receiver(97, 12, team="LAR", out="Out")
    back = _back(87, 10)
    assert all(a.key != "vacated" for a in board_angles([*_board(), gone, back], {}, 8)[back.player_id])


def test_vacated_work_leads_for_the_heir_and_is_scaled_down_for_the_rest() -> None:
    gone = _receiver(97, 12, team="LAR", out="Out")
    heir, other = _receiver(96, 8, team="LAR"), _receiver(95, 4, team="LAR")
    lead, scaled = (angles_module.vacated(p, [gone, heir, other], 8) for p in (heir, other))
    assert lead is not None and scaled is not None and lead.fixed is not None
    assert lead.fixed == pytest.approx(12 / 36 / angles_module.VACATED_SHARE_PER_SCORE)
    assert scaled.fixed == pytest.approx(lead.fixed / 2)


@pytest.mark.usefixtures("angles_on")
def test_the_depth_line_says_the_move_and_the_fact_rule_takes_it() -> None:
    sheet = replace(
        starter(), depth=DepthPlace(1.0, (("Davante Adams", 2.0),), starter().written_at), depth_moved_from=2.0
    )
    sheet = replace(sheet, angles=(_TARGETS,))
    assert "listed first among LAR WRs, up from second on the chart before." in render_week_sheet(sheet)
    read = (
        "Puka Nacua draws 32% of the Rams' targets in week 6 of 2026. He is listed first, up from second on the chart "
        "before, and Arizona comes to town. Start him."
    )
    assert not any("depth chart" in v for v in validate_week_read(read, sheet, call="start").violations)


_SNAP_TREND = Angle(
    "snap_trend",
    "Offensive snaps lately: 61% of the Rams' offensive snaps over his last three games, against 94% in his games "
    "before them.",
    (AngleFigure(61.0, Measure.SNAPS), AngleFigure(94.0, Measure.SNAPS)),
    (),
    2.5,
    Basis(3, 120, "snaps"),
)


@pytest.mark.usefixtures("angles_on")
@pytest.mark.parametrize(
    "honest",
    [
        # A depth place among his club's receivers is Lane 299's, never a place among ranked peers.
        "He is listed first among Rams receivers this week.",
        # A trend's second figure, its measure named once in the sentence.
        "Puka Nacua played 61% of the Rams' offensive snaps over his last three games, down from 94% before.",
        # The angle's place said by its ordinal, and its group by its last words.
        "Puka Nacua draws 32% of the Rams' targets, 3rd among the receivers we rank.",
    ],
)
def test_an_honest_paraphrase_of_an_angle_is_not_refused(honest: str) -> None:
    sheet = replace(_angled(), angles=(_TARGETS, _SNAP_TREND))
    result = validate_week_read(f"{honest} Start him in week 6 of 2026 against Arizona.", sheet, call="start")
    assert not any("usage fact" in v for v in result.violations), result.violations


# --- fix round 3: the ordinary rank (the coordinator's ruling 1) -------------------------------------------------

_MATCHUP = "Puka Nacua draws 32% of the Rams' targets in week 6 of 2026. {line} Start him."


@pytest.mark.usefixtures("angles_on")
def test_an_ordinary_rank_stated_as_a_figure_is_refused() -> None:
    read = _MATCHUP.format(line="Arizona sits 26th of 32 against receivers.")
    violations = validate_week_read(read, _angled(), call="start").violations
    assert any("where it does not bite" in v and "an ordinary matchup" in v for v in violations), violations


@pytest.mark.usefixtures("angles_on")
def test_a_rank_that_bites_stays_allowed() -> None:
    biting = replace(_angled(), allowed=Allowed(29, 32, 41.3, "WR", 5, starter().written_at))
    read = _MATCHUP.format(line="Arizona sits 29th of 32 against receivers.")
    assert not any("does not bite" in v for v in validate_week_read(read, biting, call="start").violations)


@pytest.mark.usefixtures("angles_on")
def test_an_ordinary_matchup_in_plain_words_is_allowed() -> None:
    read = _MATCHUP.format(line="Arizona is an ordinary matchup for him.")
    assert not any("does not bite" in v for v in validate_week_read(read, _angled(), call="start").violations)


@pytest.mark.usefixtures("angles_off")
def test_with_the_angles_off_an_ordinary_rank_is_mains_to_judge() -> None:
    read = _MATCHUP.format(line="Arizona sits 26th of 32 against receivers.")
    assert not any("does not bite" in v for v in validate_week_read(read, _angled(), call="start").violations)
