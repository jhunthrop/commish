"""ONE STEP'S LINE IN A PASS: its name, its verdict and what it did, shared by every in-season step."""

from dataclasses import dataclass
from typing import Literal

Status = Literal["ok", "skipped", "failed"]


@dataclass(frozen=True, slots=True)
class StepResult:
    step: str
    status: Status
    summary: str
    detail: tuple[str, ...] = ()
