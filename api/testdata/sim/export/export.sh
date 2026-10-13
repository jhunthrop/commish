#!/bin/bash
# Rebuilds api/testdata/sim/board-2026.json and byes-2026.json from the
# local dev database (Postgres on localhost:5432, a copy of production),
# read-only. Refuses any other database: never production.
#
#   api/testdata/sim/export/export.sh
#
# Then rerun scripts/export-mock-logs.ts and scripts/export-continue-fixture.ts,
# which read these two files.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
# ENV_FILE points at another checkout's .env.local (a worktree has none).
url="$(grep -E '^DATABASE_URL=' "${ENV_FILE:-$repo/.env.local}" | cut -d= -f2-)"
case "$url" in
  *localhost:5432*) ;;
  *) echo "export.sh: DATABASE_URL is not the local dev database on 5432; refusing" >&2; exit 1 ;;
esac
export PGOPTIONS='-c default_transaction_read_only=on'
psql "$url" -Atq -f "$here/board.sql" > "$here/../board-2026.json"
psql "$url" -Atq -f "$here/byes.sql" > "$here/../byes-2026.json"
echo "wrote $here/../board-2026.json and byes-2026.json"
