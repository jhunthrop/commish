"""THE RESULTS RECORD'S TEMPLATE (preregistration section 8), written from the run records.

`docs/research/2026-10-26-weekly-projection-round5-results.md` is the coordinator's; this writes its eight
sections in section 8's order, each filled from the development check's and the judgment's JSON records where
they exist and marked "(not run)" where they do not, so the coordinator edits words and never copies a number.
It refuses to replace an existing file unless told to.
"""

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Final

from research.model.weekly2.judge import DOCS

RESULTS: Final = DOCS / "2026-10-26-weekly-projection-round5-results.md"
NOT_RUN: Final = "(not run)"


def _lines(gates: Sequence[Mapping[str, Any]]) -> list[str]:
    return [f"| {g['gate']} | {g['subject']} | {'PASS' if g['passed'] else 'FAIL'} | {g['detail']} |" for g in gates]


def _table(gates: Sequence[Mapping[str, Any]]) -> list[str]:
    return ["| Gate | Line | Verdict | Detail |", "|---|---|---|---|", *_lines(gates)]


def _preconditions(record: Mapping[str, Any] | None) -> list[str]:
    if record is None:
        return [NOT_RUN]
    pre = record["preconditions"]
    counts = pre.get("counts", {})
    return [
        f"- Run seconds: {record['seconds'].get('total', 0):.0f}; HEAD `{record['head']}`; the lock `{record['preregistration']['lock']}`.",
        f"- Round 4's preconditions: missing {counts.get('missing', [])}.",
        f"- Round 4's play, team and share models reproduced: {pre['round_four_reproduced']}; round 3's 26 lines: {pre['round_three_reproduced']}.",
        f"- The team model fitted for the first player fit season (N7): {pre['first_team_model_cells']}.",
    ]


def _check(record: Mapping[str, Any] | None) -> list[str]:
    if record is None:
        return [NOT_RUN]
    found = [
        "Claim `2026-10-26-weekly-projection-round5-dev-check-taken.json`, record `2026-10-26-weekly-projection-round5-dev-check.json`.",
        f"Input columns: {', '.join(record['fitted']['input_columns']['feature_row'])}.",
        f"Fit seconds: {record['fitted']['seconds']}.",
    ]
    for name, candidate in record["candidates"].items():
        found += ["", f"**{name}**", "", *_table(candidate["gates"])]
    choice = record.get("choice") or {}
    found += ["", f"**The choice.** {choice.get('rule', NOT_RUN)}", "", f"**The stop rule.** {record['decision']}"]
    return found


def _judgment(record: Mapping[str, Any] | None) -> list[str]:
    if record is None:
        return [NOT_RUN]
    digests = {k: v for k, v in record["features"]["digests"].items() if "2024" in k}
    return [
        "Claim `2026-10-26-weekly-projection-round5-judgment-taken.json`, record `2026-10-26-weekly-projection-round5-results.json`.",
        f"The 2024 feature digests: {digests}.",
        f"The candidate judged: {record['chosen']}.",
        "",
        *_table(record["gates"]),
        "",
        f"**The decision.** {record['decision']}",
        "",
        f"_{record['provisional']}_",
        "",
        record["exposure"],
    ]


def render(check: Mapping[str, Any] | None, judgment: Mapping[str, Any] | None) -> str:
    reported = (judgment or check or {}).get("reported")
    sections = [
        "# The Weekly Projection, Round 5: Results",
        "",
        "## 1. Preconditions and reproduction",
        *_preconditions(judgment or check),
        "",
        "## 2. The development check (once)",
        *_check(check),
        "",
        "## 3. Defects found, and amendments",
        "None.",
        "",
        "## 4. The judgment (once)",
        *_judgment(judgment),
        "",
        "## 5. Reported views",
        "See the record's `reported` and each candidate's `numbers`." if reported is not None else NOT_RUN,
        "",
        "## 6. Readings the build or the runs took",
        "Each one line, each saying it moved no threshold, seed, population or judged week.",
        "",
        "## 7. On a pass, or on a fail",
        NOT_RUN
        if judgment is None
        else (
            "The served refit's pin and the switch pass's run id."
            if judgment["passed"]
            else "No weekly number from round 5 reaches a screen."
        ),
    ]
    return "\n".join(sections) + "\n"


def write(
    path: Path, check: Mapping[str, Any] | None, judgment: Mapping[str, Any] | None, replace: bool = False
) -> Path:
    if path.exists() and not replace:
        raise FileExistsError(f"{path.name} exists; pass --replace to write the template over it")
    path.write_text(render(check, judgment))
    return path
