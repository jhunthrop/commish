# Infrastructure

The prep site runs on three providers, provisioned on 2026-10-12 (spec §2, `docs/superpowers/specs/2026-10-12-prep-site-architecture-design.md`). Nothing here holds a secret. Secrets live in GitHub Actions secrets, GCP Secret Manager and each developer's git-ignored `.env.local`.

## Cloudflare (the edge)

- Account `1f1504a52d74d323c0a5648a766e0871`, zone `trycommish.app` (`704792f55d2ebfc79e24c618bbfd0c9b`), nameservers `coby.ns.cloudflare.com` and `lady.ns.cloudflare.com`, set at the registrar (Namecheap) on 2026-10-12.
- DNS today: one DNS-only A record for the apex pointing at the Vercel deployment that still serves the league platform. It changes at cutover (spec §10).
- R2 bucket `commish-runs` for the nightly runs (spec §2.1), location hint `enam`.
- R2 bucket `commish-exports`, private, for sheet exports (`api/internal/exports`), location hint `enam`, with the lifecycle rule `exports-expire-7d` deleting objects under `exports/` after seven days. The api reaches it with an R2 S3 access key pair (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` in Secret Manager).
- The web app deploys with wrangler as Workers static assets (`web/wrangler.jsonc`, Lane 0 and Lane 5). GitHub Actions uses the secret `CLOUDFLARE_API_TOKEN` (account token: Workers Scripts Edit, Zone DNS Edit, R2 Edit) and the variable `CLOUDFLARE_ACCOUNT_ID`.

## Google Cloud (the services)

- Project `trycommish` (number `467414876046`) in the `derbee.ai` organization, billing account shared with foreversixty, region `us-east1`.
- APIs: Cloud Run, Artifact Registry, IAM, IAM Credentials, STS, Secret Manager, Cloud Scheduler, Resource Manager, Logging, Monitoring.
- Artifact Registry: `us-east1-docker.pkg.dev/trycommish/commish` (Docker). Images: `api` (one image, two Cloud Run services `api` and `room`), `research` (the Cloud Run Job `nightly` and the service `advisor`).
- Service accounts:
  - `deployer@trycommish.iam.gserviceaccount.com`: GitHub Actions. Roles `run.admin`, `artifactregistry.writer`, `run.jobsExecutorWithOverrides`, and `iam.serviceAccountUser` on the two runtime accounts.
  - `api-runtime@trycommish.iam.gserviceaccount.com`: the `api` and `room` services.
  - `research-runtime@trycommish.iam.gserviceaccount.com`: the `nightly` job and the `advisor` service.
  - Both runtime accounts: `secretmanager.secretAccessor`, `logging.logWriter`, `monitoring.metricWriter`.
- Workload identity federation, no stored keys: pool `github`, provider `github` (OIDC from `token.actions.githubusercontent.com`, condition `assertion.repository == 'jhunthrop/commish'`), bound to the deployer for that repository's runs.
- GitHub Actions variables: `GCP_PROJECT`, `GCP_PROJECT_NUMBER`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`, `GCP_ARTIFACT_REPO`.
- Secret Manager, label `lane=api`, read by `api-runtime` and referenced by `.github/workflows/api.yml`: `DATABASE_URL`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `RESEND_API_KEY`. A secret holding only a newline reads as unset, and the feature behind it answers 503 until the real value is added as a new version.
- `.github/workflows/api.yml` also reads the optional variables `APP_SCHEMA_READY` (true runs migrations before each deploy), `ROOM_MIN_INSTANCES` (0 out of season, 1 July through September), `STRIPE_ENVIRONMENT` (test or live) and `STRIPE_AUTOMATIC_TAX`.
- `.github/workflows/infra-smoke.yml` proves the chain on demand: authenticate as the deployer and read the repository, then read the Cloudflare zone and bucket with the token.

## Neon (the data)

One database, two schemas (spec §2.5): `app` owned by Go and migrated with goose from `api/migrations`, `research` owned by the TypeScript core and migrated with Drizzle from `research/drizzle`. Provisioning of the `app` schema and its role is Lane 3's first task.

## Still on Vercel

The league platform (`commish` project on the Commish team) stays deployed until the nightly job runs on Cloud Run, because its one-minute cron drives the job system that records the 2026 season. Teardown is a cutover step (spec §10). The founder confirmed this on 2026-10-12.
