import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface ManifestEntry {
  /** The committed file in `fixtures/`. */
  readonly file: string;
  /** The release tag it came from. */
  readonly release: string;
  /** The upstream asset name — what a client would actually request. */
  readonly asset: string;
  /** Which rows of the upstream asset this slice keeps. */
  readonly filtered: string;
}

interface Manifest {
  readonly provenance: "recorded-from-live-release";
  readonly recordedAt: string;
  readonly note: string;
  readonly entries: readonly ManifestEntry[];
}

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function readManifest(): Manifest {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8")) as Manifest;
}

export function readFixture(file: string): string {
  return readFileSync(join(FIXTURE_DIR, file), "utf8");
}

/**
 * A `fetch` that serves the committed nflverse slices and NOTHING else.
 *
 * An unrecorded request throws by name, naming the asset it wanted, so a test that would otherwise
 * pull several megabytes off GitHub fails immediately and tells you which slice to capture. The
 * fixtures are matched on their COMMITTED filename rather than the upstream one, because the whole
 * point of the slice is that it is not the whole file — pretending otherwise would let a test
 * believe it had a full season.
 */
export function createFixtureFetch(): typeof globalThis.fetch {
  const manifest = readManifest();
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const requested = url.pathname.split("/").slice(-2).join("/");
    const entry = manifest.entries.find((candidate) => `${candidate.release}/${candidate.file}` === requested);
    if (entry === undefined) {
      // Throws rather than answering 404, so this failure can never be mistaken for the client's
      // legitimate `not_found` (a season nflverse has not published). A missing fixture is a
      // problem with the test, not with the world.
      throw new Error(
        `No nflverse fixture for ${requested}. Capture a slice into src/projections/nflverse/fixtures/ and list it in manifest.json.`,
      );
    }
    return new Response(readFixture(entry.file), { status: 200, headers: { "content-type": "text/csv" } });
  }) as typeof globalThis.fetch;
}
