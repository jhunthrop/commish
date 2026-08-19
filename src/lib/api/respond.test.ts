import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fail, ok, parseJson } from "./respond";

describe("the API envelope", () => {
  it("wraps data in { ok: true, data } and refuses to be stored", async () => {
    const response = ok({ leagueId: "lg_1" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: { leagueId: "lg_1" } });
    // Every route behind this envelope answers with one signed-in caller's own data. Next.js
    // already sends no-store for a force-dynamic route, but that makes the protection a framework
    // default rather than a property of the code.
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("wraps an error in { ok: false, error } at the given status, and refuses to be stored", async () => {
    const response = fail("That league doesn't exist.", 404);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "That league doesn't exist." });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps a caller's own init — status and headers — while still pinning cache-control", () => {
    const response = ok({ ok: true }, { status: 201, headers: { "x-request-id": "abc" } });
    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBe("abc");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("parses a valid body", async () => {
    const request = new Request("http://localhost/api/x", { method: "POST", body: JSON.stringify({ name: "Duel" }) });
    const parsed = await parseJson(request, z.object({ name: z.string() }));
    expect(parsed).toEqual({ ok: true, value: { name: "Duel" } });
  });

  it("answers a body that is not JSON with a 400 naming the problem", async () => {
    const request = new Request("http://localhost/api/x", { method: "POST", body: "not json" });
    const parsed = await parseJson(request, z.object({ name: z.string() }));
    expect(parsed.ok).toBe(false);
    const response = parsed.ok ? null : parsed.response;
    expect(response!.status).toBe(400);
    await expect(response!.json()).resolves.toEqual({ ok: false, error: "Request body must be valid JSON." });
  });

  it("answers a body that fails validation with the first issue, prefixed by its path", async () => {
    const request = new Request("http://localhost/api/x", { method: "POST", body: JSON.stringify({ name: 4 }) });
    const parsed = await parseJson(request, z.object({ name: z.string() }));
    const response = parsed.ok ? null : parsed.response;
    const body = (await response!.json()) as { readonly error: string };
    expect(body.error).toMatch(/^name: /);
  });
});
