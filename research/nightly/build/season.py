"""ADP, THE RECORD, THE CLUBS AND THE SCHEDULE, in the web's run format (`web/src/lib/run/schema.ts`)."""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, Final

from research.model.instants import js_iso
from research.nightly.config import PAGE_FORMAT, TEAMS, RunFormat
from research.nightly.reads import record as record_read
from research.nightly.reads import schedule as schedule_read
from research.nightly.reads.adp import AdpCapture
from research.nightly.register_log import FrozenBy

Json = dict[str, Any]
# A rank correlation is at most one in magnitude; a float sum can land an ulp past it.
_CORRELATION_BOUND: Final = 1.0


def iso(instant: datetime) -> str:
    """An instant as the web's `z.iso.datetime({ offset: true })` reads it, to the millisecond."""
    return js_iso(instant)


def window(start: datetime, end: datetime) -> Json:
    return {"from": iso(start), "to": iso(end)}


def adp_json(formats: Sequence[RunFormat], captures: Mapping[str, AdpCapture]) -> Json:
    """Every source, the formats that blend it, and each player's ADP per source."""
    sources = []
    players: dict[str, dict[str, float]] = {}
    for feed_source in dict.fromkeys(f.adp.source for f in formats):
        capture = captures[feed_source]
        if capture.captured_at is None:
            continue
        sources.append(
            {
                "id": feed_source,
                "drafts": capture.feed.drafts,
                "formats": [f.id for f in formats if f.adp.source == feed_source],
                "window": window(capture.captured_at, capture.captured_at),
            }
        )
        for player_id, adp in capture.by_player.items():
            players.setdefault(player_id, {})[feed_source] = adp
    return {"sources": sources, "players": players}


def format_adp(run_format: RunFormat, captures: Mapping[str, AdpCapture]) -> dict[str, float]:
    """A format's ADP per player, from the one source each format blends today (`RunFormat.adp`)."""
    return dict(captures[run_format.adp.source].by_player)


def _clamped(value: float | None) -> float | None:
    if value is None:
        return None
    return max(-_CORRELATION_BOUND, min(_CORRELATION_BOUND, value))


def _score(score: record_read.Score) -> Json:
    return {"graded": score.graded, "agreement": _clamped(score.agreement), "placesOff": score.places_off}


def _line(line: record_read.Line) -> Json:
    return {"position": line.position, "ours": _score(line.ours), "adp": _score(line.adp)}


def _week(week: record_read.Week, frozen_by: FrozenBy, season: int) -> Json:
    out: Json = {
        "week": week.week,
        "status": week.status,
        "frozenAt": None if week.at is None else iso(week.at),
        "frozenBy": frozen_by.run_id(season, week.week) if week.status in {"frozen", "graded"} else None,
        "gradedAt": None if week.graded_at is None else iso(week.graded_at),
        "population": week.population,
        "lines": [_line(line) for line in week.lines],
    }
    if week.status == "missed":
        out["note"] = record_read.MISSED_NOTE
    return out


def record_json(
    season: int, weeks: Sequence[record_read.Week], to_date: Sequence[record_read.Line], frozen_by: FrozenBy
) -> Json:
    return {
        "season": season,
        "format": PAGE_FORMAT.id,
        "statistic": dict(record_read.STATISTIC),
        "method": record_read.METHOD,
        "weeks": [_week(week, frozen_by, season) for week in weeks],
        "toDate": [_line(line) for line in to_date],
    }


def clubs_json(clubs: Sequence[schedule_read.Club]) -> list[Json]:
    return [{"abbr": c.abbr, "city": c.city, "nickname": c.nickname, "bye": c.bye} for c in clubs]


def schedule_json(
    season: int, slates: Sequence[schedule_read.Slate], values: Mapping[str, schedule_read.OpponentValue]
) -> Json:
    return {
        "season": season,
        "opponentValues": {club: value.value for club, value in sorted(values.items())},
        "opponentBasis": schedule_read.OPPONENT_BASIS,
        "unit": schedule_read.UNIT,
        "slates": [
            {
                "abbr": slate.club,
                "games": [{"week": g.week, "opponent": g.opponent, "home": g.home} for g in slate.games],
                "strength": slate.strength,
                "rank": slate.rank,
                "method": schedule_read.METHOD,
                "window": window(*slate.window),
            }
            for slate in slates
        ],
    }


def format_json(run_format: RunFormat, season: int) -> Json:
    """A format as the manifest lists it, with the basis its board's lead prints, phrase by phrase."""
    basis = [f"{run_format.scoring_words}, full {season} season", "projected before the season's first kickoff"]
    if run_format.shape_words is not None:
        basis.append(run_format.shape_words)
    basis += [f"ranked by points over replacement in a {TEAMS}-team league", "tiers drawn within each position"]
    return {
        "id": run_format.id,
        "label": run_format.label,
        "unit": run_format.unit,
        "teams": TEAMS,
        "basis": basis,
    }
