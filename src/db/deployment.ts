/**
 * THE DEPLOYMENT-SHAPE GUARDS (Neon cost audit 2026-09-07, finding 5). `DATABASE_URL` and
 * `DATABASE_URL_UNPOOLED` were scoped to Production AND Preview, so a preview build migrated
 * the production database and preview functions read and wrote production rows. Two rules,
 * both pure over a plain env record (the `migration-url.ts` idiom) so they are testable without
 * touching `process.env`:
 *
 *   1. The build migrates only on a Production deployment (`shouldMigrateOnBuild`). Locally
 *      `VERCEL_ENV` is unset and `npm run db:migrate` is the explicit path, so the build never
 *      migrates there either.
 *   2. A Preview deployment refuses to boot against the production database
 *      (`assertDeploymentDatabase`): when `PRODUCTION_DATABASE_ENDPOINT` names the production
 *      Neon endpoint and the preview's `DATABASE_URL` points at it, the process throws at the
 *      first database connection unless `ALLOW_PRODUCTION_DATABASE_ON_PREVIEW=1` says so on
 *      purpose. The ENDPOINT ID is compared — the `ep-...` segment before the host's first dot,
 *      with Neon's `-pooler` suffix stripped — so the guard holds whether the URL names the direct
 *      host or the pooler, and never the secret. An unset `PRODUCTION_DATABASE_ENDPOINT` disables
 *      the check (the founder's env-scope change is what makes it bite — see the audit's finding 5).
 */
export type DeploymentEnv = Readonly<Record<string, string | undefined>>;

const PRODUCTION = "production";
const PREVIEW = "preview";
const OVERRIDE_ON = "1";
/** Neon's pooled host is the direct host's endpoint id plus this suffix. */
const POOLER_SUFFIX = "-pooler";

function present(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/** `drizzle-kit migrate` runs in the build only for a Production deployment. */
export function shouldMigrateOnBuild(env: DeploymentEnv): boolean {
  return env.VERCEL_ENV === PRODUCTION;
}

/** A Neon endpoint id from either host shape (`ep-x-123.region.aws.neon.tech` or
 *  `ep-x-123-pooler.region.aws.neon.tech`), or from a bare id, lower-cased. */
export function databaseEndpoint(hostOrEndpoint: string): string {
  const first = hostOrEndpoint.toLowerCase().split(".")[0] ?? "";
  return first.endsWith(POOLER_SUFFIX) ? first.slice(0, -POOLER_SUFFIX.length) : first;
}

/** The endpoint id of a connection string's host, or null when it is not a parseable URL. */
export function connectionEndpoint(connectionString: string): string | null {
  try {
    return databaseEndpoint(new URL(connectionString).hostname);
  } catch {
    return null;
  }
}

/**
 * Throws when a Preview deployment would use the production database. Silent everywhere else:
 * Production, local, a preview with its own branch endpoint, or a preview with the override set.
 */
export function assertDeploymentDatabase(env: DeploymentEnv): void {
  if (env.VERCEL_ENV !== PREVIEW) return;
  if (!present(env.PRODUCTION_DATABASE_ENDPOINT) || !present(env.DATABASE_URL)) return;
  if (env.ALLOW_PRODUCTION_DATABASE_ON_PREVIEW === OVERRIDE_ON) return;
  const endpoint = connectionEndpoint(env.DATABASE_URL);
  if (endpoint === null || endpoint !== databaseEndpoint(env.PRODUCTION_DATABASE_ENDPOINT)) return;
  throw new Error(
    "This Preview deployment's DATABASE_URL points at the production database endpoint. Scope DATABASE_URL and " +
      "DATABASE_URL_UNPOOLED to Production only (or enable Neon preview branches); set " +
      "ALLOW_PRODUCTION_DATABASE_ON_PREVIEW=1 only to override on purpose.",
  );
}
