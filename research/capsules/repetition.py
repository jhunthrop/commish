"""THE BOARD'S WORN LANGUAGE: whole stock sentences, opener families, refrains and sheet-touring.

Ported from `research-ts/src/capsules/{repetition,sameness}.ts`. A stock sentence is one more than
`max_share` of the written players say (normalized); an opener family is a read's first four words
with his name and numbers masked; a refrain is a configured stem; sheet-touring is a read naming
all three usage shares beside three ranks. A player in anything over its line is queued for a
rewrite, and the flagged language is quoted into the next prompts.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from research.capsules.config import CAPSULE_CONFIG, Repetition
from research.capsules.narrative import sentences_of, sentences_verbatim
from research.model.decide.slots import id_key


@dataclass(frozen=True, slots=True)
class CapsuleRow:
    """What the measures read of one stored capsule, his name beside it to mask his opener."""

    player_id: str
    name: str | None
    body_compact: str
    body_full: str
    source: str
    narrative: Mapping[str, str] | None


@dataclass(frozen=True, slots=True)
class Finding:
    key: str
    example: str
    player_ids: tuple[str, ...]
    share: float


def _sentences_for(narrative: Mapping[str, str] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for value in (narrative or {}).values():
        if isinstance(value, str):
            for normalized, verbatim in zip(sentences_of(value), sentences_verbatim(value), strict=False):
                out.setdefault(normalized, verbatim)
    return out


def stock_sentences(
    rows: Sequence[CapsuleRow], max_share: float = CAPSULE_CONFIG.repetition.max_share
) -> list[Finding]:
    """`stockSentences`: narrative sentences on more than `max_share` of the players with one."""
    with_narrative = [row for row in rows if row.narrative is not None]
    players: dict[str, list[str]] = {}
    examples: dict[str, str] = {}
    for row in with_narrative:
        for sentence, verbatim in _sentences_for(row.narrative).items():
            examples.setdefault(sentence, verbatim)
            players.setdefault(sentence, []).append(row.player_id)
    total = len(with_narrative)
    findings = [
        Finding(sentence, examples[sentence], tuple(ids), len(ids) / total)
        for sentence, ids in players.items()
        if total and len(ids) / total > max_share and len(ids) > 1
    ]
    # A normalized sentence is ASCII by construction, so the oracle's collation orders it.
    return sorted(findings, key=lambda f: (-len(f.player_ids), id_key(f.key)))


_TITLECASE: Final = re.compile(r"^[A-Z][a-z]")
_USAGE_CUES: Final = (
    re.compile(r"\bsnap share\b|\bof (?:the|his team's) snaps\b", re.IGNORECASE),
    re.compile(r"\btarget share\b|\bof (?:the|his team's) targets\b", re.IGNORECASE),
    re.compile(r"\bred[- ]zone\b", re.IGNORECASE),
)
_RANK_CUE: Final = re.compile(r"\b(?:QB|RB|WR|TE)\d{1,2}\b|\bamong \d+\b", re.IGNORECASE)
_RANK_CUES_FOR_A_TOUR: Final = 3


def _bare(token: str) -> str:
    return re.sub(r"^[^a-z0-9']+|[^a-z0-9']+$", "", token, flags=re.IGNORECASE).lower()


def opener_family(text: str, name: str | None, words: int = CAPSULE_CONFIG.repetition.opener_words) -> str:
    """`openerFamily`: the first words, his name and any other name as `_`, a number as `#`."""
    tokens = text.split()[:words]
    names = {w for w in (name or "").lower().split() if w}
    titled = [_TITLECASE.match(t.lstrip("\"'(")) is not None for t in tokens]
    first_is_name = len(tokens) > 1 and titled[1] and _bare(tokens[1]) not in names
    family = []
    for index, token in enumerate(tokens):
        word = _bare(token)
        if word == "":
            continue
        if word in names or (titled[index] and (index > 0 or first_is_name)):
            family.append("_")
        else:
            family.append("#" if re.search(r"\d", word) else word)
    return " ".join(family)


def _opener_example(text: str, name: str | None, words: int) -> str:
    names = {w for w in (name or "").lower().split() if w}
    joined = " ".join("[name]" if _bare(t) in names else t for t in text.split()[:words])
    return re.sub(r"(\[name\]\s+)+\[name\]", "[name]", joined)


def _fold(text: str) -> str:
    return f" {re.sub(r'[^a-z0-9]+', ' ', text.lower()).strip()} "


def contains_stem(text: str, stem: str) -> bool:
    return _fold(stem) in _fold(text)


def tours_the_sheet(text: str) -> bool:
    return all(cue.search(text) for cue in _USAGE_CUES) and len(_RANK_CUE.findall(text)) >= _RANK_CUES_FOR_A_TOUR


def _texts(row: CapsuleRow) -> list[str]:
    return [row.body_compact, row.body_full, *(v for v in (row.narrative or {}).values() if isinstance(v, str))]


@dataclass(frozen=True, slots=True)
class Sameness:
    capsules: int
    openers: tuple[Finding, ...]
    refrains: tuple[Finding, ...]
    sheet_touring: Finding


def measure_sameness(rows: Sequence[CapsuleRow], config: Repetition = CAPSULE_CONFIG.repetition) -> Sameness:
    """`measureSameness` over the written capsules."""
    written = [row for row in rows if row.source == "llm"]
    total = len(written)

    def share(ids: Sequence[str]) -> float:
        return 0.0 if total == 0 else len(ids) / total

    families: dict[str, tuple[str, list[str]]] = {}
    for row in written:
        for read in (row.body_compact, row.body_full):
            family = opener_family(read, row.name, config.opener_words)
            if family:
                example, ids = families.setdefault(family, (_opener_example(read, row.name, config.opener_words), []))
                if row.player_id not in ids:
                    ids.append(row.player_id)
    openers = sorted(
        (Finding(key, example, tuple(ids), share(ids)) for key, (example, ids) in families.items()),
        # Ties in code-point order: a family can hold a letter the ASCII collation does not verify.
        key=lambda f: (-len(f.player_ids), f.key),
    )
    refrains = tuple(
        Finding(stem, stem, ids, share(ids))
        for stem in config.refrain_stems
        for ids in [tuple(row.player_id for row in written if any(contains_stem(t, stem) for t in _texts(row)))]
    )
    touring = [row for row in written if tours_the_sheet(row.body_compact) or tours_the_sheet(row.body_full)]
    example = (
        ""
        if not touring
        else (touring[0].body_compact if tours_the_sheet(touring[0].body_compact) else touring[0].body_full)
    )
    tour = Finding("sheet-touring", example, tuple(r.player_id for r in touring), share([r.player_id for r in touring]))
    return Sameness(total, tuple(openers), refrains, tour)


def _over(finding: Finding, line: float) -> bool:
    return len(finding.player_ids) > 1 and finding.share > line


def players_to_regenerate(
    stock: Sequence[Finding], report: Sameness, config: Repetition = CAPSULE_CONFIG.repetition
) -> list[str]:
    """Everyone saying a stock sentence, in a flagged opener family or refrain, or touring over the line."""
    flagged = [f for f in report.openers if _over(f, config.max_opener_family_share)]
    flagged += [f for f in report.refrains if _over(f, config.max_refrain_share)]
    if _over(report.sheet_touring, config.max_sheet_touring_share):
        flagged.append(report.sheet_touring)
    return list(dict.fromkeys(pid for finding in (*stock, *flagged) for pid in finding.player_ids))


def phrases_to_avoid(
    stock: Sequence[Finding], report: Sameness, config: Repetition = CAPSULE_CONFIG.repetition
) -> tuple[list[str], list[str]]:
    """The stock sentences (worst first, capped) and the flagged stems and openers, for the prompt."""
    sentences = [finding.example for finding in stock[: config.max_quoted_sentences]]
    phrases = [f.key for f in report.refrains if _over(f, config.max_refrain_share)]
    phrases += [f.example for f in report.openers if _over(f, config.max_opener_family_share)]
    return sentences, phrases
