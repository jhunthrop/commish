"""`python -m research.explore.writer_bakeoff.voices_compare OFF.json ON.json --out PATH --md PATH`: Lane 266.

Two bake-off runs of one writer on the same sheets, the voices off and on (`--voices`), set side by side:
the written rate, the falls by cause, the judge's pass on may-not-start drafts, the shape-duplicate rate,
the opener variety on the players both arms wrote (`variety`), tokens and cost per read, the ship bar
(`bar`), and two reads per voice beside the same player's read with the voices off.
"""

import argparse
import json
import sys
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any, Final

from research.capsules.narrative import ShapeMasks, club_spellings
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.voices import VOICES
from research.explore.writer_bakeoff.tally import shape_duplicates
from research.explore.writer_bakeoff.variety import Variety, common_reads, variety

Json = dict[str, Any]
# The ship bar (Lane 266 ruling 5): the written rate not down by more than 2 points, the judge's pass not
# down, the shape-duplicate rate not up, the variety up.
WRITTEN_SLACK: Final = 0.02
PER_VOICE: Final = 2


def _arm(results: Json) -> tuple[Json, list[Json]]:
    (model,) = results["models"].values()
    return model, results["reads"]


def _written(reads: Sequence[Json]) -> dict[str, str]:
    return {r["player_id"]: r["text"] for r in reads if r["source"] == WRITTEN_SOURCE}


def bar(off: Json, on: Json, off_variety: Variety, on_variety: Variety) -> dict[str, bool]:
    """Each test of the ship bar, True when the voices pass it."""
    t_off, t_on = off["tally"], on["tally"]
    return {
        "written rate not down more than 2 points": t_on["written_rate"] >= t_off["written_rate"] - WRITTEN_SLACK,
        "judge pass not down": (t_on["judge_pass_rate"] or 0.0) >= (t_off["judge_pass_rate"] or 0.0),
        "shape-duplicate rate not up": on["shapes"]["rate"] <= off["shapes"]["rate"],
        "variety up": (
            on_variety.first_three_per_100_reads > off_variety.first_three_per_100_reads
            and on_variety.read_first_three_per_100_reads > off_variety.read_first_three_per_100_reads
        ),
    }


def samples(off_reads: Sequence[Json], on_reads: Sequence[Json]) -> list[Json]:
    """Two reads per voice written in both arms: a may-not-start player first when the voice has one."""
    off_by_id = {r["player_id"]: r for r in off_reads if r["source"] == WRITTEN_SOURCE}
    rows = []
    for voice in VOICES:
        mine = [r for r in on_reads if r["voice"] == voice.key and r["source"] == WRITTEN_SOURCE]
        mine = [r for r in mine if r["player_id"] in off_by_id]
        held = [r for r in mine if not r["may_start"]][:1]
        picked = [*held, *[r for r in mine if r["may_start"]]][:PER_VOICE]
        for r in picked:
            off_read = off_by_id[r["player_id"]]
            rows.append(
                {
                    "voice": voice.key,
                    "player": r["player"],
                    "may_start": r["may_start"],
                    "on": {"call": r["call"], "text": r["text"]},
                    "off": {"call": off_read["call"], "text": off_read["text"]},
                }
            )
    return rows


def voice_shares(on_reads: Sequence[Json]) -> dict[str, Json]:
    out: dict[str, Json] = {}
    for voice in VOICES:
        mine = [r for r in on_reads if r["voice"] == voice.key]
        written = sum(r["source"] == WRITTEN_SOURCE for r in mine)
        out[voice.key] = {"reads": len(mine), "written": written, "written_rate": written / len(mine) if mine else 0}
    return out


def compare(off_results: Json, on_results: Json) -> Json:
    off, off_reads = _arm(off_results)
    on, on_reads = _arm(on_results)
    masks = ShapeMasks.of({r["player"] for r in [*off_reads, *on_reads]}, club_spellings())
    off_written, on_written = _written(off_reads), _written(on_reads)
    common_off, common_on = common_reads(off_written, on_written)
    v_off, v_on = variety(common_off, masks), variety(common_on, masks)
    return {
        "runs": {"off": off_results["run"], "on": on_results["run"]},
        "off": {"tally": off["tally"], "falls": off["falls"], "shapes": off["shapes"]},
        "on": {"tally": on["tally"], "falls": on["falls"], "shapes": on["shapes"]},
        "shapes_on_common": {
            "off": asdict(shape_duplicates(common_off, masks)),
            "on": asdict(shape_duplicates(common_on, masks)),
        },
        "variety_common": {"off": asdict(v_off), "on": asdict(v_on)},
        "variety_all": {"off": asdict(variety(off_written, masks)), "on": asdict(variety(on_written, masks))},
        "voice_shares": voice_shares(on_reads),
        "bar": bar(off, on, v_off, v_on),
        "samples": samples(off_reads, on_reads),
        "spent_usd": off_results["run"]["spent_usd"] + on_results["run"]["spent_usd"],
    }


def _pct(x: float | None) -> str:
    return "n/a" if x is None else f"{100 * x:.1f}%"


def _row(name: str, off: str, on: str) -> str:
    return f"| {name} | {off} | {on} |"


def markdown(c: Mapping[str, Any]) -> str:
    t_off, t_on = c["off"]["tally"], c["on"]["tally"]
    v_off, v_on = c["variety_common"]["off"], c["variety_common"]["on"]
    s_off, s_on = c["off"]["shapes"], c["on"]["shapes"]
    lines = [
        "| | voices off | voices on |",
        "| --- | --- | --- |",
        _row("reads", str(t_off["reads"]), str(t_on["reads"])),
        _row(
            "written rate",
            f"{_pct(t_off['written_rate'])} ({t_off['written']})",
            f"{_pct(t_on['written_rate'])} ({t_on['written']})",
        ),
        _row(
            "judge pass, may-not-start drafts",
            f"{_pct(t_off['judge_pass_rate'])} ({t_off['judge_passed']} of {t_off['judged']})",
            f"{_pct(t_on['judge_pass_rate'])} ({t_on['judge_passed']} of {t_on['judged']})",
        ),
        _row(
            "may-not-start written",
            f"{t_off['may_not_start_written']} of {t_off['may_not_start']}",
            f"{t_on['may_not_start_written']} of {t_on['may_not_start']}",
        ),
        _row(
            "shape-duplicate rate",
            f"{_pct(s_off['rate'])} ({s_off['duplicated']} of {s_off['sentences']})",
            f"{_pct(s_on['rate'])} ({s_on['duplicated']} of {s_on['sentences']})",
        ),
        _row("common reads (variety base)", str(v_off["reads"]), str(v_on["reads"])),
        _row(
            "distinct sentence first words per 100 reads",
            f"{v_off['first_words_per_100_reads']:.1f}",
            f"{v_on['first_words_per_100_reads']:.1f}",
        ),
        _row(
            "distinct sentence first-three-word sequences per 100 reads",
            f"{v_off['first_three_per_100_reads']:.1f}",
            f"{v_on['first_three_per_100_reads']:.1f}",
        ),
        _row(
            "distinct read openers (first three words) per 100 reads",
            f"{v_off['read_first_three_per_100_reads']:.1f}",
            f"{v_on['read_first_three_per_100_reads']:.1f}",
        ),
        _row(
            "distinct read first words",
            str(v_off["distinct_read_first_words"]),
            str(v_on["distinct_read_first_words"]),
        ),
        _row("calls per read", f"{t_off['mean_calls']:.2f}", f"{t_on['mean_calls']:.2f}"),
        _row(
            "tokens in / out per read",
            f"{t_off['mean_prompt_tokens']:.0f} / {t_off['mean_completion_tokens']:.0f}",
            f"{t_on['mean_prompt_tokens']:.0f} / {t_on['mean_completion_tokens']:.0f}",
        ),
        _row("cost per read", f"${t_off['cost_per_read']:.5f}", f"${t_on['cost_per_read']:.5f}"),
        "",
        "Ship bar: " + ", ".join(f"{k}: {'met' if ok else 'NOT met'}" for k, ok in c["bar"].items()),
        "",
    ]
    for arm in ("off", "on"):
        lines += [f"Falls, voices {arm}:", "", "| why | reads |", "| --- | --- |"]
        lines += [f"| {why} | {n} |" for why, n in c[arm]["falls"].items()]
        lines.append("")
    lines += ["Voice shares (voices on):", "", "| voice | reads | written |", "| --- | --- | --- |"]
    lines += [
        f"| {k} | {v['reads']} | {v['written']} ({_pct(v['written_rate'])}) |" for k, v in c["voice_shares"].items()
    ]
    lines += ["", "Most used read openers, off then on:", ""]
    for arm in ("off", "on"):
        tops = c["variety_common"][arm]["top_read_openers"]
        lines.append(f"- {arm}: " + ", ".join(f'"{o}" {n}' for o, n in tops))
    lines += ["", "## Twelve reads, two per voice, beside the same player's read with the voices off", ""]
    for s in c["samples"]:
        status = "may start" if s["may_start"] else "may not start"
        lines += [
            f"**{s['player']}** ({status}), voice `{s['voice']}`",
            "",
            f"- on ({s['on']['call']}): {s['on']['text']}",
            f"- off ({s['off']['call']}): {s['off']['text']}",
            "",
        ]
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.explore.writer_bakeoff.voices_compare")
    parser.add_argument("off", type=Path)
    parser.add_argument("on", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--md", required=True, type=Path)
    args = parser.parse_args(argv)
    c = compare(json.loads(args.off.read_text()), json.loads(args.on.read_text()))
    args.out.write_text(json.dumps(c, indent=1))
    args.md.write_text(markdown(c))
    return 0


if __name__ == "__main__":
    sys.exit(main())
