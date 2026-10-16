"""THE DEMOTION: a sentence still on two pages after the graced rewrite costs pages, not the night.

The founder's rule stands: a stock sentence across players is a defect. The coordinator's ruling of
2026-10-16 (Lane 62, after the 2026-10-16T05 night wrote all 536 pages and failed on one sentence):
the defect is cured by demotion, not by failing the night. After the graced rewrite
(`capsule_step._Passes.grace_shared_sentences`), each sentence still shared keeps its first carrier
in board order and demotes every other to the facts block, the honest fallback a blocked page already
has (`capsules.facts_block`), with no model call. The gate then counts those pages as unwritten, and
the night passes while the unwritten share stays under its line.

A demoted row is stamped `RETRY_FIRST_FACTS_HASH` as a page the writer demoted is, and the run keeps
the demotions (`DEMOTED_KEY`, beside the report's `demoted` list), so the next night writes them first
(`SweepPlan.first`) and tells each the sentence it was demoted for (`SweepPlan.avoid_by_page`): a page
is never demoted two nights running for the same sentence without a fresh attempt.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import Connection

from research.capsules.facts_block import FACTS_SOURCE, render_facts_block
from research.capsules.store import RETRY_FIRST_FACTS_HASH, CapsuleWrite, upsert_capsule
from research.capsules.sweep import Subject
from research.nightly.build.pages import slug_of
from research.nightly.capsule_gate import SharedSentence
from research.nightly.config import RUNS_PREFIX

# The last capsule step's demotions, which the next night reads before it writes.
DEMOTED_KEY = f"{RUNS_PREFIX}/capsule-demotions.json"
# One page and the sentence on two pages it was demoted for.
Target = tuple[str, str]


@dataclass(frozen=True, slots=True)
class Demotion:
    """A page demoted to its facts block: its universe id, its public slug, the sentence it shared."""

    player_id: str
    slug: str
    sentence: str

    def json(self) -> dict[str, str]:
        return {"slug": self.slug, "sentence": self.sentence, "playerId": self.player_id}


def demotion_targets(shared: Sequence[SharedSentence], board_order: Sequence[str]) -> tuple[Target, ...]:
    """Every carrier but the first in board order of each shared sentence, each page once. A page
    already demoted for one sentence never keeps another, so the next carrier keeps that one."""
    place = {pid: index for index, pid in enumerate(board_order)}
    demoted: dict[str, str] = {}
    for sentence in shared:
        carriers = sorted(sentence.player_ids, key=lambda p: place.get(p, len(place)))
        standing = [pid for pid in carriers if pid not in demoted]
        for pid in standing[1:]:
            demoted[pid] = sentence.sentence
    return tuple(demoted.items())


def demotion_writes(
    subjects: Sequence[Subject], targets: Sequence[Target], slugs: Mapping[str, str]
) -> tuple[tuple[CapsuleWrite, ...], tuple[Demotion, ...], tuple[str, ...]]:
    """Each target's facts block row (stamped to be written first), its demotion named by the served
    slug (`slugs`, provider id to slug; the web's slug rule otherwise), and the targets with no sheet
    tonight, which cannot be given a facts block."""
    by_id = {subject.universe_id: subject for subject in subjects}
    writes: list[CapsuleWrite] = []
    demoted: list[Demotion] = []
    for pid, sentence in targets:
        subject = by_id.get(pid)
        if subject is None:
            continue
        block = render_facts_block(subject.facts)
        writes.append(CapsuleWrite(pid, RETRY_FIRST_FACTS_HASH, block, block, FACTS_SOURCE, {}, None))
        identity = subject.facts.identity
        demoted.append(Demotion(pid, slugs.get(identity.id) or slug_of(identity.name), sentence))
    unserved = tuple(pid for pid, _ in targets if pid not in by_id)
    return tuple(writes), tuple(demoted), unserved


def write_demotions(conn: Connection, writes: Sequence[CapsuleWrite], at: datetime) -> None:
    for write in writes:
        upsert_capsule(conn, write, at)


def demotion_line(demoted: Sequence[Demotion]) -> str:
    """'2 pages demoted for a shared sentence: <slug>, <slug>'."""
    pages = "page" if len(demoted) == 1 else "pages"
    return f"{len(demoted)} {pages} demoted for a shared sentence: {', '.join(d.slug for d in demoted)}"


def carried_demotions(previous: Mapping[str, Any] | None) -> tuple[Demotion, ...]:
    """The last night's demotions as the run store keeps them (`DEMOTED_KEY`); none when it holds none.
    A malformed entry raises, naming the key."""
    if previous is None:
        return ()
    entries = previous.get("demoted")
    if not isinstance(entries, list):
        raise ValueError(f"{DEMOTED_KEY}: 'demoted' is not a list")
    carried: list[Demotion] = []
    for entry in entries:
        fields = [entry.get(key) if isinstance(entry, dict) else None for key in ("playerId", "slug", "sentence")]
        if not all(isinstance(value, str) and value for value in fields):
            raise ValueError(f"{DEMOTED_KEY}: a demoted entry lacks its playerId, slug or sentence: {entry!r}")
        carried.append(Demotion(*(str(value) for value in fields)))
    return tuple(carried)


def carried_avoid(carried: Sequence[Demotion]) -> dict[str, tuple[str, ...]]:
    """Each carried page to the sentences it was demoted for, quoted into its next prompts."""
    avoid: dict[str, tuple[str, ...]] = {}
    for demotion in carried:
        avoid[demotion.player_id] = (*avoid.get(demotion.player_id, ()), demotion.sentence)
    return avoid
