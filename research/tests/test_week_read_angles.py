"""Lane 300: each week read is built on its own angle, chosen by code from the stored usage, and the generic facts
reach the writer only when they bite (`capsules.week.angles`, `bites`, `render`, `prompt`, `cells`)."""

from collections.abc import Iterator
from dataclasses import replace

import pytest

from research.capsules.week import angles as angles_module
from research.capsules.week.angle_candidates import Basis
from research.capsules.week.angles import (
    LEAD_ANGLES,
    Angle,
    AnglePlayer,
    board_angles,
    chosen,
    place_words,
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
from research.explore.writer_bakeoff.angles_compare import categories
from research.explore.writer_bakeoff.blind import Masker, answer_letter
from research.nightly.week_reads import CHARS_PER_TOKEN, WORST_PROMPT_TOKENS
from research.tests.test_week_read_writer import BOUND_MARGIN, worst_correction
from research.tests.week_read_fixtures import heaviest, starter


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
        inside_ten=0,
        team_inside_ten=3,
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
    assert "39% of the Rams' targets this season, the highest among the wide receivers we rank" in lead.text
    assert 39.0 in lead.figures  # noqa: PLR2004 - 14 of 36 targets


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
    return Angle(key, f"{key}.", (1.0,), (), score, Basis(5, 100, "snaps"))


def test_one_angle_a_family_two_lead_and_a_third_only_when_strong() -> None:
    picked = chosen(
        [_angle("target_share", 2.0), _angle("target_trend", 1.5), _angle("snap_share", 1.2), _angle("spread", 0.4)]
    )
    assert [a.key for a in picked] == ["target_share", "snap_share"]
    assert len(picked) == LEAD_ANGLES
    assert [a.key for a in chosen([_angle("spread", 2.0), _angle("red_zone", 1.5), _angle("expected", 1.1)])] == [
        "spread",
        "red_zone",
        "expected",
    ]


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


def test_the_rank_bites_at_the_six_either_end() -> None:
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
    "Targets: 32% of the Rams' targets this season, the 3rd-highest among the wide receivers we rank.",
    (32.0,),
    (),
    2.2,
    Basis(5, 192, "targets"),
)
_VACATED = Angle(
    "vacated",
    "Vacated work: Tutu Atwell is Out this week, and he drew 20% of the Rams' targets this season.",
    (20.0,),
    ("Tutu Atwell",),
    2.0,
    Basis(6, 242, "targets"),
)


def _angled() -> WeekSheet:
    return replace(starter(), angles=(_TARGETS, _VACATED))


@pytest.mark.usefixtures("angles_on")
def test_the_sheet_leads_with_the_angles_and_leaves_off_what_does_not_bite() -> None:
    text = render_week_sheet(_angled())
    assert ANGLES_HEAD in text and f"1. {_TARGETS.text}" in text and f"2. {_VACATED.text}" in text
    assert "Venue:" not in text and "Expected points:" not in text and "Depth chart" not in text
    assert "ARI against WRs" not in text  # 26th of 32 is outside the six either end
    assert "ARI against WRs" in render_week_sheet(
        replace(_angled(), allowed=Allowed(28, 32, 41.3, "WR", 5, starter().written_at))
    )
    assert NO_ANGLE in render_week_sheet(starter())


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
    assert "Build the read on his angles" in WEEK_RULES_ANGLES and "Build the read on his angles" not in WEEK_RULES
    assert "Pick the two or three facts" not in WEEK_RULES_ANGLES
    correction = week_correction(_angled(), "A read.", (), ())
    assert ANGLES_REMINDER in correction and _TARGETS.text in correction


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


def _long_angle(n: int) -> Angle:
    mate = f"Jean-Baptiste Montgomery-Smith Teammate{n} Jr."
    text = (
        f"Vacated work: {mate} is on the physically unable to perform list this week, and he drew 33% of the "
        "Commanders' targets this season, the 2nd-highest among the wide receivers we rank."
    )
    return Angle("vacated", text, (33.0,), (mate,), 3.0, Basis(7, 250, "targets"))


@pytest.mark.usefixtures("angles_on")
def test_the_heaviest_correction_with_three_angles_stays_inside_the_prompt_bound() -> None:
    """Ruling 3: the correction carries the angles inside `WORST_PROMPT_TOKENS`, at the bound's margin."""
    playing = Status("questionable", heaviest().status.captured_at)
    sheet = replace(heaviest(), status=playing, angles=tuple(_long_angle(n) for n in range(3)))
    system, user = worst_correction(sheet)
    assert system == WEEK_RULES_ANGLES and ANGLES_REMINDER in user and _long_angle(2).text in user
    tokens = (len(system) + len(user)) / CHARS_PER_TOKEN
    assert tokens <= (1 - BOUND_MARGIN) * WORST_PROMPT_TOKENS, tokens
