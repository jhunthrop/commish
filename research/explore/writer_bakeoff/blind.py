"""`python -m research.explore.writer_bakeoff.blind --url URL --arm off=OFF.json --arm on=ON.json --out PATH`: Lane 300.

The blind judge: could this read be about another player? For `--count` players both arms wrote a read for who
play this week, the read with every player's name and every club masked is set beside four players' facts at
his position (his and three others', drawn once with `--seed` and shared by every arm, in one shuffled order),
names, clubs and every figure masked the same way, and the judge is asked which one the read is about. A read built on what is
distinct about his week names facts only his card carries; a read any of the four could carry is a guess. The
hit rate is each arm's share of right answers.

Every card is the full sheet a reader of the card could know (`card`): main's sheet, with every generic fact,
and his angles after it, the same card for every arm, so neither arm is judged on facts only its own writer saw.
"""

import argparse
import json
import os
import random
import re
import sys
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any, Final

import httpx

from research.capsules.config import CAPSULE_MODEL, writer_settings
from research.capsules.gateway import GatewayClient, GenerationError
from research.capsules.generate import ask
from research.capsules.narrative import club_spellings
from research.capsules.run_budget import RunBudget
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week import angles
from research.capsules.week.render import render_week_sheet
from research.capsules.week.sheet import WeekSheet
from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.explore.writer_bakeoff.__main__ import DEFAULT_ENV_FILE, SCRATCH_PREFIXES
from research.explore.writer_bakeoff.run import read_key, read_night
from research.logging_setup import configure_logging
from research.model.ros.scratch import check_scratch_url
from research.nightly.capsule_step import checked_price

Json = dict[str, Any]
OPTIONS: Final = "ABCD"
DISTRACTORS: Final = 3
PLAYER_MASK: Final = "[player]"
CLUB_MASK: Final = "[club]"
# Every figure is masked too (the first run, unmasked, matched all 60 reads in both arms on their figures alone):
# the judge matches on what the read says about his week, not on a number only his card prints.
NUMBER_MASK: Final = "#"
_NUMBER: Final = re.compile(r"\d+(?:[.:]\d+)?")
MAX_TOKENS: Final = 512
_SUFFIXES: Final = frozenset({"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"})
_LETTER: Final = re.compile(r"\b([ABCD])\b")
_SYSTEM: Final = (
    "You match one short fantasy football read to the player it is about. Every player's name, every club's "
    "name and every number is masked. You get the read and four players' facts for the week, A to D. Answer with the one letter of "
    "the player the read is about, and nothing else."
)


@dataclass(frozen=True, slots=True)
class Masker:
    """Every player name (full and last) and every club spelling, longest first, as one pattern each."""

    players: re.Pattern[str]
    clubs: re.Pattern[str]

    @classmethod
    def of(cls, names: Sequence[str]) -> "Masker":
        spelled = set(names)
        for name in names:
            words = [w for w in name.split() if w.lower() not in _SUFFIXES]
            if len(words) > 1 and len(words[-1]) > 3:  # noqa: PLR2004 - a last name, not an initial
                spelled.add(words[-1])
        return cls(_alternation(spelled), _alternation(club_spellings()))

    def mask(self, text: str) -> str:
        named = self.clubs.sub(CLUB_MASK, self.players.sub(PLAYER_MASK, text))
        return _NUMBER.sub(NUMBER_MASK, named)


def _alternation(words: Sequence[str] | set[str]) -> re.Pattern[str]:
    ordered = sorted(set(words), key=len, reverse=True)
    return re.compile(r"\b(?:" + "|".join(re.escape(w) for w in ordered) + r")(?:'s|')?(?!\w)")


@contextmanager
def _main_sheet() -> Iterator[None]:
    """Main's sheet for the span: every generic fact on it."""
    held = angles.ANGLES_ON
    setattr(angles, "ANGLES_ON", False)  # noqa: B010 (a Final switch, set for the card)
    try:
        yield
    finally:
        setattr(angles, "ANGLES_ON", held)  # noqa: B010


def card(sheet: WeekSheet) -> str:
    """Everything a reader of his card could know this week: main's sheet and his angles after it."""
    with _main_sheet():
        text = render_week_sheet(sheet)
    return "\n".join([text, *(a.text for a in sheet.angles)])


def sampled(sheets: Sequence[WeekSheet], written: Sequence[set[str]], count: int, seed: int) -> list[Json]:
    """`count` players every arm wrote who play this week, each with three others at his position, in one order."""
    playing = [s for s in sheets if s.can_play and s.game is not None]
    by_position: dict[str, list[WeekSheet]] = {}
    for sheet in playing:
        by_position.setdefault(sheet.position, []).append(sheet)
    pool = [s for s in playing if all(s.player_id in w for w in written) and len(by_position[s.position]) > DISTRACTORS]
    rng = random.Random(seed)
    picked = rng.sample(pool, min(count, len(pool)))
    out = []
    for sheet in picked:
        others = rng.sample([s for s in by_position[sheet.position] if s.player_id != sheet.player_id], DISTRACTORS)
        options = [sheet, *others]
        rng.shuffle(options)
        out.append({"player_id": sheet.player_id, "options": [o.player_id for o in options]})
    return out


def question(read: str, options: Sequence[WeekSheet], masker: Masker) -> list[dict[str, str]]:
    cards = "\n\n".join(f"Player {OPTIONS[i]}:\n{masker.mask(card(s))}" for i, s in enumerate(options))
    user = f'The read:\n"""{masker.mask(read)}"""\n\n{cards}\n\nWhich player is the read about? One letter.'
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": user}]


def answer_letter(content: str) -> str | None:
    found = _LETTER.findall(content.strip())
    return found[-1] if found else None


def _written(results: Json) -> dict[str, str]:
    return {r["player_id"]: r["text"] for r in results["reads"] if r["source"] == WRITTEN_SOURCE}


def _parse(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m research.explore.writer_bakeoff.blind")
    parser.add_argument("--url", required=True)
    parser.add_argument("--arm", action="append", required=True, help="name=results.json")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--at", type=datetime.fromisoformat, required=True)
    parser.add_argument("--count", type=int, default=60)
    parser.add_argument("--seed", type=int, default=300)
    parser.add_argument("--budget", type=float, default=0.30)
    parser.add_argument("--judge", default=CAPSULE_MODEL)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    return parser.parse_args(argv)


def _ask_all(gateway: GatewayClient, items: Sequence[tuple[str, Json, list[dict[str, str]]]]) -> list[Json]:
    out: list[Json] = []

    def start(item: tuple[str, Json, list[dict[str, str]]]) -> Any:
        arm, row, messages = item

        def work(scoped: GatewayClient) -> Json:
            try:
                got = answer_letter(ask(scoped, messages, MAX_TOKENS, 1).content)
            except GenerationError as error:
                return {"arm": arm, **row, "answer": None, "error": str(error)}
            return {"arm": arm, **row, "answer": got}

        return work

    gateway.rolling(items, start, lambda _, judged: out.append(judged))
    return out


def hit_rates(judged: Sequence[Json]) -> dict[str, Json]:
    arms: dict[str, list[Json]] = {}
    for row in judged:
        arms.setdefault(row["arm"], []).append(row)
    return {
        arm: {
            "asked": len(rows),
            "hits": sum(r["answer"] == r["right"] for r in rows),
            "hit_rate": sum(r["answer"] == r["right"] for r in rows) / len(rows) if rows else 0.0,
            "unanswered": sum(r["answer"] is None for r in rows),
        }
        for arm, rows in arms.items()
    }


def main(argv: Sequence[str] | None = None) -> int:
    configure_logging()
    args = _parse(argv)
    check_scratch_url(args.url, SCRATCH_PREFIXES)
    arms: Mapping[str, Json] = {a.split("=", 1)[0]: json.loads(Path(a.split("=", 1)[1]).read_text()) for a in args.arm}
    setattr(angles, "ANGLES_ON", True)  # noqa: B010 (the cards carry the angles)
    night = read_night(make_engine(sqlalchemy_url(args.url)), args.at)
    by_id = {s.player_id: s for s in night.sheets}
    written = {arm: _written(results) for arm, results in arms.items()}
    rows = sampled(night.sheets, [set(w) for w in written.values()], args.count, args.seed)
    names = sorted({s.name for s in night.sheets} | {n for s in night.sheets for a in s.angles for n in a.names})
    names += [n for s in night.sheets if s.depth is not None for n, _ in s.depth.around]
    masker = Masker.of(names)
    items = []
    for row in rows:
        options = [by_id[pid] for pid in row["options"]]
        right = OPTIONS[row["options"].index(row["player_id"])]
        meta = {"player_id": row["player_id"], "player": by_id[row["player_id"]].name, "right": right}
        for arm, reads in written.items():
            items.append((arm, meta, question(reads[row["player_id"]], options, masker)))
    key = read_key(os.environ, args.env_file)
    settings = replace(writer_settings(os.environ), model=args.judge)
    with httpx.Client() as http:
        price = checked_price(http, key, settings)
        budget = RunBudget.of(usd=args.budget, price=price)
        gateway = GatewayClient.for_run(key, http, settings).with_budget(budget)
        judged = _ask_all(gateway, items)
    result = {"rates": hit_rates(judged), "spent_usd": budget.spent_usd, "judged": judged, "sample": rows}
    args.out.write_text(json.dumps(result, indent=1, default=str))
    print(json.dumps(result["rates"], indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
