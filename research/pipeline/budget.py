"""THE REQUEST BUDGET: every metered upstream call is reserved before it is made.

The TypeScript keeps a Redis-backed daily ledger for the stats provider (`stats-pipeline/budget.ts`)
and a fixed per-run ceiling for the capture harvest. The Python lane has no Redis, so this module
carries the interface both use (`reserve` and the operator-facing refusal) and the fixed per-run
ceiling; the nightly chain (phase D) decides where a durable daily ledger lives.
"""

from dataclasses import dataclass, field
from typing import Protocol

from research.errors import ResearchError


@dataclass(frozen=True)
class Reservation:
    granted: bool
    denial: str | None = None


class RequestBudget(Protocol):
    def reserve(self, count: int) -> Reservation: ...


class BudgetRefusedError(ResearchError):
    """The budget could not cover the next upstream request(s)."""


@dataclass
class FixedBudget:
    """A per-run ceiling that never persists (`fixedBudget` in capture-harvest-job.ts): each
    reservation is judged against the limit alone, exactly as the TypeScript judges it."""

    limit: int
    spent: int = field(default=0)

    def reserve(self, count: int) -> Reservation:
        if count > self.limit:
            return Reservation(False, f"requested {count} request(s) exceeds this run's budget of {self.limit}")
        self.spent += count
        return Reservation(True)


@dataclass
class UnmeteredBudget:
    """Grants everything: the seed's default when no ledger is handed in."""

    def reserve(self, count: int) -> Reservation:
        return Reservation(True)


def reserve_or_raise(budget: RequestBudget, count: int, what: str) -> None:
    """`reserveBackfillOrThrow`: refuse loudly, naming what could not be covered."""
    reservation = budget.reserve(count)
    if reservation.granted:
        return
    raise BudgetRefusedError(
        f"The daily upstream request budget could not cover {what} ({count} requests, denied: {reservation.denial}). "
        "Raise STATS_DAILY_REQUEST_BUDGET to the purchased daily quota, or wait for the day to roll over "
        "(the upstream quota resets daily)."
    )
