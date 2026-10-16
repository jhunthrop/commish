"""HOW LONG A THROTTLE MAY HOLD A PAGE: every wait on a rate limit or a transport failure, in one place.

Lane 52's review (M1): one ask could wait the gateway's own 429 backoffs (or a `retry-after` up to its
300 s cap) inside each of its re-asks, about 12 minutes, or an hour at the cap, where the report said
150 s. Now every throttle wait an ask makes, the gateway's 429 backoffs, its `retry-after`, a
rate-limit line pause, the retry delay and the writer's own re-ask waits (`generate._ask`), is drawn
from one allowance (`AskWaits`, `throttle_ask_wait_cap_ms`), and every ask of a run draws on one pool
(`RunWaits`, `throttle_run_wait_cap_ms`). A wait either allowance cannot cover is not taken: the call
fails as a transport failure naming the cap, and the page falls to its facts block, named throttled.
"""

import threading
from dataclasses import dataclass, field

from research.capsules.config import CAPSULE_CONFIG

_MS: float = 1000.0


class RunWaits:
    """The seconds of throttle waiting a whole run may spend, every page together, across threads."""

    def __init__(self, cap_s: float = CAPSULE_CONFIG.throttle_run_wait_cap_ms / _MS) -> None:
        self._lock = threading.Lock()
        self.cap_s = cap_s
        self.spent_s = 0.0

    def take(self, seconds: float) -> bool:
        with self._lock:
            if self.spent_s + seconds > self.cap_s:
                return False
            self.spent_s += seconds
            return True

    def ask(self) -> "AskWaits":
        """One ask's allowance, drawing on this pool."""
        return AskWaits(self)


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
