"""`python -m research.explore.writer_bakeoff --url URL --out PATH`: Lane 261's bake-off.

`--voices on|off` (Lane 266) sets the week read's writer voices (`capsules.week.voices.VOICES_ON`) for the
whole run, so one run is one arm; each read records the voice its player is assigned either way. `--reminder
off` (Lane 282) takes the voice reminder out of the corrections for the run, the week read as it stood before
Lane 282. `--angles on|off` (Lane 300) sets the week's angles (`capsules.week.angles.ANGLES_ON`) for the run,
the sheet, the prompt and the checks with them or main's; each read records its sheet's angles and which generic
facts bite. `--retry-model` is the retry writer (Lane 276), production's setting by default and `none` for no
retry writer.

`--url` is the lane's copy (a `lane261_`, `lane282_`, `lane286_`, `lane300_`, `lane302_` or `lane303_` database on the local 5433 server, refused
otherwise). `--at` moves the instant later than the newest board (never earlier), within its board week.
`--limit N` writes only the first N sheets in board order (the smoke run). `--budget` is the hard stop in dollars across
every call. The key is read from the environment or `--env-file`, never printed.
"""

import argparse
import json
import logging
import os
import sys
from collections.abc import Sequence
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from typing import Final

import httpx

from research.capsules.config import CAPSULE_MODEL, writer_settings
from research.capsules.gateway import GatewayClient
from research.capsules.run_budget import RunBudget
from research.capsules.week import angles, prompt, voices
from research.capsules.week.bites import depth_bites, rank_bites, weather_bites
from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.explore.writer_bakeoff.results import build_results
from research.explore.writer_bakeoff.run import (
    dearest_price,
    newest_board_instant,
    read_key,
    read_night,
    rejudge,
    worst_judge_call_usd,
    write_all,
)
from research.logging_setup import configure_logging
from research.model.ros.scratch import check_scratch_url
from research.nightly.capsule_step import checked_price
from research.nightly.week_reads import worst_read_usd

LOG = logging.getLogger("lane261")
DEEPSEEK: Final = "deepseek/deepseek-v4.1-flash"
SCRATCH_PREFIXES: Final = ("lane261_", "lane282_", "lane286_", "lane300_", "lane302_", "lane303_")
NO_RETRY: Final = "none"
DEFAULT_ENV_FILE: Final = Path("/Users/jh/code/fantasy/.env.local")
JUDGE_PROMPT_TOKENS: Final = 1_000


def _parse(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m research.explore.writer_bakeoff")
    parser.add_argument("--url", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--budget", type=float, default=5.00)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--at", type=datetime.fromisoformat, default=None, help="the instant (default: the newest board)"
    )
    parser.add_argument("--models", nargs="+", default=[CAPSULE_MODEL, DEEPSEEK])
    parser.add_argument("--judge", default=CAPSULE_MODEL)
    parser.add_argument("--second-judge", default=DEEPSEEK)
    parser.add_argument("--voices", choices=("on", "off"), default="on" if voices.VOICES_ON else "off")
    parser.add_argument("--reminder", choices=("on", "off"), default="on")
    parser.add_argument("--angles", choices=("on", "off"), default="on" if angles.ANGLES_ON else "off")
    parser.add_argument("--retry-model", default=None, help="the retry writer (default: production's; none: off)")
    return parser.parse_args(argv)


def _retry_model(flag: str | None, production: str | None) -> str | None:
    """The run's retry writer: production's unless the flag names one, none when the flag says so."""
    if flag is None:
        return production
    return None if flag.strip().lower() in ("", NO_RETRY) else flag


def _no_reminder(*_: object, **__: object) -> list[str]:
    return []


def main(argv: Sequence[str] | None = None) -> int:
    configure_logging()
    args = _parse(argv)
    check_scratch_url(args.url, SCRATCH_PREFIXES)
    setattr(voices, "VOICES_ON", args.voices == "on")  # noqa: B010 (a Final switch, set for this run's arm)
    setattr(angles, "ANGLES_ON", args.angles == "on")  # noqa: B010 (a Final switch, set for this run's arm)
    if args.reminder == "off":
        setattr(prompt, "voice_reminder", _no_reminder)  # noqa: B010 (the arm before Lane 282, for this run)
    engine = make_engine(sqlalchemy_url(args.url))
    board_at = newest_board_instant(engine)
    now = board_at if args.at is None else args.at
    if now < board_at:
        raise SystemExit(f"--at {now.isoformat()} is before the newest board {board_at.isoformat()}")
    night = read_night(engine, now)
    sheets = night.sheets if args.limit is None else night.sheets[: args.limit]
    night = replace(night, sheets=sheets)
    LOG.warning("instant %s, board week %d, %d sheets", now.isoformat(), night.board_week, len(sheets))
    key = read_key(os.environ, args.env_file)
    settings = writer_settings(os.environ)
    retry_model = _retry_model(args.retry_model, settings.retry_model)
    models = [*dict.fromkeys([*args.models, args.judge, args.second_judge, *([retry_model] if retry_model else [])])]
    with httpx.Client() as http:
        prices = {m: checked_price(http, key, replace(settings, model=m)) for m in models}
        dearest = dearest_price(list(prices.values()))
        budget = RunBudget.of(usd=args.budget, price=dearest)
        gateway = GatewayClient.for_run(key, http, settings).with_budget(budget)
        lanes = write_all(gateway, sheets, args.models, args.judge, worst_read_usd(dearest), retry_model=retry_model)
        LOG.warning("written: %s", budget.line())
        rejudged = rejudge(gateway, lanes, args.second_judge, worst_judge_call_usd(dearest, JUDGE_PROMPT_TOKENS))
        LOG.warning("rejudged %d drafts: %s", len(rejudged), budget.line())
    run = {
        "models": args.models,
        "judge": args.judge,
        "second_judge": args.second_judge,
        "prices": {m: {"input_per_million": p.input_usd_per_million, "output_per_million": p.output_usd_per_million,
                       "basis": p.basis} for m, p in prices.items()},
        "budget_usd": args.budget,
        "budget": budget.line(),
        "spent_usd": budget.spent_usd,
        "calls": budget.calls_made,
        "limit": args.limit,
        "newest_board_at": board_at.isoformat(),
        "voices": args.voices,
        "reminder": args.reminder,
        "angles": args.angles,
        "retry_model": retry_model,
    }  # fmt: skip
    results = build_results(night, lanes, rejudged, run)
    by_id = {s.player_id: s for s in sheets}
    for read in results["reads"]:
        sheet = by_id[read["player_id"]]
        read["voice"] = voices.voice_for(sheet.season, read["player_id"]).key
        read["position"] = sheet.position
        read["angles"] = [{"key": a.key, "text": a.text, "score": a.score} for a in sheet.angles]
        read["bites"] = {
            "weather": weather_bites(sheet),
            "rank": rank_bites(sheet.allowed),
            "depth": depth_bites(sheet),
        }
    args.out.write_text(json.dumps(results, indent=1, default=str))
    LOG.warning("results at %s", args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
