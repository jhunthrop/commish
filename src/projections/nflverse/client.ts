import { NFLVERSE_CONFIG } from "./config";
import { parseCsv, type CsvRow } from "./csv";

/**
 * The nflverse release fetcher, built on the shape `src/stats/tank01/client.ts` established:
 * `fetch` is injected, the failure taxonomy is typed, and no test ever touches the network.
 *
 * The kinds are typed for the same reason Tank01's are — they mean different operator actions.
 * `not_found` is the ordinary case of asking for a season nflverse has not published yet and is
 * NOT an alarm; `upstream` is GitHub or the release being down and wants a retry; `malformed` is
 * the schema changing under us, which wants a human. Collapsing them into one `Error` makes
 * "2027 does not exist yet" indistinguishable from "the columns moved".
 */
export type NflverseFailureKind = "not_found" | "upstream" | "malformed";

export class NflverseError extends Error {
  readonly name = "NflverseError";
  readonly kind: NflverseFailureKind;
  /** `<release>/<file>` — the asset an operator would go and look at. */
  readonly asset: string;
  constructor(kind: NflverseFailureKind, asset: string, message: string) {
    super(message);
    this.kind = kind;
    this.asset = asset;
  }
}

export interface NflverseClientOptions {
  /**
   * Injected on purpose, and injected in every test. The default is only used by the real
   * ingestion script; the suites stub `globalThis.fetch` with a thrower so a path that fell back
   * to it fails loudly rather than quietly pulling several megabytes off GitHub per test run.
   */
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
}

export interface NflverseClient {
  /** One release asset, parsed. `release` is the tag (`snap_counts`), `file` the asset name. */
  getCsv(release: string, file: string): Promise<readonly CsvRow[]>;
}

export function createNflverseClient(options: NflverseClientOptions = {}): NflverseClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? NFLVERSE_CONFIG.baseUrl;

  return {
    async getCsv(release, file) {
      const asset = `${release}/${file}`;
      const response = await doFetch(new URL(asset, baseUrl).toString(), { method: "GET" });

      // 404 is separated from every other bad status because it is the one that is routinely
      // EXPECTED: a backfill walks seasons upward and stops when the next one is not published.
      if (response.status === 404) {
        throw new NflverseError("not_found", asset, `nflverse has no release asset ${asset}.`);
      }
      if (!response.ok) {
        throw new NflverseError("upstream", asset, `nflverse returned HTTP ${response.status} for ${asset}.`);
      }

      const body = await response.text();
      // A zero-byte body is a failed build on the nflverse side, and it would otherwise parse into
      // "no rows" — which reads as a quiet week rather than as a failure, the exact trap
      // `src/stats/tank01/client.ts` documents for a 200-with-empty-body.
      if (body.trim() === "") {
        throw new NflverseError("malformed", asset, `nflverse returned an empty body for ${asset}.`);
      }
      try {
        return parseCsv(body);
      } catch (error: unknown) {
        throw new NflverseError(
          "malformed",
          asset,
          `nflverse asset ${asset} did not parse: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
