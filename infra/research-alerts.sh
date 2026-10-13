#!/usr/bin/env bash
# THE RESEARCH ALERTS: a failed research job, or a scheduler firing that never started one, emails the
# founder. Weeks 3 to 5 of 2026 died silently; a freeze that fails must reach someone.
#
#   infra/research-alerts.sh apply     create the email channel and the two policies, or leave them as they are
#   infra/research-alerts.sh verify    list them and fail unless both policies are enabled on the channel
#
# Run by hand (bash). It calls the Cloud Monitoring API with the caller's own token, because the
# monitoring policy commands are only in gcloud's alpha component.
set -euo pipefail

PROJECT="trycommish"
EMAIL="jhunthrop@yahoo.com"
CHANNEL_NAME="Research jobs: the founder"
GCLOUD="${GCLOUD:-gcloud}"
API="https://monitoring.googleapis.com/v3/projects/${PROJECT}"
TOKEN="$("${GCLOUD}" auth print-access-token)"

call() { # method, path, [body]
  curl --silent --show-error --fail-with-body -X "$1" "${API}/$2" \
    -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" ${3:+--data "$3"}
}

channel() {
  local found
  found="$(call GET notificationChannels | python3 -c "
import json, sys
for c in json.load(sys.stdin).get('notificationChannels', []):
    if c.get('displayName') == sys.argv[1] and c.get('labels', {}).get('email_address') == sys.argv[2]:
        print(c['name']); break" "${CHANNEL_NAME}" "${EMAIL}")"
  if [[ -z "${found}" && "${1:-}" == "create" ]]; then
    local body
    body="$(channel_body)"
    found="$(call POST notificationChannels "${body}" | python3 -c 'import json, sys; print(json.load(sys.stdin)["name"])')"
  fi
  printf '%s' "${found}"
}

channel_body() {
  python3 - "${CHANNEL_NAME}" "${EMAIL}" <<'PY'
import json, sys
print(json.dumps({"type": "email", "displayName": sys.argv[1], "labels": {"email_address": sys.argv[2]}, "enabled": True}))
PY
}

# The two policies, by display name. Each is created once; a policy already present is left alone.
policy_body() { # display name, channel
  python3 - "$1" "$2" <<'PY'
import json, sys
name, channel = sys.argv[1], sys.argv[2]
jobs = 'resource.label.job_name = one_of("nightly", "nightly-publish", "inseason", "inseason-capture")'
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
    "Research schedule firing failed": {
        "displayName": "A research scheduler firing did not start its job",
        "conditionMatchedLog": {
            "filter": 'resource.type = "cloud_scheduler_job" AND resource.labels.job_id =~ "^research-" AND severity >= ERROR',
        },
    },
}
condition = policies[name]
policy = {
    "displayName": name,
    "combiner": "OR",
    "enabled": True,
    "notificationChannels": [channel],
    "documentation": {
        "content": "A research job failed or never started. Read its execution's log in Cloud Run (or the scheduler job's log); "
        "a failed weekly pass names the step, and a missed freeze is permanent. infra/README.md, The research schedule.",
        "mimeType": "text/markdown",
    },
    "conditions": [{"displayName": condition.pop("displayName"), **condition}],
}
if "conditionMatchedLog" in condition:
    policy["alertStrategy"] = {"notificationRateLimit": {"period": "3600s"}, "autoClose": "86400s"}
print(json.dumps(policy))
PY
}

POLICIES=("Research job execution failed" "Research schedule firing failed")

existing_policy() { # display name
  call GET alertPolicies | python3 -c "
import json, sys
for p in json.load(sys.stdin).get('alertPolicies', []):
    if p.get('displayName') == sys.argv[1]:
        print(p['name'], p.get('enabled', False), ','.join(p.get('notificationChannels', []))); break" "$1"
}

apply() {
  local ch name
  ch="$(channel create)"
  echo "channel ${ch} (${EMAIL})"
  for name in "${POLICIES[@]}"; do
    if [[ -z "$(existing_policy "${name}")" ]]; then
      call POST alertPolicies "$(policy_body "${name}" "${ch}")" >/dev/null
    fi
  done
  verify
}

verify() {
  local ch name line failed=0
  ch="$(channel)"
  [[ -n "${ch}" ]] || { echo "FAIL no email channel for ${EMAIL}" >&2; exit 1; }
  for name in "${POLICIES[@]}"; do
    line="$(existing_policy "${name}")"
    if [[ "${line}" == *" True "*"${ch}"* ]]; then echo "ok   ${name}: ${line}"; else echo "FAIL ${name}: ${line:-missing}" >&2; failed=1; fi
  done
  exit "${failed}"
}

case "${1:-verify}" in
  apply) apply ;;
  verify) verify ;;
  *) echo "usage: $0 apply|verify" >&2; exit 2 ;;
esac
