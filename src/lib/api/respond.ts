import { NextResponse } from "next/server";
import type { ZodType } from "zod";

/**
 * Every route behind this envelope answers with data scoped to the signed-in caller — a league
 * they are in, a lineup they own, a draft they are drafting in. Next.js already sends
 * `private, no-cache, no-store` for a `dynamic = "force-dynamic"` route, which every API route
 * here declares, but that makes the protection a framework default rather than a property of the
 * code: a route that ever stops declaring it, or a proxy that reads the header rather than the
 * framework's intent, would start caching one manager's data for the next. Stating it here costs
 * one header and makes it true by construction.
 *
 * SET, not defaulted: a caller-supplied `Cache-Control` is overwritten rather than respected. That
 * is the right way round for an envelope whose whole payload is one signed-in caller's own data —
 * a route that wanted a shared cache would be a route that should not be using this envelope — and
 * no caller in `src/` passes one today. If one ever needs to, it should say so here.
 */
const NO_STORE = "no-store";

function withNoStore(init?: ResponseInit): ResponseInit {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", NO_STORE);
  return { ...init, headers };
}

/**
 * Consistent JSON envelope for every API response (per the project's API-response rule):
 * { ok: true, data } on success, { ok: false, error } on failure.
 */
export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, withNoStore(init));
}

export function fail(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, withNoStore({ status }));
}

/** The shape a browser parses back out of `ok()` / `fail()`. One envelope, both directions. */
export type ApiEnvelope<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly response: NextResponse };

/** Parses and validates a JSON request body at the boundary; a bad body is a 400 with the first issue's message. */
export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: fail("Request body must be valid JSON.", 400) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".");
    const message = first?.message ?? "Invalid request.";
    return { ok: false, response: fail(path ? `${path}: ${message}` : message, 400) };
  }
  return { ok: true, value: result.data };
}
