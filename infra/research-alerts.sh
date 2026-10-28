#!/usr/bin/env bash
# THE RESEARCH ALERTS: a failed research job, or a scheduler firing that never started one, emails the
# founder. Weeks 3 to 5 of 2026 died silently; a freeze that fails must reach someone.
#
#   infra/research-alerts.sh apply           create the email channel and the policies, or bring each to this file
#   infra/research-alerts.sh verify          list them and fail unless each is on the channel as this file says
#   infra/research-alerts.sh verify-live     as verify, and fail unless the absence policies are on too (after cutover)
#   infra/research-alerts.sh enable-absence  turn the absence policies on (the cutover step that resumes the schedule)
#
# THE ABSENCE POLICIES (fix round 2, N5; one condition each, as PromQL requires) are what catch a schedule that never fires: a paused or
# deleted scheduler job starts no execution and logs no error, so the two failure policies stay
# silent. `apply` creates them DISABLED (a paused schedule would fire them at once) and keeps an
# enabled one enabled; `enable-absence` turns them on. All six policies are on since 2026-10-22.
#
# Run by hand (bash). The project, the channel and the API call are infra/lib/monitoring.sh's.
set -euo pipefail

# shellcheck source=infra/lib/monitoring.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/monitoring.sh"
monitoring_login

# The two policies, by display name. Each is created once; a policy already present is left alone.
policy_body() { # display name, channel, absence enabled (true|false)
  python3 - "$1" "$2" "${3:-false}" <<'PY'
import json, sys
name, channel, enabled = sys.argv[1], sys.argv[2], sys.argv[3] == "true"
jobs = 'resource.label.job_name = one_of("nightly", "nightly-publish", "inseason", "inseason-capture", "inseason-status")'
# The selector without its closing brace: each query adds its job_name and closes it.
succeeded = 'run_googleapis_com:job_completed_execution_count{monitored_resource="cloud_run_job",result="succeeded"'
# From September 8 (the first week's freeze passes run by then) through February (review R1: from
# September 1 no pass had succeeded since January, so the alert fired until the first pass ran).
in_season = "and on() ((month() == 9 and day_of_month() >= 8) or month() >= 10 or month() <= 2)"
policies = {
    "Research job execution failed": {
        "displayName": "A research Cloud Run Job execution failed",
        "conditionThreshold": {
            "filter": f'resource.type = "cloud_run_job" AND metric.type = "run.googleapis.com/job/completed_execution_count" AND metric.label.result = "failed" AND {jobs}',
            "aggregations": [{"alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_SUM"}],
            "comparison": "COMPARISON_GT",
            "thresholdValue": 0,
            "duration": "0s",
            "trigger": {"count": 1},
        },
    },
    "Research nightly absent": {
            "displayName": "No successful nightly run in 36 hours",
            "conditionPrometheusQueryLanguage": {
                "query": f'absent_over_time({succeeded},job_name="nightly"}}[36h])',
                "duration": "0s",
                "evaluationInterval": "3600s",
            },
    },
    "Research in-season absent": {
            "displayName": "No successful in-season run (weekly pass or capture) in 72 hours, September 8 through February",
            "conditionPrometheusQueryLanguage": {
                "query": f'absent_over_time({succeeded},job_name=~"inseason|inseason-capture"}}[72h]) {in_season}',
                "duration": "0s",
                "evaluationInterval": "3600s",
            },
    },
    "Research weekly pass absent": {
            "displayName": "No successful weekly pass in 120 hours (its longest gap, Thursday to Tuesday, is 114), September 8 through February",
            "conditionPrometheusQueryLanguage": {
                "query": f'absent_over_time({succeeded},job_name="inseason"}}[120h]) {in_season}',
                "duration": "0s",
                "evaluationInterval": "3600s",
            },
    },
    "Research schedule firing failed": {
        "displayName": "A research scheduler firing did not start its job",
        "conditionMatchedLog": {
            "filter": 'resource.type = "cloud_scheduler_job" AND resource.labels.job_id =~ "^research-" AND severity >= ERROR',
        },
    },
    # Lane 136: a nightly that published with a page its schema gate held back prints one `nightly HELD:`
    # line naming each held page and its refusal (research/nightly/held_pages.py); the line is the email.
    "Research nightly held a page": {
        "displayName": "The nightly published with a player page held back",
        "conditionMatchedLog": {
            "filter": 'resource.type = "cloud_run_job" AND resource.labels.job_name = "nightly" AND textPayload : "nightly HELD:"',
            "labelExtractors": {"held": 'REGEXP_EXTRACT(textPayload, "nightly HELD: (.*)")'},
        },
    },
}
documentation = {
    "Research nightly held a page": "The nightly's schema gate refused a player page and published the run with it held "
    "(its earlier copy, or its board figures alone). The line names each page and what the web's reader said: a "
    "reader/writer drift to fix before the next night. research/nightly/held_pages.py.",
}
conditions = [policies[name]]
policy = {
    "displayName": name,
    "combiner": "OR",
    "enabled": not name.endswith(" absent") or enabled,
    "notificationChannels": [channel],
    "documentation": {
        "content": documentation.get(name, "A research job failed or never started. Read its execution's log in Cloud Run (or the scheduler job's log); "
        "a failed weekly pass names the step, and a missed freeze is permanent. infra/README.md, The research schedule."),
        "mimeType": "text/markdown",
    },
    "conditions": conditions,
}
if "conditionMatchedLog" in conditions[0]:
    policy["alertStrategy"] = {"notificationRateLimit": {"period": "3600s"}, "autoClose": "86400s"}
else:
    # The failure count is sparse: with no data after a failure the incident would stay open for the
    # default seven days and a second failure of the same job would email nothing (fix round 2, N4).
    # It closes after half an hour with no new failure instead, so the next one opens a new incident.
    policy["alertStrategy"] = {"autoClose": "1800s"}
print(json.dumps(policy))
PY
}

POLICIES=("Research job execution failed" "Research schedule firing failed" "Research nightly held a page" "Research nightly absent" "Research in-season absent" "Research weekly pass absent")

apply() { # absence enabled (true|false)
  local ch name line
  ch="$(channel create)"
  echo "channel ${ch} (${EMAIL})"
  for name in "${POLICIES[@]}"; do
    line="$(existing_policy "${name}")"
    if [[ -z "${line}" ]]; then
      call POST alertPolicies "$(policy_body "${name}" "${ch}" "$1")" >/dev/null
    else
      # Brought to this file's body, the absence policy keeping its enabled state unless asked.
      local enabled="$1"
      [[ "${name}" == *" absent" && "${enabled}" == "false" && "${line}" == *" True "* ]] && enabled="true"
      local id="${line%% *}"
      call PATCH "alertPolicies/${id##*/}" "$(policy_body "${name}" "${ch}" "${enabled}")" >/dev/null
    fi
  done
  verify "$1"
}

verify() { # live (true|false): every absence policy must be enabled too
  local ch name line state failed=0
  ch="$(channel)"
  [[ -n "${ch}" ]] || { echo "FAIL no email channel for ${EMAIL}" >&2; exit 1; }
  for name in "${POLICIES[@]}"; do
    line="$(existing_policy "${name}")"
    state="disabled"
    [[ "${line}" == *" True "* ]] && state="enabled"
    if [[ "${line}" != *"${ch}"* ]]; then
      echo "FAIL ${name}: ${line:-missing}" >&2; failed=1
    elif [[ "${state}" == "disabled" && ( "${name}" != *" absent" || "$1" == "true" ) ]]; then
      echo "FAIL ${name}: disabled (${line})" >&2; failed=1
    else
      echo "ok   ${name}: ${state}, ${line%% *}"
    fi
  done
  exit "${failed}"
}

case "${1:-verify}" in
  apply) apply false ;;
  enable-absence) apply true ;;
  verify) verify false ;;
  verify-live) verify true ;;
  *) echo "usage: $0 apply|verify|verify-live|enable-absence" >&2; exit 2 ;;
esac
