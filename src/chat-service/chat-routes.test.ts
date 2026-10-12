import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "@research/db/client";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { ChatPageBody, PostChatBody, ReactionBody } from "@/chat/contract";
import { CHAT_CONFIG } from "@/chat/config";
import { chatLeagueFixture } from "./test-support";

const db: Db = createTestDb();
const currentUser = vi.fn<() => Promise<{ readonly id: string } | null>>();

vi.mock("@research/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@research/db/client")>();
  return { ...actual, getDb: () => db };
});
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: () => currentUser(),
  requireCurrentUser: async () => {
    const user = await currentUser();
    if (user === null) throw new Error("not signed in");
    return user;
  },
}));

const { GET, POST } = await import("@/app/api/leagues/[leagueId]/chat/route");
const { POST: REACT } = await import("@/app/api/leagues/[leagueId]/chat/[messageId]/reactions/route");

const leagueContext = { params: Promise.resolve({ leagueId: "l1" }) };
const url = "http://localhost/api/leagues/l1/chat";

function post(body: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(async () => {
  await truncateAll(db);
  await chatLeagueFixture(db);
  currentUser.mockResolvedValue({ id: "u1" });
});

describe("GET /api/leagues/[leagueId]/chat", () => {
  it("answers 401 JSON — never a redirect — when nobody is signed in", async () => {
    currentUser.mockResolvedValue(null);
    const response = await GET(new Request(url), leagueContext);
    expect(response.status).toBe(401);
    expect(((await response.json()) as ApiEnvelope<never>).ok).toBe(false);
  });

  it("answers 403 for a signed-in stranger with no team here", async () => {
    currentUser.mockResolvedValue({ id: "u_stranger" });
    const response = await GET(new Request(url), leagueContext);
    expect(response.status).toBe(403);
  });

  it("returns an empty history with the caller's own id, and never a dead end", async () => {
    const body = (await (await GET(new Request(url), leagueContext)).json()) as ApiEnvelope<ChatPageBody>;
    // gifSearchEnabled is false here because GIF_PROVIDER is unset in the test environment — the
    // unconfigured-degrade default (`gifs/registry.test.ts` owns proving the registry itself).
    expect(body).toEqual({ ok: true, data: { leagueId: "l1", meUserId: "u1", messages: [], hasMore: false, gifSearchEnabled: false } });
  });

  it("rejects a cursor that isn't a message id", async () => {
    const response = await GET(new Request(`${url}?before=drop-table`), leagueContext);
    expect(response.status).toBe(400);
  });

  it("passes a valid cursor through to the service, returning the older page", async () => {
    const first = (await (await POST(post({ body: "first" }), leagueContext)).json()) as ApiEnvelope<PostChatBody>;
    if (!first.ok) throw new Error("post failed");
    const second = (await (await POST(post({ body: "second" }), leagueContext)).json()) as ApiEnvelope<PostChatBody>;
    if (!second.ok) throw new Error("post failed");

    const response = await GET(new Request(`${url}?before=${second.data.message.id}`), leagueContext);
    const body = (await response.json()) as ApiEnvelope<ChatPageBody>;
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.data.messages.map((message) => message.body)).toEqual(["first"]);
  });
});

describe("POST /api/leagues/[leagueId]/chat", () => {
  it("stores the message under the SESSION's user, whatever the body claims", async () => {
    const response = await POST(post({ body: "wheels up", authorUserId: "u2" }), leagueContext);
    const body = (await response.json()) as ApiEnvelope<PostChatBody>;
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.data.message.authorUserId).toBe("u1");
    expect(body.data.message.body).toBe("wheels up");
  });

  it("rejects an empty message with a plain-language 400", async () => {
    const response = await POST(post({ body: "   " }), leagueContext);
    expect(response.status).toBe(400);
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toContain("Type a message first.");
  });

  it("rejects a message past the length cap, naming the offending field", async () => {
    const response = await POST(post({ body: "x".repeat(5_000) }), leagueContext);
    expect(response.status).toBe(400);
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toContain("body");
  });

  const TOUCHDOWN_GIF = {
    url: "https://media.giphy.com/media/abc123/giphy.gif",
    previewUrl: "https://media.giphy.com/media/abc123/200.gif",
    alt: "Touchdown Dance GIF",
    width: 480,
    height: 270,
  };

  it("stores a GIF sent alongside the body, and returns it on the posted message", async () => {
    const response = await POST(post({ body: TOUCHDOWN_GIF.alt, gif: TOUCHDOWN_GIF }), leagueContext);
    const body = (await response.json()) as ApiEnvelope<PostChatBody>;
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.data.message.gif).toEqual(TOUCHDOWN_GIF);
  });

  it("refuses a GIF whose url isn't https — a client-chosen url is client-controlled input", async () => {
    const response = await POST(post({ body: "look", gif: { ...TOUCHDOWN_GIF, url: "http://media.giphy.com/g.gif" } }), leagueContext);
    expect(response.status).toBe(400);
  });

  it("refuses a GIF whose dimensions are outside the configured bounds", async () => {
    const response = await POST(post({ body: "look", gif: { ...TOUCHDOWN_GIF, width: 0 } }), leagueContext);
    expect(response.status).toBe(400);
  });

  // The dimensions were bounded from the start and the three STRINGS were not, so a league
  // member could write unbounded text into `chat_messages` through a field nobody measured.
  // Each refusal names the field it is about.
  it("refuses a GIF url past the configured length ceiling, naming the field", async () => {
    const longUrl = `https://media.giphy.com/${"a".repeat(CHAT_CONFIG.gif.maxUrlLength)}.gif`;
    const response = await POST(post({ body: "look", gif: { ...TOUCHDOWN_GIF, url: longUrl } }), leagueContext);
    expect(response.status).toBe(400);
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toContain("url");
  });

  it("refuses a GIF preview url past the configured length ceiling, naming the field", async () => {
    const longUrl = `https://media.giphy.com/${"a".repeat(CHAT_CONFIG.gif.maxUrlLength)}.gif`;
    const response = await POST(post({ body: "look", gif: { ...TOUCHDOWN_GIF, previewUrl: longUrl } }), leagueContext);
    expect(response.status).toBe(400);
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toContain("previewUrl");
  });

  it("refuses a GIF description past the configured length ceiling, naming the field", async () => {
    const longAlt = "x".repeat(CHAT_CONFIG.gif.maxAltLength + 1);
    const response = await POST(post({ body: "look", gif: { ...TOUCHDOWN_GIF, alt: longAlt } }), leagueContext);
    expect(response.status).toBe(400);
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toContain("alt");
  });

  it("refuses a GIF whose preview url isn't https, the same as its url", async () => {
    const response = await POST(post({ body: "look", gif: { ...TOUCHDOWN_GIF, previewUrl: "http://media.giphy.com/200.gif" } }), leagueContext);
    expect(response.status).toBe(400);
  });
});

describe("POST /api/leagues/[leagueId]/chat/[messageId]/reactions", () => {
  it("toggles the caller's own reaction on and off", async () => {
    const posted = (await (await POST(post({ body: "clutch" }), leagueContext)).json()) as ApiEnvelope<PostChatBody>;
    if (!posted.ok) throw new Error("post failed");
    const messageId = posted.data.message.id;
    const context = { params: Promise.resolve({ leagueId: "l1", messageId }) };

    // The wire carries the TRANSITION this call made, not a re-read of the whole set: the
    // client folds it exactly as it folds a `chat.reaction` frame.
    const added = (await (await REACT(post({ emoji: "🔥" }), context)).json()) as ApiEnvelope<ReactionBody>;
    expect(added).toEqual({ ok: true, data: { messageId, action: "added" } });

    const removed = (await (await REACT(post({ emoji: "🔥" }), context)).json()) as ApiEnvelope<ReactionBody>;
    expect(removed).toEqual({ ok: true, data: { messageId, action: "removed" } });
  });

  it("rejects an emoji outside the league's set, naming the offending field", async () => {
    const posted = (await (await POST(post({ body: "clutch" }), leagueContext)).json()) as ApiEnvelope<PostChatBody>;
    if (!posted.ok) throw new Error("post failed");
    const context = { params: Promise.resolve({ leagueId: "l1", messageId: posted.data.message.id }) };
    const response = await REACT(post({ emoji: "💀" }), context);
    expect(response.status).toBe(400);
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toContain("emoji");
  });

  it("404s a message id that isn't in this league", async () => {
    const context = { params: Promise.resolve({ leagueId: "l1", messageId: "999999" }) };
    const response = await REACT(post({ emoji: "🔥" }), context);
    expect(response.status).toBe(404);
  });

  // The path param reached `Number(messageId)` and then a bigint comparison: `Number("abc")`
  // is NaN, which the driver serializes as "NaN" and Postgres rejects outright, so the route's
  // error boundary answered a generic 500 and logged a database error for what is plainly a
  // malformed request. The `before` cursor on the sibling GET has been guarded against exactly
  // this since day one; the path param never was.
  it("rejects a message id that isn't a number with a 400, naming the param — never a 500", async () => {
    const context = { params: Promise.resolve({ leagueId: "l1", messageId: "drop-table" }) };
    const response = await REACT(post({ emoji: "🔥" }), context);
    expect(response.status).toBe(400);
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toContain("messageId");
  });

  // All digits, and still not an id any bigserial can hold: `^\d{1,19}$` admitted values above
  // int8's max (9223372036854775807), which fails in the driver the same way "NaN" does.
  it("rejects an all-digits id larger than a bigint with a 400, not a 500", async () => {
    const context = { params: Promise.resolve({ leagueId: "l1", messageId: "9999999999999999999" }) };
    expect((await REACT(post({ emoji: "🔥" }), context)).status).toBe(400);
  });

  it("still 404s a well-formed id that simply isn't there", async () => {
    const context = { params: Promise.resolve({ leagueId: "l1", messageId: "424242" }) };
    const response = await REACT(post({ emoji: "🔥" }), context);
    expect(response.status).toBe(404);
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toBe("That message is no longer here.");
  });
});
