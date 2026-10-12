import { NFLVERSE_CONFIG } from "./config";
import { CsvSplitter, parseCsv, type CsvRow } from "./csv";

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
  override readonly name = "NflverseError";
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
  /**
   * One release asset, streamed, handing the caller ONLY the columns it named. Returns how many
   * data rows were read.
   *
   * `getCsv` exists for the files this engine can hold in memory; play-by-play is not one of them.
   * A season is a hundred megabytes of CSV and four hundred columns, which materialises as roughly
   * twenty million strings — a gigabyte and a half of heap to answer a question that needs fifteen
   * columns. Streaming with a column projection keeps the footprint flat in the size of the file,
   * so a five-season backfill is bounded by download time rather than by memory.
   *
   * A named column the file does not carry is a SCHEMA CHANGE and throws. Handing the caller
   * `undefined` instead would put a silent zero into a rate a hundred thousand plays wide.
   */
  streamCsv(release: string, file: string, columns: readonly string[], onRow: (row: CsvRow) => void): Promise<number>;
}

function assetUrl(baseUrl: string, release: string, file: string): string {
  return new URL(`${release}/${file}`, baseUrl).toString();
}

/** Turns a non-200 into the typed failure whose KIND tells an operator what to do about it. */
function assertOk(response: Response, asset: string): void {
  // 404 is separated from every other bad status because it is the one that is routinely
  // EXPECTED: a backfill walks seasons upward and stops when the next one is not published.
  if (response.status === 404) {
    throw new NflverseError("not_found", asset, `nflverse has no release asset ${asset}.`);
  }
  if (!response.ok) {
    throw new NflverseError("upstream", asset, `nflverse returned HTTP ${response.status} for ${asset}.`);
  }
}

/**
 * The response body as text chunks, decompressed when the asset is a `.gz`.
 *
 * nflverse publishes some releases (Next Gen Stats among them) compressed and nothing else this
 * project can read. `fetch` only decompresses what the SERVER labelled with `Content-Encoding`, and
 * a `.csv.gz` release asset is served as opaque bytes, so the decompression has to be explicit.
 * Keyed off the file name rather than a flag: the name is the fact, and a caller that had to
 * remember a boolean would eventually forget it and get gzip magic bytes parsed as CSV.
 */
function textChunks(response: Response, asset: string, file: string): ReadableStream<string> {
  if (response.body === null) {
    throw new NflverseError("malformed", asset, `nflverse returned no body for ${asset}.`);
  }
  const bytes = file.endsWith(".gz") ? response.body.pipeThrough(new DecompressionStream("gzip")) : response.body;
  return bytes.pipeThrough(new TextDecoderStream());
}

export function createNflverseClient(options: NflverseClientOptions = {}): NflverseClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? NFLVERSE_CONFIG.baseUrl;

  return {
    async getCsv(release, file) {
      const asset = `${release}/${file}`;
      const response = await doFetch(assetUrl(baseUrl, release, file), { method: "GET" });
      assertOk(response, asset);

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

    async streamCsv(release, file, columns, onRow) {
      const asset = `${release}/${file}`;
      const response = await doFetch(assetUrl(baseUrl, release, file), { method: "GET" });
      assertOk(response, asset);

      const splitter = new CsvSplitter();
      let wanted: readonly (readonly [string, number])[] | null = null;
      let headerWidth = 0;
      let rows = 0;

      const take = (records: readonly (readonly string[])[]): void => {
        for (const record of records) {
          if (wanted === null) {
            headerWidth = record.length;
            wanted = columns.map((name) => {
              const index = record.indexOf(name);
              if (index < 0) {
                throw new NflverseError("malformed", asset, `nflverse asset ${asset} has no column "${name}"; the schema changed.`);
              }
              return [name, index] as const;
            });
            continue;
          }
          // Strict, exactly as `parseCsv` is strict: a ragged row means the download truncated or
          // the schema moved, and padding it puts a zero where a rushing yardage belonged.
          if (record.length !== headerWidth) {
            throw new NflverseError(
              "malformed",
              asset,
              `nflverse asset ${asset} row ${rows + 2} has ${record.length} fields; the header declares ${headerWidth}. The download is truncated or the schema changed.`,
            );
          }
          rows += 1;
          onRow(Object.fromEntries(wanted.map(([name, index]) => [name, record[index]!])));
        }
      };

      const reader = textChunks(response, asset, file).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        take(splitter.feed(value));
      }
      take(splitter.end());

      if (wanted === null) {
        throw new NflverseError("malformed", asset, `nflverse returned an empty body for ${asset}.`);
      }
      return rows;
    },
  };
}
