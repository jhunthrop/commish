"""THE VALIDATION GATES (spec §4), ported from `research-ts/src/nightly/gates.ts` and extended to the
web's run format. A run that fails any gate is written and kept for diagnosis, but no pointer moves,
so the site keeps building from the last clean run. Every failure is a named reason,
`reason:where:detail`, one per finding, so a run report can be grepped and two runs diffed.

1. `held_out_backtest`: the held-out seasons' rank correlation does not drop past the line against
   the last run whose backtest passed; a season that cannot be scored fails.
2. `board_depth`: every format's board covers, league-wide, every starting slot its ranked positions
   alone can fill, and every roster spot but the kicker's and the defense's (market order, never
   board rows).
3. `capsules`: at most 2% of the board's pages unwritten and no written sentence on two pages (the
   capsule step's gate), and every page with a capsule prints at least one of its numbers, each word
   for word and equal to the page's value at the precision printed, with no voice-rule hit.
4. `basis`: every number names its basis: each format its basis phrases and unit, each ADP source
   its drafts and window, each slate its method and window, the record its method and statistics,
   the manifest a source for every feed.
5. `adp`: every format has an ADP source with a stamped capture and players in it.
6. `contract`: what the web's reader checks across files (ids and slugs unique and well formed, the
   index matching the pages, 32 clubs and slates, every pull figure in its prose), so a run the
   build would refuse never moves a pointer.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from research.model.backtest import HeldOutScore
from research.model.domain import BENCH_SLOT
from research.nightly.capsule_gate import CapsuleGateResult
from research.nightly.config import GATES, PROJECTED_POSITIONS, TEAMS, RunFormat

Json = dict[str, Any]
_PLAYER_ID: Final = re.compile(r"^[\w-]+$")
_SLUG: Final = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_CLUBS: Final = 32
_MARKET_ORDER_SLOTS: Final = frozenset({"K", "DEF"})


@dataclass(frozen=True, slots=True)
class GateRecord:
    gate: str
    passed: bool
    reasons: tuple[str, ...]
    summary: str

    def json(self) -> Json:
        return {"gate": self.gate, "passed": self.passed, "reasons": list(self.reasons), "summary": self.summary}


def _gate(name: str, reasons: Sequence[str], context: str) -> GateRecord:
    counts: dict[str, int] = {}
    for reason in reasons:
        counts[reason.split(":")[0]] = counts.get(reason.split(":")[0], 0) + 1
    named = ", ".join(f"{key}: {count}" for key, count in counts.items())
    summary = context if not reasons else f"{len(reasons)} failures ({named}); {context}"
    return GateRecord(name, not reasons, tuple(reasons), summary)


def held_out_gate(current: Sequence[HeldOutScore], previous: Mapping[int, float] | None) -> GateRecord:
    reasons = []
    for score in current:
        if score.rank_correlation is None or score.sample_size == 0:
            reasons.append(f"held_out_unscored:{score.season}")
            continue
        before = None if previous is None else previous.get(score.season)
        if before is not None and before - score.rank_correlation > GATES.max_held_out_drop:
            reasons.append(f"held_out_regressed:{score.season}:{before:.4f}->{score.rank_correlation:.4f}")
    scores = ", ".join(f"{s.season} rho {s.rank_correlation or 0:.4f} n={s.sample_size}" for s in current)
    return _gate("held_out_backtest", reasons, scores + (", the first baseline" if previous is None else ""))


def _depth_findings(run_format: RunFormat, rows: Sequence[Json]) -> list[str]:
    ranked = set(PROJECTED_POSITIONS)
    starting = [s for s in run_format.slots if s.slot != BENCH_SLOT]
    findings = []
    for slot in starting:
        eligible = set(slot.eligible_positions)
        if not eligible <= ranked:
            continue
        demand = sum(s.count for s in starting if set(s.eligible_positions) <= eligible)
        need = TEAMS * demand * GATES.depth_players_per_spot
        have = sum(1 for row in rows if row["position"] in eligible)
        if have < need:
            findings.append(f"board_depth_short:{run_format.id}:{slot.slot}:{have}/{need}")
    spots = sum(s.count for s in run_format.slots if s.slot not in _MARKET_ORDER_SLOTS)
    if len(rows) < TEAMS * spots * GATES.depth_players_per_spot:
        findings.append(f"board_depth_short:{run_format.id}:roster:{len(rows)}/{TEAMS * spots}")
    return findings


def depth_gate(formats: Sequence[RunFormat], boards: Mapping[str, Json]) -> GateRecord:
    reasons = [r for f in formats for r in _depth_findings(f, boards[f.id]["rows"])]
    return _gate(
        "board_depth",
        reasons,
        f"{len(formats)} boards, every ranked slot covered, kickers and defenses in market order",
    )


def capsule_gate(step: CapsuleGateResult, page_reasons: Sequence[str]) -> GateRecord:
    """The capsule step's gate (the unwritten share, shared sentences) and every written page's findings."""
    reasons = (
        [f"capsule_unwritten_share:{step.unwritten_share:.4f}>{step.share_max}"]
        if step.unwritten_share > step.share_max
        else []
    )
    reasons += [f"capsule_shared_sentence:{len(s.player_ids)}:{s.sentence}" for s in step.shared]
    reasons += list(page_reasons)
    return _gate("capsules", reasons, step.summary().removeprefix("capsule gate: "))


def _blank(text: object) -> bool:
    return not isinstance(text, str) or not text.strip()


def basis_gate(manifest: Json, adp: Json, record: Json, schedule: Json) -> GateRecord:
    reasons = []
    for f in manifest["formats"]:
        reasons += [f"basis_missing:format:{f['id']}:{what}" for what in ("label", "unit") if _blank(f[what])]
        reasons += [f"basis_missing:format:{f['id']}:basis" for phrase in f["basis"] or [""] if _blank(phrase)]
    reasons += [f"basis_missing:adp:{s['id']}" for s in adp["sources"] if _blank(s["drafts"]) or "window" not in s]
    reasons += [f"basis_missing:record:{key}" for key in ("method",) if _blank(record[key])]
    reasons += [f"basis_missing:record:statistic:{k}" for k, v in record["statistic"].items() if _blank(v)]
    reasons += [
        f"basis_missing:schedule:{s['abbr']}" for s in schedule["slates"] if _blank(s["method"]) or "window" not in s
    ]
    reasons += [f"basis_missing:schedule:{k}" for k in ("opponentBasis", "unit") if _blank(schedule[k])]
    artifacts = {source["artifact"] for source in manifest["sources"]}
    needed = (
        "boards",
        "adp",
        "schedule",
        "clubs",
        *(("record",) if any(w["status"] in {"frozen", "graded"} for w in record["weeks"]) else ()),
    )
    reasons += [f"basis_missing:source:{a}" for a in needed if a not in artifacts]
    return _gate("basis", reasons, "every number names its basis")


def adp_gate(formats: Sequence[RunFormat], adp: Json) -> GateRecord:
    reasons = []
    for f in formats:
        sources = [s for s in adp["sources"] if f.id in s["formats"]]
        priced = [pid for pid, by_source in adp["players"].items() if any(s["id"] in by_source for s in sources)]
        if not sources or not priced:
            reasons.append(f"adp_missing:{f.id}")
    counts = ", ".join(f"{s['id']} {s['window']['to']}" for s in adp["sources"])
    return _gate("adp", reasons, f"every format has a captured ADP: {counts}")


def contract_gate(
    manifest: Json, index: Sequence[Json], players: Sequence[Json], clubs: Sequence[Json], schedule: Json
) -> GateRecord:
    reasons = [f"contract_player_id:{p['id']}" for p in index if not _PLAYER_ID.match(p["id"])]
    reasons += [f"contract_slug:{p['slug']}" for p in index if not _SLUG.match(p["slug"])]
    for key in ("id", "slug"):
        values = [p[key] for p in index]
        reasons += [f"contract_duplicate_{key}:{v}" for v in sorted({v for v in values if values.count(v) > 1})]
    if len(index) != manifest["players"] or len(players) != len(index):
        reasons.append(f"contract_index_count:{len(index)}/{manifest['players']}/{len(players)}")
    reasons += [
        f"contract_headshot:{p['id']}" for p in index if not str(p.get("headshot") or "").startswith("https://")
    ]
    reasons += [f"contract_clubs:{len(clubs)}"] if len(clubs) != _CLUBS else []
    reasons += [f"contract_slates:{len(schedule['slates'])}"] if len(schedule["slates"]) != _CLUBS else []
    for page in players:
        capsule = page["capsule"]
        if capsule is not None:
            reasons += [
                f"contract_pull_not_in_body:{page['id']}:{p['figure']}"
                for p in capsule["pulls"]
                if p["figure"] not in capsule["body"]
            ]
    return _gate("contract", reasons, f"{len(index)} pages, {len(clubs)} clubs, ids and slugs unique")
