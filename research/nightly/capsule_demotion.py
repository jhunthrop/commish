"""THE DEMOTION: a sentence still on two pages after the graced rewrite costs pages, not the night.

The founder's rule stands: a stock sentence across players is a defect. The coordinator's ruling of
2026-10-16 (Lane 62, after the 2026-10-16T05 night wrote all 536 pages and failed on one sentence):
the defect is cured by demotion, not by failing the night. After the graced rewrite
(`capsule_step._Passes.grace_shared_sentences`), each sentence still shared keeps its first carrier
in board order and demotes every other to the facts block, the honest fallback a blocked page already
has (`capsules.facts_block`), with no model call. The gate then counts those pages as unwritten, and
the night passes while the unwritten share stays under its line.

Two refinements (the Lane 62 review): a carrier that cannot be demoted (no sheet tonight) is the
keeper before any other, and a page demoted when none of its shared sentences is left on a page still
standing is restored, in board order, so the result never hangs on the sentences' alphabetical order.

A demoted row is stamped `RETRY_FIRST_FACTS_HASH` as a page the writer demoted is, and the run keeps
the demotions (`DEMOTED_KEY`, beside the report's `demoted` list), so the next night writes them first
(`SweepPlan.first`) and tells each the sentence it was demoted for (`SweepPlan.avoid_by_page`): a page
is never demoted two nights running for the same sentence without a fresh attempt.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Connection

from research.capsules.facts_block import FACTS_SOURCE, render_facts_block
from research.capsules.store import RETRY_FIRST_FACTS_HASH, CapsuleWrite, upsert_capsule
from research.capsules.sweep import Subject
from research.nightly.build.pages import slug_of
from research.nightly.capsule_gate import SharedSentence
from research.nightly.config import RUNS_PREFIX

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

# The last capsule step's demotions, which the next night reads before it writes.
DEMOTED_KEY = f"{RUNS_PREFIX}/capsule-demotions.json"
# One page and the shared sentence it is demoted for.
Target = tuple[str, SharedSentence]


@dataclass(frozen=True, slots=True)
class Demotion:
    """A page demoted to its facts block: its universe id, its public slug, the sentence it shared and
    how many pages carried that sentence before the demotion."""

    player_id: str
    slug: str
    sentence: str
    carriers: int

    def json(self) -> dict[str, str | int]:
        return {"slug": self.slug, "sentence": self.sentence, "playerId": self.player_id, "carriers": self.carriers}


def _greedy(
    shared: Sequence[SharedSentence], place: Mapping[str, int], undemotable: frozenset[str]
) -> dict[str, SharedSentence]:
    """Every carrier but the keeper of each sentence: a carrier that cannot be demoted first, then the
    first in board order; a page already demoted never keeps another sentence."""
    demoted: dict[str, SharedSentence] = {}
    for sentence in shared:
        carriers = sorted(sentence.player_ids, key=lambda p: (p not in undemotable, place.get(p, len(place))))
        standing = [pid for pid in carriers if pid not in demoted]
        for pid in standing[1:]:
            demoted[pid] = sentence
    return demoted


def _restored(
    demoted: dict[str, SharedSentence], shared: Sequence[SharedSentence], place: Mapping[str, int]
) -> dict[str, SharedSentence]:
    """The greedy pass's demotions less, in board order, every page none of whose shared sentences is
    still on another page left standing (a restored page stands for the pages after it)."""
    kept = dict(demoted)
    for pid in sorted(demoted, key=lambda p: place.get(p, len(place))):
        sentences = [s for s in shared if pid in s.player_ids]
        if not any(other != pid and other not in kept for s in sentences for other in s.player_ids):
            del kept[pid]
    return kept


def demotion_targets(
    shared: Sequence[SharedSentence], board_order: Sequence[str], undemotable: frozenset[str] = frozenset()
) -> tuple[Target, ...]:
    """The pages to demote, each once with the sentence it is demoted for, in board order."""
    place = {pid: index for index, pid in enumerate(board_order)}
    demoted = _restored(_greedy(shared, place, undemotable), shared, place)
    return tuple(sorted(demoted.items(), key=lambda item: place.get(item[0], len(place))))


def facts_block_write(universe_id: str, facts: "PlayerFacts") -> CapsuleWrite:
    """A page's facts block row, stamped to be written first the next night: a demotion's, and a page
    the page gate fails after a pass no repair judges (`capsule_step._Passes._check_pages`)."""
    block = render_facts_block(facts)
    return CapsuleWrite(universe_id, RETRY_FIRST_FACTS_HASH, block, block, FACTS_SOURCE, {}, None)


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
        writes.append(facts_block_write(pid, subject.facts))
        identity = subject.facts.identity
        slug = slugs.get(identity.id) or slug_of(identity.name)
        demoted.append(Demotion(pid, slug, sentence.sentence, len(sentence.player_ids)))
    unserved = tuple(pid for pid, _ in targets if pid not in by_id)
    return tuple(writes), tuple(demoted), unserved


def write_demotions(conn: Connection, writes: Sequence[CapsuleWrite], at: datetime) -> None:
    for write in writes:
        upsert_capsule(conn, write, at)


def _plural(count: int, word: str) -> str:
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


def demotion_line(demoted: Sequence[Demotion]) -> str:
    """'16 pages demoted for 1 shared sentence ("..." on 17 pages): <slug>, ...', each distinct
    sentence quoted with its carriers, so one stock sentence on many pages reads as what it is."""
    carriers = {d.sentence: d.carriers for d in demoted}
    quoted = ", ".join(f'"{sentence}" on {_plural(count, "page")}' for sentence, count in carriers.items())
    return (
        f"{_plural(len(demoted), 'page')} demoted for {_plural(len(carriers), 'shared sentence')} ({quoted}): "
        f"{', '.join(d.slug for d in demoted)}"
    )


def _demotion(entry: object) -> Demotion:
    texts = [entry.get(key) if isinstance(entry, dict) else None for key in ("playerId", "slug", "sentence")]
    carriers = entry.get("carriers") if isinstance(entry, dict) else None
    if not all(isinstance(value, str) and value for value in texts) or not isinstance(carriers, int):
        raise ValueError(f"{DEMOTED_KEY}: a demoted entry lacks its playerId, slug, sentence or carriers: {entry!r}")
    player_id, slug, sentence = (str(value) for value in texts)
    return Demotion(player_id, slug, sentence, carriers)


def carried_demotions(previous: object) -> tuple[Demotion, ...]:
    """The last night's demotions as the run store keeps them (`DEMOTED_KEY`); none when it holds none.
    Anything malformed raises ValueError, naming the key."""
    if previous is None:
        return ()
    if not isinstance(previous, dict):
        raise ValueError(f"{DEMOTED_KEY}: not an object")
    entries: Any = previous.get("demoted")
    if not isinstance(entries, list):
        raise ValueError(f"{DEMOTED_KEY}: 'demoted' is not a list")
    return tuple(_demotion(entry) for entry in entries)


def carried_avoid(carried: Sequence[Demotion]) -> dict[str, tuple[str, ...]]:
    """Each carried page to the sentences it was demoted for, quoted into its next prompts."""
    avoid: dict[str, tuple[str, ...]] = {}
    for demotion in carried:
        avoid[demotion.player_id] = (*avoid.get(demotion.player_id, ()), demotion.sentence)
    return avoid
