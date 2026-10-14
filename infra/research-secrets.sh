#!/usr/bin/env bash
# THE RESEARCH JOBS' SECRET ACCESS: research-runtime reads exactly the six research secrets, each by its
# own binding, and nothing project-wide (so a research job can never read the app's Stripe, WorkOS or
# database secrets).
#
#   infra/research-secrets.sh apply     bind each secret, then remove any project-level secretAccessor
#   infra/research-secrets.sh verify    fail unless each secret binds it and the project does not
set -euo pipefail

PROJECT="trycommish"
MEMBER="serviceAccount:research-runtime@trycommish.iam.gserviceaccount.com"
ROLE="roles/secretmanager.secretAccessor"
GCLOUD="${GCLOUD:-gcloud}"
SECRETS=(RESEARCH_DATABASE_URL AI_GATEWAY_API_KEY CLOUDFLARE_API_TOKEN TANK01_API_KEY ODDS_API_KEY WEB_DISPATCH_TOKEN)

project_grants() {
  "${GCLOUD}" projects get-iam-policy "${PROJECT}" --flatten="bindings[].members" \
    --filter="bindings.role=${ROLE} AND bindings.members=${MEMBER}" --format="value(bindings.role)"
}

verify() {
  local secret failed=0
  for secret in "${SECRETS[@]}"; do
    if "${GCLOUD}" secrets get-iam-policy "${secret}" --project "${PROJECT}" --flatten="bindings[].members" \
      --filter="bindings.role=${ROLE} AND bindings.members=${MEMBER}" --format="value(bindings.role)" | grep -q .; then
      echo "ok   ${secret}"
    else
      echo "FAIL ${secret}: research-runtime cannot read it" >&2
      failed=1
    fi
  done
  if [[ -n "$(project_grants)" ]]; then
    echo "FAIL the project grants research-runtime ${ROLE} on every secret" >&2
    failed=1
  else
    echo "ok   no project-level ${ROLE}"
  fi
  exit "${failed}"
}

apply() {
  local secret
  for secret in "${SECRETS[@]}"; do
    "${GCLOUD}" secrets add-iam-policy-binding "${secret}" --project "${PROJECT}" --member "${MEMBER}" --role "${ROLE}" --quiet >/dev/null
  done
  if [[ -n "$(project_grants)" ]]; then
    "${GCLOUD}" projects remove-iam-policy-binding "${PROJECT}" --member "${MEMBER}" --role "${ROLE}" --quiet >/dev/null
  fi
  verify
}

case "${1:-verify}" in
  apply) apply ;;
  verify) verify ;;
  *) echo "usage: $0 apply|verify" >&2; exit 2 ;;
esac
