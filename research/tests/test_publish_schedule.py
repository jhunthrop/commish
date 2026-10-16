"""The publish cadence: every hour, at any hour, in the scheduler script and in the skipped-dispatch line."""

import re
from pathlib import Path

import httpx

from research.nightly.publish import DISPATCH_TOKEN_VARIABLE, Dispatcher

REPO_ROOT = Path(__file__).resolve().parents[2]
HOURLY_CRON = "0 * * * *"


def test_the_publish_scheduler_job_fires_every_hour() -> None:
    script = (REPO_ROOT / "infra" / "research-schedule.sh").read_text()
    entry = re.search(r'"research-nightly-publish\|([^|]+)\|', script)
    assert entry is not None
    assert entry.group(1) == HOURLY_CRON


def test_the_web_backstop_fires_every_hour() -> None:
    workflow = (REPO_ROOT / ".github" / "workflows" / "web.yml").read_text()
    assert "- cron: '30 * * * *'" in workflow or '- cron: "30 * * * *"' in workflow


def test_a_missing_dispatch_token_names_the_hourly_rebuild() -> None:
    with httpx.Client() as http:
        outcome = Dispatcher.from_environ(http, {DISPATCH_TOKEN_VARIABLE: ""})
    assert outcome == f"{DISPATCH_TOKEN_VARIABLE} is not set; the web's hourly rebuild builds runs/latest.json instead"
