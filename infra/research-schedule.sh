#!/usr/bin/env bash
# THE RESEARCH SCHEDULE: the Cloud Scheduler jobs that start the research Cloud Run Jobs.
#
#   infra/research-schedule.sh apply     create each job, or update it to this file (PAUSED stays paused)
#   infra/research-schedule.sh verify    describe each job and fail unless its target is <job>:run
#
# Run by hand (the deployer lacks the scheduler role). bash, never zsh: zsh reads "$job:run" as $job
# with the :r modifier, which is how the first six targets became jobs/nightlyun (2026-10-13). The
# target is built in one place, `target_uri`, and `apply` verifies every job after writing it.
set -euo pipefail

PROJECT="trycommish"
REGION="us-east1"
CALLER="research-runtime@trycommish.iam.gserviceaccount.com"
GCLOUD="${GCLOUD:-gcloud}"

# scheduler job | cron | time zone | Cloud Run Job | description
# The weekly pass fires September through February only: it takes its season from the stored
# schedule, and a date no schedule places fails the pass (research/inseason/season_of.py), so an
# offseason firing would only be a failure email.
SCHEDULE=(
  "research-nightly|0 5 * * *|Etc/UTC|nightly|The nightly run (research.nightly run), 05:00 UTC"
  "research-nightly-publish|0 6-12 * * *|Etc/UTC|nightly-publish|The run made public an hour after it passed, and the web build dispatched"
  "research-season-week-tue|0 8 * 1,2,9-12 2|America/New_York|inseason|The register's weekly pass, Tuesday 08:00 ET"
  "research-season-week-wed|0 18 * 1,2,9-12 3|America/New_York|inseason|The register's weekly pass, Wednesday 18:00 ET"
  "research-season-week-thu|0 14 * 1,2,9-12 4|America/New_York|inseason|The register's weekly pass and freeze, Thursday 14:00 ET"
  "research-capture-harvest|0 2,7-23 * * *|America/New_York|inseason-capture|The hourly provider capture, 07:00-23:00 and 02:00 ET"
)

target_uri() {
  local run_job="$1"
  printf 'https://run.googleapis.com/v2/projects/%s/locations/%s/jobs/%s:run' "${PROJECT}" "${REGION}" "${run_job}"
}

verify_one() {
  local name="$1" run_job="$2" uri expected
  expected="$(target_uri "${run_job}")"
  uri="$("${GCLOUD}" scheduler jobs describe "${name}" --project "${PROJECT}" --location "${REGION}" --format 'value(httpTarget.uri)')"
  if [[ "${uri}" != "${expected}" || "${uri}" != *":run" ]]; then
    echo "FAIL ${name}: targets ${uri}, expected ${expected}" >&2
    return 1
  fi
  echo "ok   ${name}: ${uri}"
}

apply_one() {
  local name="$1" cron="$2" zone="$3" run_job="$4" description="$5" verb="create"
  if "${GCLOUD}" scheduler jobs describe "${name}" --project "${PROJECT}" --location "${REGION}" >/dev/null 2>&1; then
    verb="update"
  fi
  "${GCLOUD}" scheduler jobs "${verb}" http "${name}" --project "${PROJECT}" --location "${REGION}" \
    --schedule "${cron}" --time-zone "${zone}" --http-method POST --uri "$(target_uri "${run_job}")" \
    --oauth-service-account-email "${CALLER}" --oauth-token-scope "https://www.googleapis.com/auth/cloud-platform" \
    --attempt-deadline 30s --max-retry-attempts 0 --description "${description}" --quiet >/dev/null
  if [[ "${verb}" == "create" ]]; then
    "${GCLOUD}" scheduler jobs pause "${name}" --project "${PROJECT}" --location "${REGION}" --quiet >/dev/null
  fi
  verify_one "${name}" "${run_job}"
}

main() {
  local command="${1:-verify}" entry name cron zone run_job description failed=0
  for entry in "${SCHEDULE[@]}"; do
    IFS='|' read -r name cron zone run_job description <<<"${entry}"
    case "${command}" in
      apply) apply_one "${name}" "${cron}" "${zone}" "${run_job}" "${description}" || failed=1 ;;
      verify) verify_one "${name}" "${run_job}" || failed=1 ;;
      *) echo "usage: $0 apply|verify" >&2; exit 2 ;;
    esac
  done
  exit "${failed}"
}

main "$@"
