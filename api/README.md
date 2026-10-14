# api

The prep site's Go API (spec `docs/superpowers/specs/2026-10-12-prep-site-architecture-design.md` §2.2): one module, one image, three commands.

| Command | Runs as | What it does |
|---|---|---|
| `cmd/api` | Cloud Run service `api`; jobs `api-billing-reconcile`, `api-renewal-reminders`, `api-sweep` | the request API; with a job's name as its first argument (`billing-reconcile`, `renewal-reminders`, `sweep`, `stripe-setup`, `grant`) it runs that job and exits |
| `cmd/room` | Cloud Run service `room` | the live room service's WebSocket |
| `cmd/migrate` | Cloud Run job `api-migrate`, before each deploy | applies `migrations/` to the `app` schema and exits |

`openapi.yaml` is the contract. `make gen` writes `internal/apitypes` (Go) and `web/src/lib/api/types.ts` (TypeScript), and `make check-gen` fails when either differs from what is committed.

## Local

```
make db-up        # Postgres 16 on 5433
make test         # go test -race -p 1 ./... against it
make build        # bin/api, bin/room, bin/migrate
```

Every setting is in `.env.example`. The test helper refuses any database whose name does not end in `_test`.

Development and CI connect over TCP (`localhost:5433`). Production's `DATABASE_URL` is the Cloud SQL socket form, `postgres://commish_app:<password>@/commish?host=/cloudsql/trycommish:us-east1:commish-pg`: Cloud Run mounts the socket for every service and job (`--set-cloudsql-instances` in `api.yml`), and the config accepts either a host or a `host` parameter naming a socket directory (`infra/README.md`, Cloud SQL).

## Infrastructure this module relies on

These belong in `infra/README.md`. They are kept here until Lane 1 moves them.

- **Secret Manager** (project `trycommish`, label `lane=api`), read by `api-runtime`: `DATABASE_URL`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `RESEND_API_KEY`. A secret holding only a newline reads as unset, and the feature behind it answers 503 until a real value is added as a new version.
- **Share link keys** (`SHARE_LINK_KEYS`, optional, not yet in Secret Manager): signs the solo room's share links. Unset, the links are signed with a key derived from `WORKOS_COOKIE_PASSWORD`, which is always the last key held. Before rotating the cookie password, create the secret as a fresh key followed by the old cookie password, and add it to `API_SECRETS` in `api.yml`. Otherwise every link already shared stops opening.
- **R2 bucket `commish-exports`**: private, location hint `enam`. The lifecycle rule `exports-expire-7d` deletes objects under `exports/` after seven days. The api reaches it with an R2 S3 access key pair.
- **Repository variables `.github/workflows/api.yml` reads**:
  - `APP_SCHEMA_READY`: `true` runs migrations before each deploy.
  - `ROOM_MIN_INSTANCES`: 0 out of season, 1 from July through September.
  - `STRIPE_ENVIRONMENT`: `test` or `live`.
  - `STRIPE_AUTOMATIC_TAX`: `true` once Stripe Tax is set up.
  - `TRUSTED_PROXY_HOPS`: see below.

## Client addresses and TRUSTED_PROXY_HOPS

Signed-out rate limits key by client address (IPv6 by its /64), read from `X-Forwarded-For` counting `TRUSTED_PROXY_HOPS` entries from the right.

- **`api.trycommish.app` straight to Cloud Run** (a DNS-only record): `1`. Google's front end appends the client.
- **`api.trycommish.app` proxied by Cloudflare**: `2`. Cloudflare appends the client and Google appends the Cloudflare edge. Set the variable to `2` in the same change that turns the proxy on. The `run.app` URL must then be closed to direct traffic, or a caller can skip Cloudflare and choose its own entry.

## Metrics

Each service serves `GET /metrics` on `METRICS_PORT` (default 9464), a second listener that Cloud Run never routes from outside. The format is OpenTelemetry's `http.server.request.duration` histogram, written as Prometheus text: `http_server_request_duration_seconds_{bucket,sum,count}`, with labels for method, route template and status. Scrape it with Cloud Run's managed Prometheus sidecar.
