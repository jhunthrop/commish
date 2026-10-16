"""HOW LONG A THROTTLE MAY HOLD A PAGE: every wait on a rate limit or a transport failure, in one place.

Lane 52's review (M1): one ask could wait the gateway's own 429 backoffs (or a `retry-after` up to its
300 s cap) inside each of its re-asks, about 12 minutes, or an hour at the cap. Now every throttle
wait an ask makes, the gateway's 429 backoffs, its `retry-after`, a rate-limit line pause, the retry
delay and the writer's own re-ask waits (`generate._ask`), is drawn from one allowance (`AskWaits`,
`throttle_ask_wait_cap_ms`, 150 s), and every ask of a run draws on one pool (`RunWaits`). The
gateway's backoffs and the writer's waits are sized so an ask that meets a 429 on every call still
makes all its re-asks inside the 150 s (`config.Retry`, `throttle_waits_ms`).

THE RUN'S POOL (the re-review's N2, ruled): 150 s for every writer slot, twice over (`run_wait_cap_s`:
4,800 s at the default 16 slots), so one bad minute cannot spend it and turn the rest of a long night
into facts blocks. A wait either allowance cannot cover is not taken: the call fails as a transport
failure naming the cap, and the page falls to its facts block, named throttled. When the pool runs
dry the run says so once, loudly (`RunWaits.line`): the spend line and the capsule gate's summary
carry it into the run's report.
"""

import threading
from dataclasses import dataclass, field

from research.capsules.config import CAPSULE_CONFIG

_MS: float = 1000.0


def run_wait_cap_s(concurrency: int) -> float:
    """The run's throttle pool: an ask's cap for every writer slot, `throttle_run_asks_per_slot` times over."""
    return (
        CAPSULE_CONFIG.throttle_ask_wait_cap_ms / _MS * max(1, concurrency) * CAPSULE_CONFIG.throttle_run_asks_per_slot
    )


class RunWaits:
    """The seconds of throttle waiting a whole run may spend, every page together, across threads; and,
    once it runs dry, after how many asks and how many pages fell to facts for it."""

    def __init__(self, cap_s: float | None = None) -> None:
        self._lock = threading.Lock()
        self.cap_s = run_wait_cap_s(CAPSULE_CONFIG.gateway.concurrency) if cap_s is None else cap_s
        self.spent_s = 0.0
        self.asks = 0
        self.dry_after_asks: int | None = None
        self.pages_fallen = 0

    def take(self, seconds: float) -> bool:
        with self._lock:
            if self.spent_s + seconds > self.cap_s:
                if self.dry_after_asks is None:
                    self.dry_after_asks = self.asks
                return False
            self.spent_s += seconds
            return True

    def ask(self) -> "AskWaits":
        """One ask's allowance, drawing on this pool."""
        with self._lock:
            self.asks += 1
        return AskWaits(self)

    @property
    def dry(self) -> bool:
        with self._lock:
            return self.dry_after_asks is not None

    def page_fell(self) -> None:
        """A page fell to its facts block on a throttle after the pool ran dry."""
        with self._lock:
            self.pages_fallen += 1

    def line(self) -> str | None:
        """The run's one loud line once the pool has run dry; None while it has not."""
        with self._lock:
            if self.dry_after_asks is None:
                return None
            pages = "page" if self.pages_fallen == 1 else "pages"
            return (
                f"THROTTLE ALLOWANCE SPENT after {self.dry_after_asks} asks, {self.pages_fallen} {pages} fell to "
                f"facts (the run's {self.cap_s:.0f} s of throttle waits)"
            )


@dataclass(slots=True)
class AskWaits:
    """One ask's throttle waits: at most `throttle_ask_wait_cap_ms`, and only what the run's pool has left."""

    pool: RunWaits
    left_s: float = field(default=CAPSULE_CONFIG.throttle_ask_wait_cap_ms / _MS)

    def take(self, seconds: float) -> bool:
        """Takes `seconds` of waiting when both the ask and the run can cover it; False, taking nothing, when not."""
        if seconds > self.left_s or not self.pool.take(seconds):
            return False
        self.left_s -= seconds
        return True
