import { TANK01_CONFIG } from "./config";

export type Tank01FailureKind = "unauthorized" | "forbidden" | "rate_limited" | "upstream" | "malformed";

/**
 * A typed upstream failure. Typed because the four gateway kinds mean four different operator
 * actions (fix the key, subscribe, back off, retry) and collapsing them into one `Error` makes
 * a quota problem indistinguishable from a bad key at 2am.
 *
 * The `message` here is an OPERATOR-facing string, not a user-facing one. Nothing in this
 * adapter reaches a user directly — it is consumed by the seeder today and by Plan B's
 * ingestion worker later, both of which log rather than render.
 */
export class Tank01Error extends Error {
  override readonly name = "Tank01Error";
  readonly kind: Tank01FailureKind;
  readonly path: string;
  constructor(kind: Tank01FailureKind, path: string, message: string) {
    super(message);
    this.kind = kind;
    this.path = path;
  }
}

export interface Tank01ClientOptions {
  readonly apiKey: string;
  /**
   * Injected on purpose, and injected in every test. The default is only used by the real
   * adapter at runtime and by `scripts/record-tank01-fixtures.ts`; the test suites replace
   * `globalThis.fetch` with a thrower so a code path that fell back to it fails loudly rather
   * than quietly making a paid request from a test run.
   */
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
  readonly host?: string;
}

export interface Tank01Client {
  get(path: string, query?: Readonly<Record<string, string>>): Promise<unknown>;
}

export function createTank01Client(options: Tank01ClientOptions): Tank01Client {
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? TANK01_CONFIG.baseUrl;
  const host = options.host ?? TANK01_CONFIG.host;

  return {
    async get(path, query = {}) {
      const url = new URL(path, baseUrl);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

      let response = await doFetch(url.toString(), {
        method: "GET",
        headers: { "x-rapidapi-key": options.apiKey, "x-rapidapi-host": host },
      });

      // RapidAPI enforces a per-second burst limit SEPARATELY from the monthly quota, and both
      // answer 429. A burst 429 on concurrent calls (listPlayers fires two at once) is transient;
      // one short, bounded retry absorbs it. A 429 that survives the retry is treated as the
      // real thing — quota — and classified below. Verified against a live probe on 2026-08-23:
      // the monthly ledger showed 14,998/15,000 remaining while Promise.all'd calls drew 429s.
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, TANK01_CONFIG.burstRetryDelayMs));
        response = await doFetch(url.toString(), {
          method: "GET",
          headers: { "x-rapidapi-key": options.apiKey, "x-rapidapi-host": host },
        });
      }

      // The RapidAPI gateway's own failures. These do NOT carry the `{statusCode, body}`
      // envelope — they are `{"message": "..."}` — so they are classified before parsing.
      if (response.status === 401) {
        throw new Tank01Error("unauthorized", path, `Tank01 rejected the API key. Check ${TANK01_CONFIG.envVars.apiKey}.`);
      }
      if (response.status === 403) {
        throw new Tank01Error("forbidden", path, "This RapidAPI key is not subscribed to the Tank01 NFL API.");
      }
      if (response.status === 429) {
        throw new Tank01Error("rate_limited", path, "Tank01 request quota exhausted. Back off and retry later.");
      }
      if (!response.ok) {
        throw new Tank01Error("upstream", path, `Tank01 returned HTTP ${response.status} for ${path}.`);
      }

      const parsed: unknown = await response.json().catch(() => undefined);
      if (typeof parsed !== "object" || parsed === null) {
        throw new Tank01Error("malformed", path, `Tank01 returned a non-JSON body for ${path}.`);
      }
      const envelope = parsed as Record<string, unknown>;

      // The trap: an application-level error arrives as HTTP 200 with an `error` key and an
      // EMPTY body. Trusting the status code alone would map that to zero players and zero stat
      // lines, which looks like a quiet week rather than a failure.
      if (typeof envelope.error === "string" && envelope.error !== "") {
        throw new Tank01Error("upstream", path, `Tank01 refused ${path}: ${envelope.error}`);
      }
      if (!("body" in envelope)) {
        throw new Tank01Error("malformed", path, `Tank01 returned no body for ${path}.`);
      }
      return envelope.body;
    },
  };
}
