"""The service alerts' bodies and their check, for infra/service-alerts.sh, which calls the API.

One source for what the alerts are: the three uptime checks, the seven policies on the founder's
channel, and what `verify` holds the live ones to. Reads its inputs from argv and stdin, prints JSON
or check lines, and never calls the network.
"""

from __future__ import annotations  # macOS's /usr/bin/python3 is 3.9, where `Json | None` is not a type yet

import json
import sys
from typing import Any

Json = dict[str, Any]

PROJECT = "trycommish"
RUNBOOK = "infra/README.md, When something breaks"

# An uptime check every five minutes from three US checkers; two failing for five minutes is an outage.
CHECK_PERIOD = "300s"
CHECK_TIMEOUT = "10s"
CHECK_REGIONS = ["USA_OREGON", "USA_IOWA", "USA_VIRGINIA"]
CHECK_FAILING_REGIONS = 1  # more than this many failing checkers opens the incident
CHECK_HOLD = "300s"
CHECK_UPDATE_MASK = "displayName,httpCheck,period,timeout,selectedRegions"

# The Cloud Run request policies: each must hold for ten minutes, over five-minute rates.
ERROR_RATIO = 0.02
SLOW_P95_MS = 3000
# The p95 counts only over this many requests in the rate window: with the uptime checks' three and a
# member's 40 s ESPN connect beside them, one slow request is the p95 of a quiet hour (review H1). At
# 100, the p95 passes 3 s only when at least five requests are slow.
SLOW_P95_MIN_REQUESTS = 100
REQUEST_HOLD = "600s"
RATE_WINDOW = "5m"
EVALUATION_INTERVAL = "60s"
AUTO_CLOSE = "1800s"

# /healthz never reaches Cloud Run: Google's front end answers it with its own 404, so the API and the
# room are checked at /readyz (which also pings the database).
CHECKS = {
    "Commish api readiness": ("api.trycommish.app", "/readyz"),
    "Commish web front page": ("trycommish.app", "/"),
    "Commish room readiness": ("room.trycommish.app", "/readyz"),
}
UPTIME_POLICIES = {
    "Service api unreachable": "Commish api readiness",
    "Service web unreachable": "Commish web front page",
    "Service room unreachable": "Commish room readiness",
}
# The room has no latency policy: a WebSocket is one request for the whole draft, so its latency is
# the session's length and its p95 would be over 3 s whenever a room is open.
ERROR_POLICIES = {"Service api 5xx over 2%": "api", "Service room 5xx over 2%": "room"}
LATENCY_POLICIES = {"Service api p95 over 3 s": "api"}
# Push (Lane 262): the hourly capture's request is advisory (it never fails the capture), so the push job's
# side alerts. The api-notify job catches the starter status producer up and drains the outbox; any error line
# it logs (a failed catch-up, a failed drain, its exit) emails, at most once an hour. An alert on the absence
# of a producer run would need a log-based metric, which these scripts (Cloud Monitoring alone) do not create.
LOG_POLICIES = {
    "Push job error": 'resource.type = "cloud_run_job" AND resource.labels.job_name = "api-notify" '
    'AND jsonPayload.level = "ERROR"',
}
LOG_RATE_LIMIT = "3600s"
POLICIES = [*UPTIME_POLICIES, *ERROR_POLICIES, *LATENCY_POLICIES, *LOG_POLICIES]


def check_body(name: str) -> Json:
    host, path = CHECKS[name]
    return {
        "displayName": name,
        "monitoredResource": {"type": "uptime_url", "labels": {"project_id": PROJECT, "host": host}},
        "httpCheck": {
            "path": path,
            "port": 443,
            "useSsl": True,
            "validateSsl": True,
            "requestMethod": "GET",
            "acceptedResponseStatusCodes": [{"statusValue": 200}],
        },
        "period": CHECK_PERIOD,
        "timeout": CHECK_TIMEOUT,
        "selectedRegions": CHECK_REGIONS,
    }


def uptime_condition(check_id: str) -> Json:
    return {
        "displayName": "Fewer than two of three checkers reach it",
        "conditionThreshold": {
            "filter": 'metric.type = "monitoring.googleapis.com/uptime_check/check_passed" AND '
            f'resource.type = "uptime_url" AND metric.label.check_id = "{check_id}"',
            "aggregations": [
                {
                    "alignmentPeriod": "1200s",
                    "perSeriesAligner": "ALIGN_NEXT_OLDER",
                    "crossSeriesReducer": "REDUCE_COUNT_FALSE",
                    "groupByFields": ["resource.label.*"],
                }
            ],
            "comparison": "COMPARISON_GT",
            "thresholdValue": CHECK_FAILING_REGIONS,
            "duration": CHECK_HOLD,
            "trigger": {"count": 1},
        },
    }


def run_series(metric: str, service: str, extra: str = "") -> str:
    selector = f'monitored_resource="cloud_run_revision",service_name="{service}"{extra}'
    return f"run_googleapis_com:{metric}{{{selector}}}"


def promql_condition(display: str, query: str) -> Json:
    return {
        "displayName": display,
        "conditionPrometheusQueryLanguage": {
            "query": query,
            "duration": REQUEST_HOLD,
            "evaluationInterval": EVALUATION_INTERVAL,
        },
    }


def error_condition(service: str) -> Json:
    server_errors = run_series("request_count", service, ',response_code_class="5xx"')
    errors = f"sum(rate({server_errors}[{RATE_WINDOW}]))"
    total = f"sum(rate({run_series('request_count', service)}[{RATE_WINDOW}]))"
    return promql_condition(
        f"5xx over {ERROR_RATIO:.0%} of {service}'s requests for 10 minutes", f"{errors} / {total} > {ERROR_RATIO}"
    )


def latency_condition(service: str) -> Json:
    buckets = run_series("request_latencies_bucket", service)
    slow = f"(histogram_quantile(0.95, sum by (le) (rate({buckets}[{RATE_WINDOW}]))) > {SLOW_P95_MS})"
    count = f"(sum(increase({run_series('request_count', service)}[{RATE_WINDOW}])) >= {SLOW_P95_MIN_REQUESTS})"
    query = f"{slow} and on() {count}"
    display = f"{service}'s p95 over {SLOW_P95_MS // 1000} s for 10 minutes, at {SLOW_P95_MIN_REQUESTS}+ requests"
    return promql_condition(display, query)


def log_condition(name: str) -> Json:
    return {"displayName": name, "conditionMatchedLog": {"filter": LOG_POLICIES[name]}}


def condition(name: str, check_id: str) -> Json:
    if name in LOG_POLICIES:
        return log_condition(name)
    if name in UPTIME_POLICIES:
        return uptime_condition(check_id)
    if name in ERROR_POLICIES:
        return error_condition(ERROR_POLICIES[name])
    return latency_condition(LATENCY_POLICIES[name])


def policy_body(name: str, channel: str, check_id: str) -> Json:
    strategy: Json = {"autoClose": AUTO_CLOSE}
    if name in LOG_POLICIES:
        strategy["notificationRateLimit"] = {"period": LOG_RATE_LIMIT}
    return {
        "displayName": name,
        "combiner": "OR",
        "enabled": True,
        "notificationChannels": [channel],
        "documentation": {
            "content": f"A Commish service is down, failing or slow for members. {RUNBOOK}.",
            "mimeType": "text/markdown",
        },
        "conditions": [condition(name, check_id)],
        "alertStrategy": strategy,
    }


def find(items: list[Json], name: str) -> Json | None:
    return next((item for item in items if item.get("displayName") == name), None)


def verify_checks(checks: list[Json]) -> list[str]:
    lines = []
    for name, (host, path) in CHECKS.items():
        live = find(checks, name)
        got = live and (live["monitoredResource"]["labels"].get("host"), live.get("httpCheck", {}).get("path"))
        state = "ok  " if got == (host, path) else "FAIL"
        lines.append(f"{state} check {name}: {live['name'] if live else 'missing'} ({host}{path})")
    return lines


def policy_problem(live: Json | None, name: str, checks: list[Json], channel: str) -> str:
    """What is wrong with a live policy against this file, or nothing."""
    if live is None:
        return "missing"
    if channel not in live.get("notificationChannels", []):
        return "not on the founder's channel"
    if not live.get("enabled", False):
        return "disabled"
    if name in UPTIME_POLICIES:
        check = find(checks, UPTIME_POLICIES[name])
        check_id = check["name"].rsplit("/", 1)[-1] if check else "<missing>"
        if check_id not in json.dumps(live.get("conditions", [])):
            return f"does not watch check {check_id}"
    return ""


def verify_policies(policies: list[Json], checks: list[Json], channel: str) -> list[str]:
    lines = []
    for name in POLICIES:
        live = find(policies, name)
        problem = policy_problem(live, name, checks, channel)
        if problem:
            lines.append(f"FAIL policy {name}: {problem}")
        elif live is not None:
            lines.append(f"ok   policy {name}: enabled, {live['name']}")
    return lines


def main(argv: list[str]) -> int:
    command, args = argv[0], argv[1:]
    if command == "checks":
        print("\n".join(CHECKS))
    elif command == "policies":
        print("\n".join(POLICIES))
    elif command == "check-of":
        print(UPTIME_POLICIES.get(args[0], ""))
    elif command == "check-mask":
        print(CHECK_UPDATE_MASK)
    elif command == "check-body":
        print(json.dumps(check_body(args[0])))
    elif command == "policy-body":
        print(json.dumps(policy_body(args[0], args[1], args[2])))
    elif command == "find-check":  # stdin: the uptimeCheckConfigs list
        live = find(json.load(sys.stdin).get("uptimeCheckConfigs", []), args[0])
        print(live["name"] if live else "")
    elif command == "verify":  # channel, the uptimeCheckConfigs list file, the alertPolicies list file
        with open(args[1]) as f:
            checks = json.load(f).get("uptimeCheckConfigs", [])
        with open(args[2]) as f:
            policies = json.load(f).get("alertPolicies", [])
        lines = verify_checks(checks) + verify_policies(policies, checks, args[0])
        print("\n".join(lines))
        return 1 if any(line.startswith("FAIL") for line in lines) else 0
    else:
        print(f"unknown command {command}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
