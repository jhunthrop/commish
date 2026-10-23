# shellcheck shell=bash
# THE MONITORING HELPERS, sourced by infra/research-alerts.sh and infra/service-alerts.sh, never run:
# the project, the founder's email channel every alert goes to, and the Cloud Monitoring API called
# with the caller's own gcloud token (the monitoring policy commands are only in gcloud's alpha
# component). A script calls `monitoring_login` once before its first `call`.

# shellcheck disable=SC2034 # PROJECT is read by the scripts that source this file.
PROJECT="trycommish"
EMAIL="jhunthrop@yahoo.com"
CHANNEL_NAME="Research jobs: the founder"
GCLOUD="${GCLOUD:-gcloud}"
API="https://monitoring.googleapis.com/v3/projects/${PROJECT}"
TOKEN=""

monitoring_login() {
  TOKEN="$("${GCLOUD}" auth print-access-token)"
}

call() { # method, path, [body]; a refused call prints the API's own error
  local out
  out="$(curl --silent --show-error --fail-with-body -X "$1" "${API}/$2" \
    -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" ${3:+--data "$3"})" || {
    echo "$1 $2 refused: ${out}" >&2
    return 1
  }
  printf '%s' "${out}"
}

channel_body() {
  python3 - "${CHANNEL_NAME}" "${EMAIL}" <<'PY'
import json, sys
print(json.dumps({"type": "email", "displayName": sys.argv[1], "labels": {"email_address": sys.argv[2]}, "enabled": True}))
PY
}

channel() { # [create]: the founder's email channel's name, created first when asked and missing
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

existing_policy() { # display name: "<name> <enabled> <channel,...>", or nothing
  call GET alertPolicies | python3 -c "
import json, sys
for p in json.load(sys.stdin).get('alertPolicies', []):
    if p.get('displayName') == sys.argv[1]:
        print(p['name'], p.get('enabled', False), ','.join(p.get('notificationChannels', []))); break" "$1"
}
