"""THE WRITER'S PACE: one token bucket every gateway call of a run draws from, across threads.

The bucket holds at most `capacity` tokens and refills at `calls_per_minute`; a call takes one, and
when none is left it reserves the next and sleeps until it is due, so callers are served in the
order they asked and the long-run rate never passes the cap. A whole-line pause (`pause_until`) is
only for when the gateway's own answer says the limit is spent for everyone (its rate-limit headers);
an ordinary 429 is backed off by the one call that met it (`gateway.GatewayClient.complete`).
The clock and the sleep are injected so the tests run on a fake clock.
"""

import threading
import time
from collections.abc import Callable

_SECONDS_PER_MINUTE = 60.0


class TokenBucket:
    def __init__(
        self,
        calls_per_minute: int,
        capacity: int,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if calls_per_minute < 1 or capacity < 1:
            raise ValueError(f"a bucket needs a rate and a capacity of at least 1 ({calls_per_minute}, {capacity})")
        self.calls_per_minute = calls_per_minute
        self.capacity = capacity
        self._rate = calls_per_minute / _SECONDS_PER_MINUTE
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._tokens = float(capacity)
        self._stamp = clock()
        self._paused_until = 0.0

    def _refill(self, now: float) -> None:
        self._tokens = min(float(self.capacity), self._tokens + (now - self._stamp) * self._rate)
        self._stamp = now

    def acquire(self) -> float:
        """Takes one token, sleeping until it is due; returns the seconds waited."""
        with self._lock:
            now = self._clock()
            self._refill(now)
            self._tokens -= 1.0
            due = now if self._tokens >= 0 else now - self._tokens / self._rate
            wait = max(due, self._paused_until) - now
        if wait > 0:
            self._sleep(wait)
        return max(0.0, wait)

    def pause_until(self, moment: float) -> None:
        """No call starts before `moment` (on this bucket's clock), whoever asks."""
        with self._lock:
            self._paused_until = max(self._paused_until, moment)

    def pause_for(self, seconds: float) -> None:
        self.pause_until(self._clock() + seconds)
