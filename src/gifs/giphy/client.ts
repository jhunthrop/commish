import { GIPHY_CONFIG } from "./config";

export type GiphyFailureKind = "unauthorized" | "rate_limited" | "upstream" | "malformed";

/**
 * A typed upstream failure, mirroring `Tank01Error` (`src/stats/tank01/client.ts`) and for the
 * same reason: the three gateway kinds mean three different operator actions (fix the key, back
 * off, retry) and collapsing them into one `Error` makes a quota problem indistinguishable from a
 * bad key. `message` is operator-facing — this adapter is consumed by `GET /api/gifs/search`,
 * which turns any thrown error into a generic user-facing 500 rather than relaying it.
 */
export class GiphyError extends Error {
  readonly name = "GiphyError";
  readonly kind: GiphyFailureKind;
  constructor(kind: GiphyFailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface GiphyClientOptions {
  readonly apiKey: string;
  /**
   * Injected on purpose, and injected in every test. The default is only used by the real
   * adapter at runtime; every test suite replaces it with `createFixtureFetch()` or a thrower so
   * a code path that fell back to it fails loudly rather than quietly making a real request.
   */
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
}

export interface GiphyClient {
  search(query: string, limit: number): Promise<unknown>;
}

export function createGiphyClient(options: GiphyClientOptions): GiphyClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? GIPHY_CONFIG.baseUrl;

  return {
    async search(query, limit) {
      const url = new URL(baseUrl);
      url.searchParams.set("api_key", options.apiKey);
      url.searchParams.set("q", query);
      url.searchParams.set("limit", String(limit));
      // Sent on every request — see GIPHY_CONFIG.rating's docblock.
      url.searchParams.set("rating", GIPHY_CONFIG.rating);

      const response = await doFetch(url.toString());

      if (response.status === 401 || response.status === 403) {
        throw new GiphyError("unauthorized", `Giphy rejected the API key. Check ${GIPHY_CONFIG.envVars.apiKey}.`);
      }
      if (response.status === 429) {
        throw new GiphyError("rate_limited", "Giphy request quota exhausted. Back off and retry later.");
      }
      if (!response.ok) {
        throw new GiphyError("upstream", `Giphy returned HTTP ${response.status} for a GIF search.`);
      }

      const parsed: unknown = await response.json().catch(() => undefined);
      if (typeof parsed !== "object" || parsed === null) {
        throw new GiphyError("malformed", "Giphy returned a non-JSON body for a GIF search.");
      }
      const envelope = parsed as Record<string, unknown>;

      // The trap: an application-level refusal can arrive as HTTP 200 with meta.status carrying
      // the real failure code and an empty data array. Trusting the HTTP status alone would map
      // that to zero results, which looks like a quiet search rather than a failure — the exact
      // shape of the gotcha Tank01's client guards against for its own {statusCode, body, error}
      // envelope.
      const meta = typeof envelope.meta === "object" && envelope.meta !== null ? (envelope.meta as Record<string, unknown>) : undefined;
      const status = typeof meta?.status === "number" ? meta.status : undefined;
      if (status !== undefined && status !== 200) {
        const msg = typeof meta?.msg === "string" && meta.msg !== "" ? meta.msg : "unknown error";
        if (status === 401 || status === 403) throw new GiphyError("unauthorized", `Giphy refused the search: ${msg}`);
        if (status === 429) throw new GiphyError("rate_limited", `Giphy refused the search: ${msg}`);
        throw new GiphyError("upstream", `Giphy refused the search: ${msg}`);
      }
      if (!("data" in envelope)) {
        throw new GiphyError("malformed", "Giphy returned no data for a GIF search.");
      }
      return envelope.data;
    },
  };
}
