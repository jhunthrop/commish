"""THE TWO FOUNDER DECISIONS AND THE LOCK, AS PLAIN SETTINGS IN ONE PLACE (preregistration 3.1 and 3.2).

Both stand as written at the lock unless the founder changes them before it ("FOUNDER DECISION PENDING,
default as written"). Locking changes these values and nothing else: `python -m research.model.weekly5.lock`
rewrites the three assignments below and refuses any other value.

- `SPREADSHEETS`, decision (a): which spreadsheet G6's five lines and G3's spreadsheet line are judged
  against. "both" (the default): each line passes only if it passes against the preregistered sheet AND
  the damped one. "preregistered" or "damped": that sheet alone, the other reported only.
- `FORM_MARGIN`, decision (b): G2 pooled's margin, shared by the last-three guard. The default +0.030.
- `LOCK`: the coordinator's commit of the preregistration with the decisions as answered; None until the
  lock is made, and no run starts without it.
"""

from typing import Final, Literal

Spreadsheets = Literal["both", "preregistered", "damped"]
SPREADSHEET_CHOICES: Final[tuple[Spreadsheets, ...]] = ("both", "preregistered", "damped")

SPREADSHEETS: Final[Spreadsheets] = "both"
FORM_MARGIN: Final[float] = 0.030
LOCK: Final[str | None] = None
