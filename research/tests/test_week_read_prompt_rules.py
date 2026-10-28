"""The week read's prompt on the causes its reads fell to most (Lane 264, B267): each rule stated once with
its right and wrong form, the shapes to avoid in the check's own form, and a correction that quotes the
sentence it broke and states the week's rule, never the season read's."""

from research.capsules.week.prompt import (
    OPENER_NOTE,
    SEASON_ONCE_NOTE,
    UNTRACED_NUMBER_NOTE,
    WEEK_RULES,
    week_correction,
    week_note,
    week_notes,
)
from research.capsules.week.validate import SHARED_SENTENCE, sentence_shape, validate_week_read
from research.tests.week_read_fixtures import starter

# The prompt Lane 264 started from ran 9,542 characters; the lane's bound is 10% over it.
PROMPT_CHARS_BOUND = 10_496
GOOD = (
    "Start Puka Nacua at home against Arizona in week 6 of 2026. The Cardinals rank 26th of 32 against "
    "receivers. The published projection has him at 18.4 points, so keep him in the lineup."
)


def _violations(text: str, taken: frozenset[str] = frozenset()) -> tuple[str, ...]:
    return validate_week_read(text, starter(), taken, "start").violations


def _one(text: str, starts: str, taken: frozenset[str] = frozenset()) -> str:
    return next(v for v in _violations(text, taken) if starts in v)


def test_each_cause_is_stated_once_with_its_right_and_wrong_form() -> None:
    for rule in (
        "- The season once, with the first week you name, whichever week that is",
        "- The first sentence carries the call",
        "- Every number is a figure the facts print, word for word, and a count in words is a number",
        "- The injury report exactly as the facts' injury report line names it",
        "- No sentence may sit on two players' pages",
    ):
        assert WEEK_RULES.count(rule) == 1, rule
    assert WEEK_RULES.count("Name the season once") == 0 and WEEK_RULES.count("Open on the fact") == 0
    assert "before week 8 of 2026's game status report on Friday" in WEEK_RULES
    assert '"week 8 of 2026" then "week 7 of 2026" (the year twice)' in WEEK_RULES
    assert 'Wrong: "Ty Johnson is buried third among Bills backs."' in WEEK_RULES
    assert 'never "three straight games"' in WEEK_RULES
    # The report by a day the facts never give is the wrong form only, never the example to copy.
    assert '("Friday\'s report", "Tuesday\'s list")' in WEEK_RULES and '("Friday\'s report")' not in WEEK_RULES
    assert len(WEEK_RULES) <= PROMPT_CHARS_BOUND, len(WEEK_RULES)


def test_a_bare_week_is_told_the_season_once_never_every_week() -> None:
    text = "Start Puka Nacua in week 6 of 2026. He scored 24.1 points in week 5 before it."
    violation = "The text carries a time frame (a week without its season)"
    bare = "He had 24.1 points in week 5. Start Puka Nacua in week 6 of 2026 against Arizona at home."
    note = week_note(starter(), _one(bare, violation), bare)
    assert note.sentence == "He had 24.1 points in week 5." and note.statement == SEASON_ONCE_NOTE
    assert "every later week without it" in note.statement
    assert not any(violation in v for v in _violations(text))


def test_the_season_named_twice_quotes_the_sentence_it_must_leave() -> None:
    twice = "Start Puka Nacua in week 6 of 2026. He scored 24.1 PPR points in week 5 of 2026 at SF."
    note = week_note(starter(), _one(twice, "names the season 2 times"), twice)
    assert note.rule == "names the season 2 times"
    assert note.sentence == "He scored 24.1 PPR points in week 5 of 2026 at SF."
    assert 'strike it from every later week ("week 7", never "week 7 of 2026")' in note.statement


def test_a_count_in_words_is_told_it_is_a_number() -> None:
    text = f"{GOOD} He has topped 20 points in eight straight games."
    note = week_note(starter(), _one(text, 'The number "eight"'), text)
    assert note.sentence == "He has topped 20 points in eight straight games."
    assert note.statement == UNTRACED_NUMBER_NOTE


def test_an_opener_without_the_point_quotes_it_once_with_the_right_form() -> None:
    text = "Puka Nacua leads the Rams receivers ahead of Davante Adams. " + GOOD
    violation = _one(text, "opens without the call")
    note = week_note(starter(), violation, text)
    assert note.rule == "opens without the call, a figure or his status"
    assert note.sentence == "Puka Nacua leads the Rams receivers ahead of Davante Adams."
    assert note.statement == OPENER_NOTE and note.line().count("Davante Adams") == 1


def test_a_shared_shape_names_the_shape_the_check_compared() -> None:
    sentence = "The Cardinals rank 26th of 32 against receivers."
    violation = _one(GOOD, SHARED_SENTENCE, frozenset({sentence_shape(sentence)}))
    note = week_note(starter(), violation, GOOD)
    assert note.sentence == sentence
    assert f'"{sentence_shape(sentence)}"' in note.statement and "another page carries" in note.statement


def test_a_report_by_a_day_the_facts_never_give_keeps_its_remedy_and_the_season() -> None:
    text = f"{GOOD} He carries no designation on Tuesday's list."
    note = week_note(starter(), _one(text, "a report the facts do not name"), text)
    assert note.rule == "names Tuesday's list, a report the facts do not name"
    assert note.statement.startswith('Name it as the facts do: "Friday\'s report".')
    assert "that week carries it" in note.statement


def test_the_correction_quotes_each_broken_sentence_and_its_rule() -> None:
    text = f"{GOOD} He has topped 20 points in eight straight games."
    ledger = week_notes(starter(), [(text, _violations(text))])
    user = week_correction(starter(), text, ledger, ())
    assert '- an untraced number, "eight", in "He has topped 20 points in eight straight games."' in user
    assert UNTRACED_NUMBER_NOTE in user
