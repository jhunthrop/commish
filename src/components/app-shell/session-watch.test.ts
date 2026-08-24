import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_LOST_EVENT, fetchWithSessionWatch, onSessionLost } from "./session-watch";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("fetchWithSessionWatch / onSessionLost", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("hands a successful response back completely unchanged, and emits nothing", async () => {
    const original = jsonResponse(200, { ok: true, data: { hello: "world" } });
    fetchSpy.mockResolvedValue(original);

    const heard: unknown[] = [];
    const off = onSessionLost((detail) => heard.push(detail));

    const response = await fetchWithSessionWatch("/api/notices");
    expect(response).toBe(original);
    expect(await response.json()).toEqual({ ok: true, data: { hello: "world" } });
    expect(heard).toEqual([]);
    off();
  });

  it("hands a 401 in our own envelope shape back unchanged, AND emits a lost-session event", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(401, { ok: false, error: "Not authenticated." }));

    const heard: unknown[] = [];
    const off = onSessionLost((detail) => heard.push(detail));

    const response = await fetchWithSessionWatch("/api/notices");
    expect(response.status).toBe(401);
    // The caller's own subsequent read still works — the envelope check cloned rather than
    // consumed the body.
    expect(await response.json()).toEqual({ ok: false, error: "Not authenticated." });
    expect(heard).toEqual([{ write: false }]);
    off();
  });

  it("marks a write's 401 as a write — anything but GET escalates differently from a read", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(401, { ok: false, error: "Not authenticated." }));

    const heard: unknown[] = [];
    const off = onSessionLost((detail) => heard.push(detail));

    await fetchWithSessionWatch("/api/invites/ABC123/accept", { method: "POST", body: "{}" });
    expect(heard).toEqual([{ write: true }]);
    off();
  });

  it("says nothing on a 401 that is not our envelope shape — a different service's 401 is not a lost session here", async () => {
    fetchSpy.mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    const heard: unknown[] = [];
    const off = onSessionLost((detail) => heard.push(detail));

    await fetchWithSessionWatch("/api/notices");
    expect(heard).toEqual([]);
    off();
  });

  it("says nothing on a non-401 failure — a 500 is not a session problem", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(500, { ok: false, error: "Something went wrong." }));

    const heard: unknown[] = [];
    const off = onSessionLost((detail) => heard.push(detail));

    await fetchWithSessionWatch("/api/notices");
    expect(heard).toEqual([]);
    off();
  });

  it("stops listening once unsubscribed", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(401, { ok: false, error: "Not authenticated." }));

    const heard: unknown[] = [];
    const off = onSessionLost((detail) => heard.push(detail));
    off();

    await fetchWithSessionWatch("/api/notices");
    expect(heard).toEqual([]);
  });

  it("exports the event name as the same string listeners and dispatchers share", () => {
    expect(SESSION_LOST_EVENT).toBe("commish:session-lost");
  });
});
