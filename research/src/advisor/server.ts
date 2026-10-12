// THE ADVISOR SERVICE: a small HTTP server on Node's own `http`, called only by the API and the
// room service (spec §2.3), never by a browser. `POST /advise` takes a room state and returns the
// closed-form advice (`advise.ts`); `GET /healthz` answers for the platform's probe. Every response
// is the product's envelope: `{ ok, data, error }`. The request and response shapes are documented
// in research/README.md.
//
//   npm run advisor -w @commish/research          PORT defaults to 8080
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { envOr, parsePositiveInteger } from "@research/lib/env";
import { advise, RoomStateError } from "./advise";
import { adviseRequestSchema } from "./request";

export const ADVISOR_SERVER_CONFIG = {
  defaultPort: 8080,
  /** A full 16-team pool with every pick is well under this; anything larger is not a room. */
  maxBodyBytes: 1_000_000,
} as const;

interface Envelope {
  readonly ok: boolean;
  readonly data: unknown;
  readonly error: string | null;
}

class BodyTooLargeError extends Error {
  override readonly name = "BodyTooLargeError";
}

function send(response: ServerResponse, status: number, envelope: Envelope, extraHeaders: Readonly<Record<string, string>> = {}): void {
  const body = JSON.stringify(envelope);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), ...extraHeaders });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > ADVISOR_SERVER_CONFIG.maxBodyBytes) throw new BodyTooLargeError(`request body is over ${ADVISOR_SERVER_CONFIG.maxBodyBytes} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

async function handleAdvise(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const started = performance.now();
  const parsed = parseJson(await readBody(request));
  if (!parsed.ok) return send(response, 400, { ok: false, data: null, error: "the body is not JSON" });
  const validated = adviseRequestSchema.safeParse(parsed.value);
  if (!validated.success) {
    const issues = validated.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
    return send(response, 400, { ok: false, data: null, error: issues.join("; ") });
  }
  try {
    const data = advise(validated.data);
    const elapsed = performance.now() - started;
    return send(response, 200, { ok: true, data, error: null }, { "server-timing": `advise;dur=${elapsed.toFixed(2)}` });
  } catch (error) {
    if (error instanceof RoomStateError) return send(response, 422, { ok: false, data: null, error: error.message });
    throw error;
  }
}

/** The request handler, exported so a caller can mount it on a server it owns. */
export async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = (request.url ?? "/").split("?")[0];
  try {
    if (request.method === "GET" && path === "/healthz") return send(response, 200, { ok: true, data: { status: "ok" }, error: null });
    if (path === "/advise") {
      if (request.method !== "POST") return send(response, 405, { ok: false, data: null, error: "use POST" }, { allow: "POST" });
      return await handleAdvise(request, response);
    }
    return send(response, 404, { ok: false, data: null, error: `no route ${request.method} ${path}` });
  } catch (error) {
    if (error instanceof BodyTooLargeError) return send(response, 413, { ok: false, data: null, error: error.message });
    // The detail goes to the log, never to the caller.
    process.stderr.write(`advisor: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    return send(response, 500, { ok: false, data: null, error: "internal error" });
  }
}

function main(): void {
  const port = parsePositiveInteger("PORT", envOr("PORT", String(ADVISOR_SERVER_CONFIG.defaultPort)));
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.listen(port, () => process.stdout.write(`advisor: listening on :${port}\n`));
  const stop = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
