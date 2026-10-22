#!/usr/bin/env bash
# THE POST-DEPLOY CHECK (launch audit F1): the last step of api.yml's and web.yml's deploy jobs. Each
# address must answer 200; one that does not is asked once more after 30 s (a Worker deploy takes a
# moment to reach every edge, a new revision a cold start), and the job fails if it still does not.
#
#   infra/post-deploy-check.sh https://api.trycommish.app/readyz https://room.trycommish.app/readyz
set -euo pipefail

RETRY_AFTER_SECONDS="${RETRY_AFTER_SECONDS:-30}"
TIMEOUT_SECONDS=20

[[ $# -gt 0 ]] || { echo "usage: $0 <url>..." >&2; exit 2; }

status() { # url: the status it answered, 000 when nothing answered
  curl --silent --output /dev/null --write-out '%{http_code}' --max-time "${TIMEOUT_SECONDS}" "$1" || true
}

failed=0
for url in "$@"; do
  code="$(status "${url}")"
  if [[ "${code}" != "200" ]]; then
    echo "${url} answered ${code}; asking again in ${RETRY_AFTER_SECONDS} s"
    sleep "${RETRY_AFTER_SECONDS}"
    code="$(status "${url}")"
  fi
  if [[ "${code}" == "200" ]]; then
    echo "${url} answered 200"
  else
    echo "::error::${url} answered ${code} after one retry"
    failed=1
  fi
done
exit "${failed}"
