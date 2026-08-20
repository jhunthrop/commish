import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface ManifestEntry {
  readonly file: string;
  /** The `q` search text this fixture answers, exactly as sent on the wire. */
  readonly query: string;
}

interface Manifest {
  readonly provenance: "authored-from-published-response-shapes" | "recorded-from-live-api";
  readonly recordedAt: string | null;
  readonly entries: readonly ManifestEntry[];
}

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function readManifest(): Manifest {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8")) as Manifest;
}

export function readFixture(file: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8"));
}

/**
 * A `fetch` that serves the committed fixtures and NOTHING else, mirroring Tank01's
 * `createFixtureFetch` (`src/stats/tank01/fixtures.ts`): an unrecorded request throws by name so
 * a test that would otherwise reach `api.giphy.com` fails immediately instead of going to the
 * network.
 *
 * Matched on the search TEXT alone (`q`), not the full query string. `limit`, `rating` and
 * `api_key` are real request params the adapter always sends, but they don't change WHICH
 * fixture is the right answer — the committed response is "whatever Giphy returns for this
 * search text", independent of how many results were asked for.
 */
export function createFixtureFetch(): typeof globalThis.fetch {
  const manifest = readManifest();
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const query = url.searchParams.get("q") ?? "";
    const entry = manifest.entries.find((candidate) => candidate.query === query);
    if (entry === undefined) {
      throw new Error(`No Giphy fixture for the search "${query}". Add one to fixtures/manifest.json.`);
    }
    return new Response(JSON.stringify(readFixture(entry.file)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}
