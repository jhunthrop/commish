"""Lane 266, the opener variety and the voices ship bar: masked openers, counted per 100 reads, compared on
the players both arms wrote. No gateway and no store."""

from research.capsules.narrative import ShapeMasks, club_spellings
from research.explore.writer_bakeoff.variety import common_reads, opener, variety
from research.explore.writer_bakeoff.voices_compare import bar

_MASKS = ShapeMasks.of(("Puka Nacua", "Ja'Marr Chase"), club_spellings())


def test_an_opener_masks_names_and_numbers() -> None:
    assert opener("Start Nacua against the Bears this week.", _MASKS, 3) == opener(
        "Start Chase against the Bears.", _MASKS, 3
    )
    assert opener("18.4 points a game is his average.", _MASKS, 1) == "zznum"


def test_variety_counts_distinct_openers_per_100_reads() -> None:
    same = {"a": "Start Nacua this week. He plays.", "b": "Start Chase this week. He plays."}
    mixed = {"a": "Start Nacua this week. He plays.", "b": "The Bears allow plenty. Chase sits."}
    flat, varied = variety(same, _MASKS), variety(mixed, _MASKS)
    assert (flat.distinct_read_first_three, varied.distinct_read_first_three) == (1, len(mixed))
    assert (flat.first_three_per_100_reads, varied.first_three_per_100_reads) == (100.0, 200.0)
    assert flat.top_read_openers == (("start zzplayer this", 2),)


def test_common_reads_keep_the_players_both_arms_wrote() -> None:
    a, b = common_reads({"x": "1", "y": "2"}, {"y": "3", "z": "4"})
    assert a == {"y": "2"} and b == {"y": "3"}


def test_the_bar_holds_each_test() -> None:
    def arm(written: float, judged: float, shape: float) -> dict[str, dict[str, float]]:
        return {"tally": {"written_rate": written, "judge_pass_rate": judged}, "shapes": {"rate": shape}}

    v_lo = variety({"a": "Start Nacua. He plays.", "b": "Start Chase. He plays."}, _MASKS)
    v_hi = variety({"a": "Start Nacua. He plays.", "b": "The Bears allow plenty. Chase sits."}, _MASKS)
    met = bar(arm(0.80, 0.99, 0.011), arm(0.785, 0.99, 0.010), v_lo, v_hi)
    assert all(met.values())
    missed = bar(arm(0.80, 0.99, 0.011), arm(0.77, 0.98, 0.012), v_hi, v_lo)
    assert not any(missed.values())
