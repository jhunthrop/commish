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
  - `research-runtime@trycommish.iam.gserviceaccount.com`: the `nightly`, `nightly-publish`, `inseason` and `inseason-capture` jobs, and the caller of the research schedule.
  - `advisor-runtime@trycommish.iam.gserviceaccount.com`: the `advisor` service, no roles; `deployer` has `iam.serviceAccountUser` on it. The service runs with ingress all behind IAM; `api-runtime` holds `run.invoker` on it and the Go rooms call it with a Google identity token (`ADVISOR_URL` repository variable; unset means the engine's own odds).
  - Both runtime accounts: `logging.logWriter`, `monitoring.metricWriter`. `api-runtime` holds `secretmanager.secretAccessor` on the project. `research-runtime` holds it on exactly its six secrets (`RESEARCH_DATABASE_URL`, `AI_GATEWAY_API_KEY`, `CLOUDFLARE_API_TOKEN`, `TANK01_API_KEY`, `ODDS_API_KEY`, `WEB_DISPATCH_TOKEN`) and nothing project-wide, set and checked by `infra/research-secrets.sh` (2026-10-13).
- Cloud Run services as deployed by `api.yml`: `api` at https://api-mgq3rq4xbq-ue.a.run.app and `room` at https://room-mgq3rq4xbq-ue.a.run.app (us-east1, runtime `api-runtime`, scale to zero), the migrate job `api-migrate` run from the workflow when `APP_SCHEMA_READY` is true. The organization policy `iam.allowedPolicyMemberDomains` restricts IAM members to the derbee.ai customer, so `allUsers` cannot be granted `run.invoker`; public access comes from the invoker IAM check being disabled on the service, the same way foreversixty's API is public.
- Custom hostnames: `api.trycommish.app` and `room.trycommish.app` map to the services with `gcloud beta run domain-mappings create` once the domain is verified for the GCP account (`gcloud domains verify trycommish.app`, a Search Console step the founder does once), then DNS-only CNAME records in Cloudflare as the mapping prints them. Until then the run.app URLs serve.
- Cloud Run Jobs from the `research` image, deployed by `research.yml` as `research-runtime`, each holding only the secrets its command reads (Lane 2P phase D):
  - `nightly` (`research.nightly run`): RESEARCH_DATABASE_URL, AI_GATEWAY_API_KEY, CLOUDFLARE_API_TOKEN, TANK01_API_KEY, ODDS_API_KEY; env CLOUDFLARE_ACCOUNT_ID. Writes the run to R2 `commish-runs` and, when every gate passed, moves `runs/early.json`. The task timeout is 8 h; `nightly-publish` runs 06:00-12:00 UTC, so a run that passes after 11:00 UTC goes public the next morning, replaced by that night's run if it passes (a normal night ends before 06:00, a full regeneration around 08:30).
  - `nightly-publish` (`research.nightly publish`): CLOUDFLARE_API_TOKEN, WEB_DISPATCH_TOKEN. Moves `runs/latest.json` to the early run an hour after it passed and dispatches `web.yml` (`workflow_dispatch` on main with the input `runId`).
  - `inseason` (`research.inseason --task season-week`): RESEARCH_DATABASE_URL, ODDS_API_KEY. The register's freeze and grade; a missed freeze or an overdue grade fails the execution.
  - `inseason-capture` (`research.inseason --task capture-harvest`): RESEARCH_DATABASE_URL, TANK01_API_KEY.
  - `research-runtime` holds `run.invoker` on each job (granted by the workflow), which is what the scheduler calls with.
- Secret Manager placeholders created 2026-10-13 with the value `placeholder`, to be set before the jobs are resumed: `CLOUDFLARE_API_TOKEN` (an R2-only token: Workers R2 Storage, Object Read and Write on `commish-runs`, never the account token, which can redeploy the site and change DNS; `nightly/r2.py` derives its S3 credentials from whichever token it is given), `TANK01_API_KEY` (the stats provider), `ODDS_API_KEY` (the odds provider), `WEB_DISPATCH_TOKEN` (a fine-grained GitHub token on `jhunthrop/commish` with Actions read and write only, enough to dispatch `web.yml` and not to push code). `AI_GATEWAY_API_KEY` was created by phase C, `RESEARCH_DATABASE_URL` by Lane 1.
- The research schedule, Cloud Scheduler in us-east1, created by hand 2026-10-13 (the deployer lacks the scheduler role) and PAUSED until cutover, because until then the Vercel cron writes the legacy register and the Neon research schema is a loaded copy: each is an HTTP POST to `https://run.googleapis.com/v2/projects/trycommish/locations/us-east1/jobs/<job>:run` with an OAuth token for `research-runtime` (the Run Admin API takes OAuth, not an OIDC identity token), no retries. The jobs are defined in `infra/research-schedule.sh` (bash): `apply` creates or updates each one and then verifies it, `verify` describes all six and fails unless each targets `<job>:run`. The first hand-made jobs targeted `jobs/nightlyun` (zsh read `$job:run` as `$job` with its `:r` modifier); corrected and verified 2026-10-13.

  | Scheduler job | Schedule | Time zone | Runs |
  |---|---|---|---|
  | `research-nightly` | `0 5 * * *` | UTC | `nightly` |
  | `research-nightly-publish` | `0 6-12 * * *` | UTC | `nightly-publish` |
  | `research-season-week-tue` | `0 8 * 1,2,9-12 2` | America/New_York | `inseason` |
  | `research-season-week-wed` | `0 18 * 1,2,9-12 3` | America/New_York | `inseason` |
  | `research-season-week-thu` | `0 14 * 1,2,9-12 4` | America/New_York | `inseason` |
  | `research-capture-harvest` | `0 2,7-23 * * *` | America/New_York | `inseason-capture` |

  At cutover, after the legacy writers stop and the loader has run: set the four placeholders, run `infra/research-schedule.sh verify`, prove one target with `gcloud scheduler jobs run research-nightly-publish --location us-east1` (publish with no early run is a no-op), then `gcloud scheduler jobs resume <job> --location us-east1` for each, and last `infra/research-alerts.sh enable-absence`, so a job that never fires from then on emails.
- The research alerts, Cloud Monitoring, created 2026-10-13 by `infra/research-alerts.sh apply` (`verify` checks them, and `apply` brings each live policy to the script's body): the email channel `projects/trycommish/notificationChannels/10940858382424670211` to the founder (jhunthrop@yahoo.com), and five policies on it.
  - `alertPolicies/13319673890577043262` "Research job execution failed": `run.googleapis.com/job/completed_execution_count` with `result = failed` on `nightly`, `nightly-publish`, `inseason` or `inseason-capture`, over 0 in any five minutes. Auto-close 30 minutes (fix round 2), so a second failure of the same job opens a new incident and emails: the count is sparse, and without auto-close the first incident stayed open seven days.
  - `alertPolicies/2001267459917455985` "Research schedule firing failed": an error log from a `research-` scheduler job, the case where no execution starts at all (a wrong target, a refused token), at most one email an hour.
  - The absence policies, PromQL `absent_over_time` on succeeded executions, one condition each, created DISABLED (the schedule is paused, so they would fire at once) and turned on by the cutover's last step: `alertPolicies/3840164249901912409` "Research nightly absent" (no successful `nightly` in 36 hours); `alertPolicies/7832695669032319713` "Research in-season absent" (no successful `inseason` or `inseason-capture` in 72 hours, September through February); `alertPolicies/1355441892108108975` "Research weekly pass absent" (no successful `inseason` in 120 hours, September through February: the pass's longest gap, Thursday 14:00 to Tuesday 08:00, is 114 hours, so a 72-hour window on the pass alone would fire every weekend). These are what catch a paused or deleted scheduler job, which starts nothing and logs nothing.
  - A missed freeze, an overdue grade, an unplaced season or an unwritten trail fails the `inseason` execution (`research.inseason`), so it emails; the pass's lines are also in `register/last-pass.json` and the next nightly manifest's `register`.
- Workload identity federation, no stored keys: pool `github`, provider `github` (OIDC from `token.actions.githubusercontent.com`, condition `assertion.repository == 'jhunthrop/commish'`), bound to the deployer for that repository's runs.
- GitHub Actions variables: `GCP_PROJECT`, `GCP_PROJECT_NUMBER`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`, `GCP_ARTIFACT_REPO`.
- `.github/workflows/infra-smoke.yml` proves the chain on demand: authenticate as the deployer and read the repository, then read the Cloudflare zone and bucket with the token.

## Neon (the data)

One database, two schemas (spec §2.5): `app` owned by Go and migrated with goose from `api/migrations`, `research` owned by the TypeScript core and migrated with Drizzle from `research/drizzle`. The `app` schema is owned by the login role `commish_app`, which also holds `create` on the database (goose's `create schema if not exists` needs it); its pooled URL is Secret Manager `DATABASE_URL`. Twenty tables as of migration 6.

## Still on Vercel

The league platform (`commish` project on the Commish team) stays deployed until the nightly job runs on Cloud Run, because its one-minute cron drives the job system that records the 2026 season. Teardown is a cutover step (spec §10). The founder confirmed this on 2026-10-12.
