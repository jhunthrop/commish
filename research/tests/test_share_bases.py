"""Lane 50: a share names its own base. A second share beside a first one with a different base on
the sheet, and a share hung on "of those", "of them" or "of which", are refused, naming the sentence."""

import pytest

from research.capsules.prompt import IN_SEASON_RULES, PRESEASON_RULES
from research.capsules.season_voice import SeasonClock
from research.capsules.share_bases import base_violations, shares_in, sheet_bases
from research.capsules.validate import Grounding, validate_narrative_slot

SHEET = """Fact sheet:
- Last season's usage (2025): snap share 96.0%, QB17 among 78 qualifying quarterbacks, target share 0.3%, QB9 among 64 qualifying quarterbacks, red-zone share of his own touches 13.3%, QB20 among 64 qualifying quarterbacks.
- His target share rose from 1.2% in 2024 to 9.1% in 2025.
- 41.0% air-yards share: worth +2.7 a game (net of 2 factors).
- Air yards share: 34% of his team's air yards in his games (350 of 1349).
- 30.8% red-zone touch share: worth -10.2 a game. 15.4% inside-ten touch share: worth -4.8 a game.
- Inside 2024: target share 20% to 14%. His 2023 target share: 24.0%.
- Inside 2025, weeks 1 to 4 of 2025 against weeks 15 to 18 of 2025: snap share 97% to 89%.
- NE in 2025: 34.6 seconds a play, 54% of situation-neutral plays passes, 14 wins.
This season's usage and play (weeks 1 to 5 of 2026):
- Pressured on 26% of his dropbacks (46 of 179), QB12 among 35 quarterbacks with 50 or more dropbacks.
- Blitzed on 30% of his charted dropbacks (54 of 179), QB20 among 35 quarterbacks with 50 or more charted dropbacks.
- Red-zone share: 22% of his team's red-zone carries and targets in his games (5 of 23)."""


def test_the_sheet_names_each_shares_base() -> None:
    bases = sheet_bases(SHEET)
    assert bases[26.0] == {"dropback"}
    assert bases[30.0] == {"charted dropback"}
    assert bases[96.0] == {"snap"}
    assert bases[89.0] == {"snap"}
    assert bases[54.0] == {"play"}
    assert bases[22.0] == {"carry"}
    assert bases[13.3] == {"touch"}
    assert bases[9.1] == {"target"}


@pytest.mark.parametrize(
    ("text", "sentence"),
    [
        # Maye's sample: the second share reads as a share of the first one's dropbacks.
        (
            "He is pressured on 26% of his dropbacks, and defenses are blitzing him on 30% of those charted dropbacks.",
            "He is pressured on 26% of his dropbacks, and defenses are blitzing him on 30% of those charted dropbacks.",
        ),
        (
            "He faced 179 charted dropbacks, 30% of which were blitzes, and he still stood in.",
            "He faced 179 charted dropbacks, 30% of which were blitzes, and he still stood in.",
        ),
        (
            "He holds 22% of the red-zone work and has turned 40% of them into scores.",
            "He holds 22% of the red-zone work and has turned 40% of them into scores.",
        ),
    ],
)
def test_a_share_hung_on_of_those_is_refused_naming_the_sentence(text: str, sentence: str) -> None:
    violations = base_violations(text, SHEET)
    assert len(violations) == 1, violations
    assert f'"{sentence}"' in violations[0]
    assert "of those" in violations[0]


@pytest.mark.parametrize(
    ("text", "sentence"),
    [
        # Hurts's sample: the pressure share sits on the blitz share's charted dropbacks.
        (
            "Offenses are coming after him, blitzed on 30% of his charted dropbacks and pressured on 26%, and he is still accurate.",
            "Offenses are coming after him, blitzed on 30% of his charted dropbacks and pressured on 26%, and he is still accurate.",
        ),
        # The sentence before carries the first share.
        (
            "He is pressured on 26% of his dropbacks. Defenses blitz him on 30%, and he stands in.",
            "Defenses blitz him on 30%, and he stands in.",
        ),
        # Achane's live page: this season's share of the team's red-zone work against last season's
        # share of his own touches, as if one figure.
        (
            "The red-zone share is up too, 22% in his games, a huge jump from the 13.3% he carried last year.",
            "The red-zone share is up too, 22% in his games, a huge jump from the 13.3% he carried last year.",
        ),
    ],
)
def test_a_second_share_on_another_base_without_its_own_is_refused(text: str, sentence: str) -> None:
    violations = base_violations(text, SHEET)
    assert len(violations) == 1, violations
    assert f'"{sentence}"' in violations[0]
    assert "30%" in violations[0] or "26%" in violations[0]


@pytest.mark.parametrize(
    "text",
    [
        "He is pressured on 26% of his dropbacks and blitzed on 30% of all 179 charted dropbacks.",
        "Blitzed on 30% (54 of 179) and pressured on 26% of his dropbacks, he still delivers.",
        "His snap share fell from 97% to 89% across 2025.",
        "He played a 97% snap share early in 2025 and 89% late.",
        "He played a 96.0% snap share in 2025 and drew a 0.3% target share.",
        "He is pressured on 26% of his dropbacks, and he is still +4.6 percentage points over expectation.",
        "He is pressured on 26% of his dropbacks. He still stands in. Defenses blitz him on 30%.",
        "Defenses blitz him on 30%, and he stands in.",
        "He is pressured on 26% of his dropbacks and holds 41% of something we never printed.",
        "NE threw on 54% of situation-neutral plays, and his red-zone share is 22%.",
        # Counts and weeks hung on "of those" are not shares on a share.
        "His 96% snap share held, and he never cleared 15 points in any of those five weeks.",
        "The workload stands on 26% of his dropbacks and 30% of his charted dropbacks, both of which held.",
        # A base noun named before the share, or after it without "of".
        "A 96% snap share and a real slice of the red-zone carries at 22%.",
        "A 96% snap share on a team that ran 54% situation-neutral passes.",
        "A 96% snap share on a team running the most situation-neutral passes, 54%.",
        # The base named a clause back, past a carrier (live pages of Kirk, Chandler and Warren).
        "Pressured on 26% of his dropbacks. His points rose, and the target share rose with it, from 1.2% to 9.1%.",
        "Pressured on 26% of his dropbacks. The thing that moved was his target share, which jumped from 1.2% in 2024 to 9.1%.",
        "Pressured on 26% of his dropbacks. He also gained target share from 2024 into 2025, up from 1.2% to 9.1%.",
        # A base after a word or two and "of" (Nabers's live page).
        "He drew 9.1% of the targets. Add a 22% slice of the team's red-zone carries, and he scores.",
        # The live set's audit (2026-10-15): one base under two labels, and what a share counts is not its base.
        "His 34% air-yards share sits under the 41% our case assumed.",
        "Last season 31% of his touches came in the red zone, and 15% inside the ten.",
    ],
)
def test_shares_that_name_their_base_or_share_one_pass(text: str) -> None:
    assert base_violations(text, SHEET) == []


# The review's M1: a base named once after a pair joined by "and", "or" or "to" covers both shares.
@pytest.mark.parametrize(
    "text",
    [
        "His air yards share is 34%, and he played between 97% and 89% of the snaps across 2025.",
        "His air yards share is 34%, and he went from 20% to 14% of the targets across 2024.",
        "His target share was 24% in 2023. He played 97% and 89% of the snaps in the two halves of 2025.",
        # A pair with a base on each.
        "He played 97% of the snaps and 34% of the team's air yards in 2025.",
    ],
)
def test_a_pair_shares_the_base_that_trails_it(text: str) -> None:
    assert base_violations(text, SHEET) == []


def test_a_pair_never_lends_a_share_a_base_the_sheet_does_not_give_it() -> None:
    text = "He is pressured on 26% and 30% of his charted dropbacks."
    violations = base_violations(text, SHEET)
    assert len(violations) == 1, violations
    assert "borrows the base" in violations[0]
    assert f'"{text}"' in violations[0]


# The review's M2, ruled not taken: a base passed along by a carrier stands as named.
def test_a_base_passed_along_by_a_carrier_stands() -> None:
    assert base_violations("His red-zone share is 22% this season, up from 13.3% last year.", SHEET) == []


# The review's L2, noted and not taken: a bare "share" stands as named, and "of ..." after it is read on.
def test_a_bare_share_stands_as_named_and_reads_on_to_its_of() -> None:
    assert base_violations("He is pressured on 26% of his dropbacks and sees a 30% share.", SHEET) == []
    shares = shares_in("A 9.0% share of targets and a 96% snap share.")
    assert [share.base for share in shares] == ["target", "snap"]


# A joining word or a determiner starts a new clause, never a base ("49.2% and his target share").
def test_a_base_never_reaches_across_a_joining_word() -> None:
    shares = shares_in("His snap share was 96.0% and his target share 0.3%.")
    assert [share.base for share in shares] == ["snap", "target"]


OCTOBER = SeasonClock(2026, 5, (1, 2, 3, 4, 5), ())
GROUNDING = Grounding((26.0, 30.0, 46.0, 54.0, 179.0), (), SHEET, None, (), None, "QB", None, None, OCTOBER)


def test_the_validator_refuses_a_share_on_another_base() -> None:
    text = "Defenses blitz him on 30% of his charted dropbacks and pressure him on 26%."
    violations = validate_narrative_slot(text, GROUNDING, 40).violations
    assert any("names no base of its own" in v for v in violations), violations


def test_the_validator_passes_shares_with_their_own_bases() -> None:
    text = "Defenses blitz him on 30% of his charted dropbacks and pressure him on 26% of his dropbacks."
    assert validate_narrative_slot(text, GROUNDING, 40).violations == ()


@pytest.mark.parametrize("rules", [IN_SEASON_RULES, PRESEASON_RULES], ids=["in-season", "preseason"])
def test_the_prompt_holds_every_share_to_its_own_base(rules: str) -> None:
    assert "names its own base in full" in rules
    assert '30% of all 179 charted dropbacks"' in rules
    assert 'never "of those", "of them" or "of which" after a share' in rules
