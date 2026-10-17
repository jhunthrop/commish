"""THE VALIDATION GATES (spec §4), ported from `research-ts/src/nightly/gates.ts` and extended to the
web's run format. A run that fails any gate is written and kept for diagnosis, but no pointer moves,
so the site keeps building from the last clean run. Every failure is a named reason,
`reason:where:detail`, one per finding, so a run report can be grepped and two runs diffed.

1. `held_out_backtest`: the held-out seasons' rank correlation does not drop past the line against
   the last run whose backtest passed; a season that cannot be scored fails.
2. `board_depth`: every format's board covers, league-wide, every starting slot its ranked positions
   alone can fill and every roster spot but the kicker's and the defense's with ranked rows, and every
   kicker and defense spot with rows in draft order (market order, Lane 66m), each counted apart.
3. `capsules`: at most the run's line of the board's pages unwritten (2% preseason, 3% in season), no written sentence on two pages (the capsule step's gate;
   six-word spans are counted and repaired, never a failure), and every page with a capsule prints at least one of
   its numbers, each word for word and equal to the page's value at the precision printed, with no
   voice-rule hit, no doubled word and no time frame slip for the run's day.
4. `basis`: every number names its basis: each format its basis phrases and unit, each ADP source
   its drafts and window, each slate its method and window, the record its method and statistics,
   the manifest a source for every feed.
5. `adp`: every format has an ADP source with a stamped capture and players in it.
6. `schema` (`schema_gate.py`): the web's own reader and schema over the whole run, so a run the
   build would refuse never moves a pointer.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from research.model.backtest import HeldOutScore
from research.model.domain import BENCH_SLOT
from research.nightly.build.pages import WEB_POSITION
from research.nightly.capsule_gate import CapsuleGateResult
from research.nightly.config import GATES, MARKET_ORDER, MARKET_POSITIONS, PROJECTED_POSITIONS, TEAMS, RunFormat

Json = dict[str, Any]
_MARKET_ORDER_SLOTS: Final = frozenset(MARKET_POSITIONS)


@dataclass(frozen=True, slots=True)
class GateRecord:
    gate: str
    passed: bool
    reasons: tuple[str, ...]
    summary: str

    def json(self) -> Json:
        return {"gate": self.gate, "passed": self.passed, "reasons": list(self.reasons), "summary": self.summary}


def gate_record(name: str, reasons: Sequence[str], context: str) -> GateRecord:
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
    return gate_record("held_out_backtest", reasons, scores + (", the first baseline" if previous is None else ""))


def _market_rows(rows: Sequence[Json]) -> list[Json]:
    return [row for row in rows if row.get("orderBasis") == MARKET_ORDER]


def _market_findings(run_format: RunFormat, rows: Sequence[Json]) -> list[str]:
    """A kicker and a defense in draft order for every team's starting spot at each."""
    findings = []
    for slot in run_format.slots:
        if slot.slot == BENCH_SLOT or not set(slot.eligible_positions) <= set(MARKET_POSITIONS):
            continue
        eligible = {WEB_POSITION[p] for p in slot.eligible_positions}
        need = TEAMS * slot.count * GATES.depth_players_per_spot
        have = sum(1 for row in rows if row["position"] in eligible)
        if have < need:
            findings.append(f"board_depth_short:{run_format.id}:{slot.slot}:{have}/{need}")
    return findings


def _market_counts(rows: Sequence[Json]) -> str:
    counts = {WEB_POSITION[p]: 0 for p in MARKET_POSITIONS}
    for row in rows:
        counts[row["position"]] = counts.get(row["position"], 0) + 1
    return ", ".join(f"{position} {count}" for position, count in counts.items())


def _depth_findings(run_format: RunFormat, all_rows: Sequence[Json]) -> list[str]:
    market = _market_rows(all_rows)
    rows = [row for row in all_rows if row.get("orderBasis") != MARKET_ORDER]
    ranked = set(PROJECTED_POSITIONS)
    starting = [s for s in run_format.slots if s.slot != BENCH_SLOT]
    findings = _market_findings(run_format, market)
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
    return gate_record(
        "board_depth",
        reasons,
        f"{len(formats)} boards, every ranked slot covered, kickers and defenses in draft order: "
        + "; ".join(sorted({_market_counts(_market_rows(boards[f.id]["rows"])) for f in formats})),
    )


def capsule_gate(step: CapsuleGateResult, page_reasons: Sequence[str]) -> GateRecord:
    """The capsule step's gate (the unwritten share, shared sentences and six-word spans) and every
    written page's findings."""
    reasons = (
        [f"capsule_unwritten_share:{step.unwritten_share:.4f}>{step.line.share_max}:{step.line.voice}"]
        if step.unwritten_share > step.line.share_max
        else []
    )
    reasons += [f"capsule_shared_sentence:{len(s.player_ids)}:{s.sentence}" for s in step.shared]
    reasons += list(page_reasons)
    return gate_record("capsules", reasons, step.summary().removeprefix("capsule gate: "))


def _blank(text: object) -> bool:
    return not isinstance(text, str) or not text.strip()


def basis_gate(manifest: Json, adp: Json, record: Json, schedule: Json) -> GateRecord:
    reasons = []
    for f in manifest["formats"]:
        reasons += [f"basis_missing:format:{f['id']}:{what}" for what in ("label", "unit") if _blank(f[what])]
        reasons += [f"basis_missing:format:{f['id']}:basis" for phrase in f["basis"] or [""] if _blank(phrase)]
    reasons += [f"basis_missing:adp:{s['id']}" for s in adp["sources"] if _blank(s["drafts"]) or "window" not in s]
    priced = {s["id"] for s in adp["sources"]}
    reasons += [
        f"basis_missing:market_order:{f['id']}:{f.get('marketOrder')}"
        for f in manifest["formats"]
        if f.get("marketOrder") not in priced
    ]
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
    return gate_record("basis", reasons, "every number names its basis")


def adp_gate(formats: Sequence[RunFormat], adp: Json) -> GateRecord:
    reasons = []
    for f in formats:
        sources = [s for s in adp["sources"] if f.id in s["formats"]]
        priced = [pid for pid, by_source in adp["players"].items() if any(s["id"] in by_source for s in sources)]
        if not sources or not priced:
            reasons.append(f"adp_missing:{f.id}")
    counts = ", ".join(f"{s['id']} {s['window']['to']}" for s in adp["sources"])
    return gate_record("adp", reasons, f"every format has a captured ADP: {counts}")
