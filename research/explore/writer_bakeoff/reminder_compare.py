"""`python -m research.explore.writer_bakeoff.reminder_compare --off A B --v1 A B --reminder A B --out P --md P`.

Lane 282 (after Lane 281's `v2_compare`): paired bake-off runs of one writer on the same sheets, voices off (the
audibility tally's reference), v1 (the week read as main had it, `--reminder off`) and v1 with the voice
reminder in the corrections (`--reminder on`), each pair run back to back: the written rate, the falls by cause,
the judge's pass on may-not-start drafts, the shape-duplicate rate, the reads the retry writer wrote, and the
audibility tally per voice (`audibility`) on every base, per pair and pooled; the ship bar (`bar`, ruling 4) on
the pooled figures; and two reminder reads per voice, corrected reads first, beside the same player's v1 and
voices-off reads.
"""

import argparse
import json
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any, Final

from research.capsules.narrative import ShapeMasks, club_spellings
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.voices import VOICES
from research.explore.writer_bakeoff.audibility import BASES, Cut, audibility, corrected, first_sentence, voiced
from research.explore.writer_bakeoff.voices_compare import WRITTEN_SLACK

Json = dict[str, Any]
OFF: Final = "off"
BEFORE: Final = "v1"
AFTER: Final = "reminder"
ARMS: Final = (OFF, BEFORE, AFTER)
VOICED_ARMS: Final = (BEFORE, AFTER)
PER_VOICE: Final = 2
# Ruling 4: audibility on every written read up for at least four of the six voices.
BAR_BASIS: Final = "every written read"
LOUDER_VOICES_NEEDED: Final = 4
LOUDER: Final = f"audibility up on {BAR_BASIS}, at least {LOUDER_VOICES_NEEDED} of the voices"


def _model(results: Json) -> Json:
    (model,) = results["models"].values()
    return dict(model)


def _counts(runs: Sequence[Json]) -> Json:
    """One arm's figures summed over its runs."""
    tallies = [_model(r)["tally"] for r in runs]
    shapes = [_model(r)["shapes"] for r in runs]
    reads = [read for r in runs for read in r["reads"]]
    written = [read for read in reads if read["source"] == WRITTEN_SOURCE]
    falls: Counter[str] = Counter()
    for r in runs:
        falls.update(_model(r)["falls"])
    total = sum(t["reads"] for t in tallies)
    judged = sum(t["judged"] for t in tallies)
    sentences = sum(s["sentences"] for s in shapes)
    return {
        "reads": total,
        "written": sum(t["written"] for t in tallies),
        "written_rate": sum(t["written"] for t in tallies) / total if total else 0.0,
        "budget_stopped": sum(t["budget_stopped"] for t in tallies),
        "judged": judged,
        "judge_passed": sum(t["judge_passed"] for t in tallies),
        "judge_pass_rate": sum(t["judge_passed"] for t in tallies) / judged if judged else None,
        "may_not_start": sum(t["may_not_start"] for t in tallies),
        "may_not_start_written": sum(t["may_not_start_written"] for t in tallies),
        "sentences": sentences,
        "duplicated": sum(s["duplicated"] for s in shapes),
        "shape_rate": sum(s["duplicated"] for s in shapes) / sentences if sentences else 0.0,
        "first_draft_written": sum(not corrected(r) for r in written),
        "corrected_written": sum(corrected(r) for r in written),
        "rescued_by_retry_writer": sum(int(r.get("retry_asks") or 0) > 0 for r in written),
        "first_sentence_words_max": max((_first_words(r["text"]) for r in written), default=0),
        "cost_usd": sum(t["cost_usd"] for t in tallies),
        "falls": dict(falls.most_common()),
    }


def _first_words(text: str) -> int:
    return len(first_sentence(text).split())


def _masks(arms: Mapping[str, Sequence[Json]]) -> ShapeMasks:
    return ShapeMasks.of(
        {read["player"] for runs in arms.values() for r in runs for read in r["reads"]}, club_spellings()
    )


def _audible(on_runs: Sequence[Json], off_runs: Sequence[Json], masks: ShapeMasks, cut: Cut = voiced) -> Json:
    """Each voice's audibility over the paired runs pooled: each run's reads against its own pair's off run."""
    on = [read | {"player_id": f"{i}:{read['player_id']}"} for i, r in enumerate(on_runs) for read in r["reads"]]
    off = [read | {"player_id": f"{i}:{read['player_id']}"} for i, r in enumerate(off_runs) for read in r["reads"]]
    return {key: asdict(value) for key, value in audibility(on, off, masks, cut).items()}


def louder_voices(audible: Mapping[str, Mapping[str, Json]]) -> list[str]:
    """The voices whose audibility the reminder arm raised over v1."""
    before, after = audible[BEFORE], audible[AFTER]
    return [
        v.key for v in VOICES if v.key in before and v.key in after and after[v.key]["score"] > before[v.key]["score"]
    ]


def bar(pooled: Mapping[str, Json], audible: Mapping[str, Mapping[str, Json]]) -> dict[str, bool]:
    """Ruling 4, the reminder against v1 on the pooled runs; `audible` is the tally on `BAR_BASIS`."""
    v1, on = pooled[BEFORE], pooled[AFTER]
    return {
        "written rate not down more than 2 points": on["written_rate"] >= v1["written_rate"] - WRITTEN_SLACK,
        "judge pass not down": (on["judge_pass_rate"] or 0.0) >= (v1["judge_pass_rate"] or 0.0),
        "shape-duplicate rate not up": on["shape_rate"] <= v1["shape_rate"],
        LOUDER: len(louder_voices(audible)) >= LOUDER_VOICES_NEEDED,
    }


def samples(on: Json, v1: Json, off: Json) -> list[Json]:
    """Two reminder-arm reads per voice written in all three arms of a pair, corrected reads first (the reminder
    rides in the corrections), a may-not-start player first."""

    def by_id(results: Json) -> dict[str, Json]:
        return {r["player_id"]: r for r in results["reads"] if r["source"] == WRITTEN_SOURCE}

    v1_ids, off_ids = by_id(v1), by_id(off)
    rows: list[Json] = []
    for voice in VOICES:
        mine = [
            r
            for r in by_id(on).values()
            if r["voice"] == voice.key and r["player_id"] in v1_ids.keys() & off_ids.keys()
        ]
        mine.sort(key=lambda r: (not corrected(r), r["may_start"]))
        held = [r for r in mine if not r["may_start"]][:1]
        picked = [*held, *[r for r in mine if r["may_start"]]][:PER_VOICE]
        rows.extend(
            {
                "voice": voice.key,
                "player": r["player"],
                "may_start": r["may_start"],
                "arms": {
                    arm: {"call": got["call"], "text": got["text"], "corrected": corrected(got)}
                    for arm, got in ((AFTER, r), (BEFORE, v1_ids[r["player_id"]]), (OFF, off_ids[r["player_id"]]))
                },
            }
            for r in picked
        )
    return rows


def compare(arms: Mapping[str, Sequence[Json]]) -> Json:
    masks = _masks(arms)
    pairs = len(arms[OFF])
    per_pair = [{arm: _counts([arms[arm][i]]) for arm in ARMS} for i in range(pairs)]
    pooled = {arm: _counts(arms[arm]) for arm in ARMS}
    by_basis = {
        base: {arm: _audible(arms[arm], arms[OFF], masks, cut) for arm in VOICED_ARMS} for base, cut in BASES.items()
    }
    bar_cut = BASES[BAR_BASIS]
    per_pair_audible = [
        {arm: _audible([arms[arm][i]], [arms[OFF][i]], masks, bar_cut) for arm in VOICED_ARMS} for i in range(pairs)
    ]
    return {
        "runs": {arm: [r["run"] for r in arms[arm]] for arm in ARMS},
        "per_pair": per_pair,
        "pooled": pooled,
        "audibility_by_basis": by_basis,
        "audibility_per_pair": per_pair_audible,
        "louder_by_basis": {base: louder_voices(value) for base, value in by_basis.items()},
        "bar": bar(pooled, by_basis[BAR_BASIS]),
        "samples": samples(arms[AFTER][-1], arms[BEFORE][-1], arms[OFF][-1]),
        "spent_usd": sum(r["run"]["spent_usd"] for runs in arms.values() for r in runs),
    }


def _pct(x: float | None) -> str:
    return "n/a" if x is None else f"{100 * x:.1f}%"


def _arm_rows(columns: Sequence[tuple[str, Json]]) -> list[str]:
    head = "| | " + " | ".join(name for name, _ in columns) + " |"
    rule = "| --- |" + " --- |" * len(columns)

    def row(name: str, cell: Any) -> str:
        return f"| {name} | " + " | ".join(cell(c) for _, c in columns) + " |"

    return [
        head,
        rule,
        row("reads", lambda c: str(c["reads"])),
        row("written rate", lambda c: f"{_pct(c['written_rate'])} ({c['written']})"),
        row("judge pass, may-not-start drafts", lambda c: f"{_pct(c['judge_pass_rate'])} ({c['judge_passed']} of {c['judged']})"),
        row("may-not-start written", lambda c: f"{c['may_not_start_written']} of {c['may_not_start']}"),
        row("shape-duplicate rate", lambda c: f"{_pct(c['shape_rate'])} ({c['duplicated']} of {c['sentences']})"),
        row("written on the first draft / corrected", lambda c: f"{c['first_draft_written']} / {c['corrected_written']}"),
        row("written by the retry writer", lambda c: str(c["rescued_by_retry_writer"])),
        row("longest first sentence (words)", lambda c: str(c["first_sentence_words_max"])),
        row("cost", lambda c: f"${c['cost_usd']:.3f}"),
    ]  # fmt: skip


def _audibility_rows(audible: Mapping[str, Mapping[str, Json]]) -> list[str]:
    lines = [
        "| voice | arm | reads (corrected written) | opener distance | length distance | lean on / off "
        "| status openers on / off | audibility |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for voice in VOICES:
        for arm in VOICED_ARMS:
            a = audible[arm].get(voice.key)
            if a is None:
                continue
            lines.append(
                f"| {voice.key} | {arm} | {a['voiced_reads']} ({a['corrected_reads']}) | {a['opener_distance']:.2f} "
                f"| {a['length_distance']:.2f} | {_pct(a['lean_on'])} / {_pct(a['lean_off'])} "
                f"| {_pct(a['status_openers_on'])} / {_pct(a['status_openers_off'])} | {a['score']:.3f} |"
            )
    return lines


def markdown(c: Mapping[str, Any]) -> str:
    lines = ["## Pooled over the paired runs", "", *_arm_rows([(arm, c["pooled"][arm]) for arm in ARMS]), ""]
    for i, pair in enumerate(c["per_pair"]):
        lines += [f"## Pair {chr(ord('a') + i)}", "", *_arm_rows([(arm, pair[arm]) for arm in ARMS]), ""]
    lines += [
        "Ship bar (the reminder against v1, pooled): "
        + ", ".join(f"{k}: {'met' if ok else 'NOT met'}" for k, ok in c["bar"].items()),
        "",
    ]
    for base, value in c["audibility_by_basis"].items():
        louder = ", ".join(c["louder_by_basis"][base]) or "none"
        lines += [f"## Audibility per voice, pooled, on {base} (up: {louder})", "", *_audibility_rows(value), ""]
    for i, pair in enumerate(c["audibility_per_pair"]):
        lines += [f"### Audibility on {BAR_BASIS}, pair {chr(ord('a') + i)}", "", *_audibility_rows(pair), ""]
    for arm in ARMS:
        lines += [f"Falls, {arm} (pooled):", "", "| why | reads |", "| --- | --- |"]
        lines += [f"| {why} | {n} |" for why, n in c["pooled"][arm]["falls"].items() if why != "written"]
        lines.append("")
    lines += ["## Twelve reads, two per voice: the reminder beside the same player's v1 and voices-off reads", ""]
    for s in c["samples"]:
        status = "may start" if s["may_start"] else "may not start"
        lines += [f"**{s['player']}** ({status}), voice `{s['voice']}`", ""]
        for arm, got in s["arms"].items():
            mark = ", corrected" if got["corrected"] else ""
            lines.append(f"- {arm} ({got['call']}{mark}): {got['text']}")
        lines.append("")
    return "\n".join(lines)  # fmt: skip


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.explore.writer_bakeoff.reminder_compare")
    for arm in ARMS:
        parser.add_argument(f"--{arm}", nargs="+", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--md", required=True, type=Path)
    args = parser.parse_args(argv)
    arms = {arm: [json.loads(p.read_text()) for p in getattr(args, arm)] for arm in ARMS}
    if len({len(runs) for runs in arms.values()}) != 1:
        raise SystemExit("every arm needs the same number of paired runs")
    c = compare(arms)
    args.out.write_text(json.dumps(c, indent=1))
    args.md.write_text(markdown(c))
    return 0


if __name__ == "__main__":
    sys.exit(main())
