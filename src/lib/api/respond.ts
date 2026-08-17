import { NextResponse } from "next/server";
import type { ZodType } from "zod";

/**
 * Consistent JSON envelope for every API response (per the project's API-response rule):
 * { ok: true, data } on success, { ok: false, error } on failure.
 */
export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

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
