"""`python -m research.explore.writer_bakeoff.angles_compare --arm off=OFF.json --arm on=ON.json --md PATH`: Lane 300.

Two or more bake-off runs on the same sheets set side by side for the angles (`--angles`):
- the written rate and the falls by cause;
- the share of written reads that mention the weather, the depth chart and the opponent's rank (`CATEGORIES`),
  and of those mentions the share where the fact does not bite (`bites`, recorded on each read);
- shared sentence shapes across players (`tally.shape_duplicates`) and the opener families, the first four
  words with names and numbers masked (`repetition.measure_sameness`), the most common with their counts;
- the angles the sheets led with, and twelve paired samples, the named players first.
"""

import argparse
import json
import re
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any, Final

from research.capsules.narrative import ShapeMasks, club_spellings
from research.capsules.repetition import CapsuleRow, measure_sameness
from research.capsules.store import WRITTEN_SOURCE
from research.explore.writer_bakeoff.results import fall_reason
from research.explore.writer_bakeoff.tally import shape_duplicates

Json = dict[str, Any]
# What a read mentioning each generic fact says (the founder's three: "position on depth chart, weather,
# opponent strength").
CATEGORIES: Final = {
    "weather": re.compile(
        r"\b(?:weather|wind(?:s|y)?|mph|rain\w*|snow\w*|storm\w*|forecast|degrees|dome|indoors|roof\w*|outdoors|"
        r"sloppy|wet)\b",
        re.IGNORECASE,
    ),
    "depth": re.compile(
        r"\bdepth\b|\b(?:first|second|third|fourth|fifth) among\b|\batop\b|\btops (?:the|his)\b|\blisted\b|"
        r"\bpecking order\b|\b(?:behind|ahead of) [A-Z]\w+",
        re.IGNORECASE,
    ),
    "rank": re.compile(
        r"\b\d+(?:st|nd|rd|th) of 32\b|\ballow\w*\b|\bgives? up\b|\bgiving up\b|\b(?:fewest|most) (?:ppr )?points\b|"
        r"\bagainst (?:receivers|running backs|tight ends|quarterbacks|wide receivers)\b|\b(?:stingy|stingiest|"
        r"softest|toughest)\b",
        re.IGNORECASE,
    ),
}
BITES_KEY: Final = {"weather": "weather", "depth": "depth", "rank": "rank"}
NAMED: Final = ("Rachaad White", "Puka Nacua", "Josh Downs")
SAMPLES: Final = 12
OPENER_TOP: Final = 8


def _written(results: Json) -> list[Json]:
    return [r for r in results["reads"] if r["source"] == WRITTEN_SOURCE]


def categories(reads: Sequence[Json]) -> dict[str, Json]:
    """Each category's share of `reads`, and of its mentions the ones where the fact does not bite."""
    out = {}
    for name, pattern in CATEGORIES.items():
        hits = [r for r in reads if pattern.search(r["text"])]
        off = [r for r in hits if not r.get("bites", {}).get(BITES_KEY[name], True)]
        out[name] = {
            "mentions": len(hits),
            "share": len(hits) / len(reads) if reads else 0.0,
            "where_it_does_not_bite": len(off),
            "bites_on_sheets": sum(bool(r.get("bites", {}).get(BITES_KEY[name])) for r in reads),
        }
    return out


def openers(reads: Sequence[Json]) -> list[Json]:
    rows = [CapsuleRow(r["player_id"], r["player"], r["text"], r["text"], "llm", None) for r in reads]
    found = measure_sameness(rows).openers
    return [{"family": f.key, "example": f.example, "players": len(f.player_ids)} for f in found[:OPENER_TOP]]


def arm_summary(results: Json, masks: ShapeMasks) -> Json:
    (model,) = results["models"].values()
    reads = results["reads"]
    written = _written(results)
    leads = Counter(r["angles"][0]["key"] for r in reads if r.get("angles"))
    return {
        "reads": len(reads),
        "written": len(written),
        "written_rate": len(written) / len(reads) if reads else 0.0,
        "spent_usd": results["run"]["spent_usd"],
        "falls": dict(
            Counter(fall_reason(r["fallback"]) for r in reads if r["source"] != WRITTEN_SOURCE).most_common()
        ),
        "categories": categories(written),
        "shapes": asdict(shape_duplicates({r["player_id"]: r["text"] for r in written}, masks)),
        "openers": openers(written),
        "lead_angles": dict(leads.most_common()),
        "tally": model["tally"],
    }


def samples(arms: Mapping[str, Json]) -> list[Json]:
    """Twelve players every arm wrote: the named ones first, the rest spread over the board."""
    written = {arm: {r["player_id"]: r for r in _written(results)} for arm, results in arms.items()}
    common = [pid for pid in next(iter(written.values())) if all(pid in w for w in written.values())]
    first = next(iter(written.values()))
    named = [pid for pid in common if first[pid]["player"] in NAMED]
    rest = [pid for pid in common if pid not in named]
    step = max(1, len(rest) // max(1, SAMPLES - len(named)))
    picked = [*named, *rest[::step]][:SAMPLES]
    return [
        {
            "player": first[pid]["player"],
            "sheet_angles": [a["text"] for a in arms_read(written, pid)],
            **{arm: {"call": w[pid]["call"], "text": w[pid]["text"]} for arm, w in written.items()},
        }
        for pid in picked
    ]


def arms_read(written: Mapping[str, Mapping[str, Json]], player_id: str) -> list[Json]:
    """His angles as the angles arm's sheet carried them (any arm that recorded some)."""
    return next((w[player_id]["angles"] for w in written.values() if w[player_id].get("angles")), [])


def markdown(summary: Mapping[str, Json], picked: Sequence[Json]) -> str:
    lines = ["| | " + " | ".join(summary) + " |", "| --- |" + " --- |" * len(summary)]

    def row(label: str, cell: Any) -> None:
        lines.append(f"| {label} | " + " | ".join(str(cell(s)) for s in summary.values()) + " |")

    row("written rate", lambda s: f"{s['written_rate']:.1%} ({s['written']}/{s['reads']})")
    for name in CATEGORIES:
        row(
            f"mentions {name}",
            lambda s, n=name: (
                f"{s['categories'][n]['share']:.1%} ({s['categories'][n]['mentions']}; "
                f"{s['categories'][n]['where_it_does_not_bite']} where it does not bite)"
            ),
        )
    row(
        "shape-duplicate rate",
        lambda s: f"{s['shapes']['rate']:.1%} ({s['shapes']['duplicated']}/{s['shapes']['sentences']})",
    )
    row("spent", lambda s: f"${s['spent_usd']:.3f}")
    for arm, s in summary.items():
        lines += ["", f"### {arm}: falls", *(f"- {n} x {why}" for why, n in s["falls"].items())]
        lines += [
            "",
            f"### {arm}: opener families",
            *(f"- {o['players']} x `{o['family']}` ({o['example']})" for o in s["openers"]),
        ]
        if s["lead_angles"]:
            lines += ["", f"### {arm}: lead angles", *(f"- {k}: {n}" for k, n in s["lead_angles"].items())]
    lines += ["", "### Paired samples"]
    for p in picked:
        lines += ["", f"**{p['player']}**", *(f"- angle: {a}" for a in p["sheet_angles"])]
        lines += [f"- {arm} ({p[arm]['call']}): {p[arm]['text']}" for arm in summary]
    return "\n".join(lines) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.explore.writer_bakeoff.angles_compare")
    parser.add_argument("--arm", action="append", required=True, help="name=results.json")
    parser.add_argument("--md", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)
    arms = {a.split("=", 1)[0]: json.loads(Path(a.split("=", 1)[1]).read_text()) for a in args.arm}
    names = {r["player"] for results in arms.values() for r in results["reads"]}
    masks = ShapeMasks.of(sorted(names), club_spellings())
    summary = {arm: arm_summary(results, masks) for arm, results in arms.items()}
    picked = samples(arms)
    args.md.write_text(markdown(summary, picked))
    if args.out is not None:
        args.out.write_text(json.dumps({"summary": summary, "samples": picked}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
