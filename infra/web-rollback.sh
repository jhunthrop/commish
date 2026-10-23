#!/usr/bin/env bash
# THE WEB ROLLBACK (launch audit F5, review H2): put the site back on an earlier run, so that it stays.
#
#   infra/web-rollback.sh <run id>
#
# Both pointers in R2 `commish-runs` move to the run, then web.yml builds it:
#   runs/early.json   {"runId", "finishedAt", "publicAt"}, both times now, so the run is already public
#   runs/latest.json  {"runId"}
# Moving latest.json alone is undone within the hour: the hourly `publish` sets latest to early's run
# whenever they differ (research/nightly/publish.py), and the 30-past backstop rebuilds it. The next
# nightly that passes its gates moves both pointers on again, as it should.
#
# Needs wrangler's Cloudflare login, or CLOUDFLARE_API_TOKEN with R2 write on commish-runs, and gh.
set -euo pipefail

BUCKET="commish-runs"
RUN_ID="${1:-}"
[[ "${RUN_ID}" =~ ^[0-9A-Za-z:._-]+$ ]] || { echo "usage: $0 <run id>" >&2; exit 2; }

WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../web" && pwd)"
DIR="$(mktemp -d)"
trap 'rm -rf "${DIR}"' EXIT
NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
printf '{"runId":"%s","finishedAt":"%s","publicAt":"%s"}' "${RUN_ID}" "${NOW}" "${NOW}" >"${DIR}/early.json"
printf '{"runId":"%s"}' "${RUN_ID}" >"${DIR}/latest.json"

for pointer in early latest; do
  (cd "${WEB}" && npx wrangler r2 object put "${BUCKET}/runs/${pointer}.json" \
    --file "${DIR}/${pointer}.json" --content-type application/json --remote)
  echo "runs/${pointer}.json -> ${RUN_ID}"
done
gh workflow run web.yml --ref main -f runId="${RUN_ID}"
echo "web.yml dispatched for ${RUN_ID}; infra/post-deploy-check.sh ends that run"
