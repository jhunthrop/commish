#!/usr/bin/env bash
# THE SERVICE ALERTS: the API, the room or the web down, failing or slow emails the founder, on the
# research alerts' channel (launch audit F1). What the checks and policies are is
# infra/lib/service_alerts.py; this file only calls the API.
#
#   infra/service-alerts.sh apply              create the uptime checks and the policies, or bring each to the file
#   infra/service-alerts.sh apply --dry-run    print every request apply would send, and call nothing (no gcloud)
#   infra/service-alerts.sh verify             fail unless each check and policy is live, enabled and on the channel
#
# Uptime checks every five minutes from three US checkers: https://api.trycommish.app/readyz,
# https://trycommish.app/ and https://room.trycommish.app/readyz. Policies: each unreachable (two of
# three checkers failing for five minutes); the api's and the room's 5xx over 2% of requests for ten
# minutes; the api's p95 latency over 3 s for ten minutes (the room has none, its WebSockets are one
# long request each). The channel is research-alerts.sh's; run that one's apply first on a new project.
#
# Run by hand (bash). The project, the channel and the API call are infra/lib/monitoring.sh's.
set -euo pipefail

HERE="$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=infra/lib/monitoring.sh
source "${HERE}/lib/monitoring.sh"
SPEC=(python3 "${HERE}/lib/service_alerts.py")
DRY_RUN="false"
DRY_CHANNEL="projects/${PROJECT}/notificationChannels/<the founder's channel>"

spec() { "${SPEC[@]}" "$@"; }

slug() { printf 'dry-run-%s' "$1" | tr '[:upper:] ' '[:lower:]-'; }

dry_call() { # as call: prints each change on stdout (fd 3) and answers an empty list or a made-up name
  local name
  if [[ "$1" == "GET" ]]; then
    printf '{}'
    return
  fi
  printf '%s %s\n%s\n\n' "$1" "$2" "$3" >&3
  name="$(printf '%s' "$3" | python3 -c 'import json, sys; print(json.load(sys.stdin)["displayName"])')"
  printf '{"name": "projects/%s/%s/%s"}' "${PROJECT}" "${2%%/*}" "$(slug "${name}")"
}

request() { # as call, or dry_call under --dry-run
  if [[ "${DRY_RUN}" == "true" ]]; then dry_call "$@"; else call "$@"; fi
}

check_name() { # display name: the live check's resource name, or nothing
  request GET uptimeCheckConfigs | spec find-check "$1"
}

apply_check() { # display name: the check's resource name after creating it or bringing it to the file
  local body found
  body="$(spec check-body "$1")"
  found="$(check_name "$1")"
  if [[ -z "${found}" ]]; then
    request POST uptimeCheckConfigs "${body}" | python3 -c 'import json, sys; print(json.load(sys.stdin)["name"])'
  else
    request PATCH "uptimeCheckConfigs/${found##*/}?updateMask=$(spec check-mask)" "${body}" >/dev/null
    printf '%s\n' "${found}"
  fi
}

apply_policy() { # display name, channel, check id (empty for a request policy)
  local body line
  body="$(spec policy-body "$1" "$2" "$3")"
  line=""
  [[ "${DRY_RUN}" == "true" ]] || line="$(existing_policy "$1")"
  if [[ -z "${line}" ]]; then
    request POST alertPolicies "${body}" >/dev/null
  else
    local id="${line%% *}"
    request PATCH "alertPolicies/${id##*/}" "${body}" >/dev/null
  fi
}

watched_check_id() { # policy display name: the id of the check it watches, nothing for a request policy
  local check found
  check="$(spec check-of "$1")"
  [[ -n "${check}" ]] || return 0
  if [[ "${DRY_RUN}" == "true" ]]; then
    slug "${check}"
    return
  fi
  found="$(check_name "${check}")"
  [[ -n "${found}" ]] || { echo "FAIL $1: no uptime check ${check}" >&2; return 1; }
  printf '%s' "${found##*/}"
}

apply() {
  local ch name found
  if [[ "${DRY_RUN}" == "true" ]]; then ch="${DRY_CHANNEL}"; else ch="$(channel)"; fi
  [[ -n "${ch}" ]] || { echo "FAIL no email channel for ${EMAIL}: run infra/research-alerts.sh apply first" >&2; exit 1; }
  echo "channel ${ch} (${EMAIL})"
  while IFS= read -r name; do
    found="$(apply_check "${name}")"
    echo "check ${name}: ${found}"
  done < <(spec checks)
  while IFS= read -r name; do
    found="$(watched_check_id "${name}")"
    apply_policy "${name}" "${ch}" "${found}"
    echo "policy ${name}"
  done < <(spec policies)
  [[ "${DRY_RUN}" == "true" ]] || verify
}

verify() {
  local ch
  ch="$(channel)"
  [[ -n "${ch}" ]] || { echo "FAIL no email channel for ${EMAIL}" >&2; exit 1; }
  LISTS="$(mktemp -d)"
  trap 'rm -rf "${LISTS}"' EXIT
  call GET uptimeCheckConfigs >"${LISTS}/checks.json"
  call GET alertPolicies >"${LISTS}/policies.json"
  spec verify "${ch}" "${LISTS}/checks.json" "${LISTS}/policies.json"
}

exec 3>&1
case "${1:-verify} ${2:-}" in
  "apply --dry-run") DRY_RUN="true"; apply ;;
  "apply ") monitoring_login; apply ;;
  "verify ") monitoring_login; verify ;;
  *) echo "usage: $0 apply [--dry-run] | verify" >&2; exit 2 ;;
esac
