/** Explicit opt-in. Absent (or anything but `1`) means refuse — the guard fails closed. */
export const SEED_OPT_IN_ENV_VAR = "ALLOW_DESTRUCTIVE_SEED";

const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * A bare env bag rather than `NodeJS.ProcessEnv`: Next augments that type with a REQUIRED
 * `NODE_ENV`, which would force every caller (and every test) to supply the one variable this
 * guard deliberately does not trust.
 */
export type SeedEnv = Readonly<Record<string, string | undefined>>;

/**
 * The one thing standing between a dev seeder and somebody's real database.
 *
 * Keyed on the TARGET, not on `NODE_ENV`. Every seeder here runs under
 * `dotenv -e .env.local -- tsx …`, where `NODE_ENV` is `undefined` — so a `NODE_ENV === "production"`
 * check passes exactly when the realistic accident happens (a `.env.local` whose `DATABASE_URL`
 * points somewhere real) and guards against a scenario that cannot occur. This asserts two
 * things instead, and throws on anything it cannot prove:
 *
 * 1. `ALLOW_DESTRUCTIVE_SEED=1` is set — the operator said, out loud, that mass upserts and
 *    placeholder users are wanted here.
 * 2. `DATABASE_URL` names a loopback host. Missing, unparseable, or remote all throw.
 *
 * Deliberately no override for (2): a seeder that mints `dev_user_*` rows has no business
 * running anywhere but a local database, and an escape hatch would just become the default.
 */
export function assertLocalSeedTarget(env: SeedEnv = process.env): void {
  if (env[SEED_OPT_IN_ENV_VAR] !== "1") {
    throw new Error(
      `Refusing to seed: set ${SEED_OPT_IN_ENV_VAR}=1 (in .env.local, or on the command line) to confirm this database is disposable.`,
    );
  }

  const url = env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("Refusing to seed: DATABASE_URL is not set, so the target cannot be verified as local.");
  }

  const host = hostnameOf(url);
  if (host === null) {
    throw new Error("Refusing to seed: DATABASE_URL could not be parsed, so the target cannot be verified as local.");
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to seed: DATABASE_URL points at "${host}", not a local database. The seeders create placeholder users and mass-upsert players.`);
  }
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
