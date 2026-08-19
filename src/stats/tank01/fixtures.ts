import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface ManifestEntry {
  readonly file: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
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
 * A `fetch` that serves the committed fixtures and NOTHING else.
 *
 * An unrecorded request throws by name, naming the path and query it wanted, so a test that
 * would otherwise have made a real paid request fails immediately and tells you which fixture to
 * record instead of silently going to the network.
 */
export function createFixtureFetch(): typeof globalThis.fetch {
  const manifest = readManifest();
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const entry = manifest.entries.find(
      (candidate) =>
        candidate.path === url.pathname &&
        Object.entries(candidate.query).every(([key, value]) => query[key] === value) &&
        Object.keys(query).length === Object.keys(candidate.query).length,
    );
    if (entry === undefined) {
      throw new Error(
        `No Tank01 fixture for ${url.pathname}?${url.searchParams.toString()}. Record it with \`npm run stats:tank01:record\` or add it to fixtures/manifest.json.`,
      );
    }
    return new Response(JSON.stringify({ statusCode: 200, body: readFixture(entry.file) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}
