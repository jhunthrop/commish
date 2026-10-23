"""The rendered service alert policies (Lane 152 fix round 1).

Run from research/: `uv run pytest ../infra/lib/test_service_alerts.py`.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

_spec = importlib.util.spec_from_file_location("service_alerts", Path(__file__).with_name("service_alerts.py"))
assert _spec is not None and _spec.loader is not None
alerts = importlib.util.module_from_spec(_spec)
sys.modules["service_alerts"] = alerts
_spec.loader.exec_module(alerts)

CHANNEL = "projects/trycommish/notificationChannels/1"
P95 = "Service api p95 over 3 s"


def query(name: str) -> str:
    body: dict[str, Any] = alerts.policy_body(name, CHANNEL, "")
    promql: str = body["conditions"][0]["conditionPrometheusQueryLanguage"]["query"]
    return promql


def test_the_p95_counts_only_over_the_request_floor() -> None:
    assert query(P95) == (
        "(histogram_quantile(0.95, sum by (le) (rate(run_googleapis_com:request_latencies_bucket"
        '{monitored_resource="cloud_run_revision",service_name="api"}[5m]))) > 3000) and on() '
        '(sum(increase(run_googleapis_com:request_count{monitored_resource="cloud_run_revision",'
        'service_name="api"}[5m])) >= 100)'
    )


def test_the_p95_holds_ten_minutes_on_the_founders_channel() -> None:
    body: dict[str, Any] = alerts.policy_body(P95, CHANNEL, "")
    condition = body["conditions"][0]["conditionPrometheusQueryLanguage"]
    assert condition["duration"] == "600s"
    assert body["notificationChannels"] == [CHANNEL]
    assert body["enabled"] is True


def test_the_room_has_no_latency_policy() -> None:
    assert [name for name in alerts.POLICIES if "p95" in name] == [P95]
