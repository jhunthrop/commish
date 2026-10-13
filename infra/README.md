# Infrastructure

The prep site runs on three providers, provisioned on 2026-10-12 (spec §2, `docs/superpowers/specs/2026-10-12-prep-site-architecture-design.md`). Nothing here holds a secret. Secrets live in GitHub Actions secrets, GCP Secret Manager and each developer's git-ignored `.env.local`.

## Cloudflare (the edge)

- Account `1f1504a52d74d323c0a5648a766e0871`, zone `trycommish.app` (`704792f55d2ebfc79e24c618bbfd0c9b`), nameservers `coby.ns.cloudflare.com` and `lady.ns.cloudflare.com`, set at the registrar (Namecheap) on 2026-10-12.
- DNS today: one DNS-only A record for the apex pointing at the Vercel deployment that still serves the league platform. It changes at cutover (spec §10).
- R2 bucket `commish-runs` for the nightly runs (spec §2.1), location hint `enam`.
- The web app deploys with wrangler as Workers static assets (`web/wrangler.jsonc`, Lane 0 and Lane 5). GitHub Actions uses the secret `CLOUDFLARE_API_TOKEN` (account token: Workers Scripts Edit, Zone DNS Edit, R2 Edit) and the variable `CLOUDFLARE_ACCOUNT_ID`.

## Google Cloud (the services)

- Project `trycommish` (number `467414876046`) in the `derbee.ai` organization, billing account shared with foreversixty, region `us-east1`.
- APIs: Cloud Run, Artifact Registry, IAM, IAM Credentials, STS, Secret Manager, Cloud Scheduler, Resource Manager, Logging, Monitoring.
- Artifact Registry: `us-east1-docker.pkg.dev/trycommish/commish` (Docker). Images: `api` (one image, two Cloud Run services `api` and `room`), `research` (the Cloud Run Job `nightly` and the service `advisor`).
- Service accounts:
  - `deployer@trycommish.iam.gserviceaccount.com`: GitHub Actions. Roles `run.admin`, `artifactregistry.writer`, `run.jobsExecutorWithOverrides`, and `iam.serviceAccountUser` on the two runtime accounts.
  - `api-runtime@trycommish.iam.gserviceaccount.com`: the `api` and `room` services.
  - `research-runtime@trycommish.iam.gserviceaccount.com`: the `nightly` and in-season jobs.
  - `advisor-runtime@trycommish.iam.gserviceaccount.com`: the `advisor` service, no roles; `deployer` has `iam.serviceAccountUser` on it. The service runs with ingress all behind IAM; `api-runtime` holds `run.invoker` on it and the Go rooms call it with a Google identity token (`ADVISOR_URL` repository variable; unset means the engine's own odds).
  - Both runtime accounts: `secretmanager.secretAccessor`, `logging.logWriter`, `monitoring.metricWriter`.
- Cloud Run services as deployed by `api.yml`: `api` at https://api-mgq3rq4xbq-ue.a.run.app and `room` at https://room-mgq3rq4xbq-ue.a.run.app (us-east1, runtime `api-runtime`, scale to zero), the migrate job `api-migrate` run from the workflow when `APP_SCHEMA_READY` is true. The organization policy `iam.allowedPolicyMemberDomains` restricts IAM members to the derbee.ai customer, so `allUsers` cannot be granted `run.invoker`; public access comes from the invoker IAM check being disabled on the service, the same way foreversixty's API is public.
- Custom hostnames: `api.trycommish.app` and `room.trycommish.app` map to the services with `gcloud beta run domain-mappings create` once the domain is verified for the GCP account (`gcloud domains verify trycommish.app`, a Search Console step the founder does once), then DNS-only CNAME records in Cloudflare as the mapping prints them. Until then the run.app URLs serve.
- Workload identity federation, no stored keys: pool `github`, provider `github` (OIDC from `token.actions.githubusercontent.com`, condition `assertion.repository == 'jhunthrop/commish'`), bound to the deployer for that repository's runs.
- GitHub Actions variables: `GCP_PROJECT`, `GCP_PROJECT_NUMBER`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`, `GCP_ARTIFACT_REPO`.
- `.github/workflows/infra-smoke.yml` proves the chain on demand: authenticate as the deployer and read the repository, then read the Cloudflare zone and bucket with the token.

### Connected host accounts (FFPC, Lane 14)

- `HOST_FFPC_ENABLED` (repository variable, default `true` in `api.yml`) is the one switch for FFPC: off, the connect routes answer 503, the league poller and the companion have no FFPC host, the refresh job reads nothing and the web hides the FFPC choice. The founder accepted FFPC's terms risk in writing on 2026-10-13.
- Secret Manager `HOST_CREDENTIALS_KEY`: base64 of 32 random bytes (`openssl rand -base64 32 | gcloud secrets create HOST_CREDENTIALS_KEY --data-file=-`). It wraps each member's own data key; the api refuses to start in production without it while FFPC is on. `api.yml` pins it to a numbered version (`HOST_CREDENTIALS_KEY:1`, `HOST_CREDENTIALS_KEY_VERSION=1`), never `latest`, so adding a version never rotates it by accident.
- Rotating it, in one sitting:
  1. Add the new secret version.
  2. Deploy with `HOST_CREDENTIALS_KEY` at the new version and `HOST_CREDENTIALS_KEY_VERSION` one higher. Set `HOST_CREDENTIALS_KEY_PREVIOUS` to the old version, added to `API_SECRETS`.
  3. Run the `api-re-encrypt-host-connections` job once: it re-wraps every row's data key under the new key and opens no secret.
  4. Deploy without the previous key. Only then disable the old version.
  A row that no longer opens marks its connection signed out, and the member signs in again.
- Rotating `WORKOS_COOKIE_PASSWORD` also unpairs every paired device: the device token key and the pairing code key derive from it. Tell members to pair again.
- Cloud Scheduler runs the `api-ffpc-refresh` job (one read of every attached FFPC league with a connected member, at one FFPC request a second) on these schedules, all `America/New_York`:
  - hourly: `0 * * * *`
  - after Wednesday's waiver run: `0 6 * * 3`
  - after Tuesday's waiver run: `0 6 * * 2`
  - at Sunday's first kickoffs: `0 13 * * 0`, `15 13 * * 0`, `30 13 * * 0`
  Each is `gcloud scheduler jobs create http ffpc-refresh-<name> --schedule "<cron>" --time-zone America/New_York --uri https://us-east1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/trycommish/jobs/api-ffpc-refresh:run --http-method POST --oauth-service-account-email deployer@trycommish.iam.gserviceaccount.com`, the same way the other api jobs are scheduled.

## Neon (the data)

One database, two schemas (spec §2.5): `app` owned by Go and migrated with goose from `api/migrations`, `research` owned by the TypeScript core and migrated with Drizzle from `research/drizzle`. The `app` schema is owned by the login role `commish_app`, which also holds `create` on the database (goose's `create schema if not exists` needs it); its pooled URL is Secret Manager `DATABASE_URL`. Twenty tables as of migration 6.

## Still on Vercel

The league platform (`commish` project on the Commish team) stays deployed until the nightly job runs on Cloud Run, because its one-minute cron drives the job system that records the 2026 season. Teardown is a cutover step (spec §10). The founder confirmed this on 2026-10-12.
