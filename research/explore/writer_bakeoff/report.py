"""THE BAKE-OFF'S TABLES IN MARKDOWN: `python -m research.explore.writer_bakeoff.report RESULTS.json`.

The decision table (written rate, facts-block rate, validation breaks, the judge on may-not-start sheets,
the shape-duplicate rate, cost and latency), the second judge's table, the reasons reads fell, the most
repeated shapes, and ten sheets side by side, unedited."""

import json
import sys
from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Final

from research.explore.writer_bakeoff.results import BASELINE, fall_reason

Json = dict[str, Any]
FALLS_SHOWN: Final = 8


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{100 * value:.1f}%"


def _row(cells: Sequence[object]) -> str:
    return "| " + " | ".join(str(c) for c in cells) + " |"


def _table(head: Sequence[str], rows: Sequence[Sequence[object]]) -> list[str]:
    return [_row(head), _row(["---"] * len(head)), *(_row(r) for r in rows)]


def headline(results: Json) -> list[str]:
    head = [
        "writer", "reads", "written", "facts blocks", "drafts broken (reads with a break)", "shape-rule breaks",
        "judge pass, may-not-start drafts", "may-not-start written", "shape-duplicate rate", "cost per read",
        "mean / p95 s per read", "calls per read", "tokens in / out per read",
    ]  # fmt: skip
    rows = []
    for model, lane in results["models"].items():
        t, s = lane["tally"], lane["shapes"]
        rows.append([
            model, t["reads"], f"{t['written']} ({_pct(t['written_rate'])})",
            f"{t['facts_blocks']} ({_pct(t['facts_rate'])})",
            f"{t['broken_drafts']} of {t['drafts']} ({t['reads_with_a_break']} reads)", t["shape_broken_drafts"],
            f"{t['judge_passed']} of {t['judged']} ({_pct(t['judge_pass_rate'])})",
            f"{t['may_not_start_written']} of {t['may_not_start']}",
            f"{_pct(s['rate'])} ({s['duplicated']} of {s['sentences']})", f"${t['cost_per_read']:.5f}",
            f"{t['mean_seconds']:.1f} / {t['p95_seconds']:.1f}", f"{t['mean_calls']:.2f}",
            f"{t['mean_prompt_tokens']:.0f} / {t['mean_completion_tokens']:.0f}",
        ])  # fmt: skip
    b = results["baseline"]
    bs = b["shapes"]
    rows.append([
        f"{BASELINE} (player_week_reads, week {results['run']['board_week']})", b["reads"],
        f"{b['written']} ({_pct(b['written_rate'])})", f"{b['reads'] - b['written']} ({_pct(b['facts_rate'])})",
        "n/a", "n/a", "n/a", f"{b['may_not_start_written']} of {b['may_not_start']}",
        f"{_pct(bs['rate'])} ({bs['duplicated']} of {bs['sentences']})", "n/a", "n/a", "n/a", "n/a",
    ])  # fmt: skip
    return _table(head, rows)


def second_judge(results: Json) -> list[str]:
    head = ["writer", "drafts", "GLM refused", "DeepSeek refused", "both refused", "both passed",
            "GLM only refused", "DeepSeek only refused", "GLM pass", "DeepSeek pass", "errors"]  # fmt: skip
    rows = []
    for model, lane in results["models"].items():
        j = lane["second_judge"]
        rows.append([
            model, j["drafts"], j["both_refused"] + j["first_only_refused"], j["both_refused"] + j["second_only_refused"],
            j["both_refused"], j["both_passed"], j["first_only_refused"], j["second_only_refused"],
            _pct(j["first_pass_rate"]), _pct(j["second_pass_rate"]), j["errors"],
        ])  # fmt: skip
    return _table(head, rows)


def falls(results: Json) -> list[str]:
    out: list[str] = []
    for model in results["models"]:
        reasons = Counter(fall_reason(r["fallback"]) for r in results["reads"] if r["model"] == model)
        out += [f"**{model}**", ""]
        out += _table(["why", "reads"], reasons.most_common(FALLS_SHOWN))
        out.append("")
    return out


def shapes(results: Json) -> list[str]:
    out: list[str] = []
    sources = [(m, lane["shapes"]) for m, lane in results["models"].items()]
    for name, tally in [*sources, (BASELINE, results["baseline"]["shapes"])]:
        out += [f"**{name}**", ""]
        out += _table(["shape", "players"], [[f"`{shape}`", n] for shape, n in tally["top"]])
        out.append("")
    return out


def side_by_side(results: Json) -> list[str]:
    out: list[str] = []
    models = list(results["models"])
    for row in results["side_by_side"]:
        out += [
            f"### {row['board_index'] + 1}. {row['player']}, {row['position']} {row['team']}"
            f"{'' if row['may_start'] else ' (may not start)'}",
            "",
            "Facts block:",
            "",
            *(f"    {line}" for line in row["facts_block"].splitlines()),
            "",
        ]
        for name in [*models, BASELINE]:
            got = row.get(name)
            label = f"**{name}**"
            if got is None:
                out += [f"{label}: no read", ""]
                continue
            call = f", call {got['call']}" if got.get("call") else ""
            text = got["text"].replace("\n", " / ")
            out += [f"{label} ({got['source']}{call}):", "", f"> {text}", ""]
    return out


def render(results: Json) -> str:
    run = results["run"]
    lines = [
        f"Instant {run['instant']}, board week {run['board_week']}, {run['sheets']} sheets "
        f"({run['may_not_start_sheets']} may not start); {run['budget']}.",
        "",
        "## Decision table",
        "",
        *headline(results),
        "",
        "## The second judge (DeepSeek) on the drafts GLM's judge read",
        "",
        *second_judge(results),
        "",
        "## Why reads fell to the facts block",
        "",
        *falls(results),
        "## The ten most repeated shapes",
        "",
        *shapes(results),
        "## Ten sheets side by side (board order, unedited)",
        "",
        *side_by_side(results),
    ]
    return "\n".join(lines) + "\n"


def main(argv: Sequence[str]) -> int:
    print(render(json.loads(Path(argv[0]).read_text())))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
