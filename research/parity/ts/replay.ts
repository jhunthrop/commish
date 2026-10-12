// THE TYPESCRIPT HALF OF THE REPLAY — `globalThis.fetch` answered from the same recordings the
// Python `ReplayFetcher` reads (`research/parity/replay.py`), so both implementations are fed
// byte-identical input. An unrecorded request throws by name; nothing reaches the network.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";

const SECRET_PARAMS = new Set(["apiKey", "api_key", "apikey"]);

interface Recording {
  readonly url: string;
  readonly status: number;
  readonly file: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Secret parameters removed, the query sorted: the key both the manifest and a request are filed under. */
export function normalizedUrl(raw: string): string {
  const url = new URL(raw);
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !SECRET_PARAMS.has(key))
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const query = new URLSearchParams(params).toString();
  return `${url.protocol}//${url.host}${url.pathname}${query === "" ? "" : `?${query}`}`;
}

export function installReplay(caseDirs: readonly string[]): string[] {
  const recordings = new Map<string, { dir: string; recording: Recording }>();
  for (const dir of caseDirs) {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { responses: Recording[] };
    for (const recording of manifest.responses) recordings.set(normalizedUrl(recording.url), { dir, recording });
  }
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const key = normalizedUrl(raw);
    const found = recordings.get(key);
    if (found === undefined) throw new Error(`no recording for ${key}; record it first.`);
    requested.push(`${basename(found.dir)}/${found.recording.file}`);
    const body = gunzipSync(readFileSync(join(found.dir, found.recording.file)));
    return new Response(body, { status: found.recording.status, headers: found.recording.headers ?? {} });
  }) as typeof globalThis.fetch;
  return requested;
}
