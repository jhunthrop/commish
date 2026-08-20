import { describe, it, expect, beforeEach, vi } from "vitest";
import { GIF_CONFIG } from "@/gifs/config";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { GifProvider, GifSearchBody } from "@/gifs/provider";
import { resetGifSearchRateLimit } from "../_shared";

const currentUser = vi.fn<() => Promise<{ readonly id: string } | null>>();
const createGifProvider = vi.fn<() => GifProvider | null>();

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: () => currentUser(),
  requireCurrentUser: async () => {
    const user = await currentUser();
    if (user === null) throw new Error("not signed in");
    return user;
  },
}));
vi.mock("@/gifs/registry", () => ({
  createGifProvider: () => createGifProvider(),
}));

const { GET } = await import("./route");

beforeEach(() => {
  currentUser.mockResolvedValue({ id: "u1" });
  createGifProvider.mockReset();
  resetGifSearchRateLimit();
});

const TOUCHDOWN = {
  id: "abc123",
  url: "https://media.giphy.com/media/abc123/giphy.gif",
  previewUrl: "https://media.giphy.com/media/abc123/200.gif",
  width: 480,
  height: 270,
  alt: "Touchdown Dance GIF",
};

describe("GET /api/gifs/search", () => {
  it("answers 401 JSON — never a redirect — when nobody is signed in", async () => {
    currentUser.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/gifs/search?q=touchdown"));
    expect(response.status).toBe(401);
  });

  it("404s cleanly when no provider is configured, the unconfigured-degrade path", async () => {
    createGifProvider.mockReturnValue(null);
    const response = await GET(new Request("http://localhost/api/gifs/search?q=touchdown"));
    expect(response.status).toBe(404);
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
  });

  it("searches through the configured provider and returns its results", async () => {
    const search = vi.fn(async () => [TOUCHDOWN]);
    createGifProvider.mockReturnValue({ search });
    const response = await GET(new Request("http://localhost/api/gifs/search?q=touchdown"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as ApiEnvelope<GifSearchBody>;
    expect(body).toEqual({ ok: true, data: { results: [TOUCHDOWN] } });
    expect(search).toHaveBeenCalledWith("touchdown", expect.any(Number));
  });

  it("treats a missing q as an empty search rather than a 400", async () => {
    const search = vi.fn(async () => []);
    createGifProvider.mockReturnValue({ search });
    const response = await GET(new Request("http://localhost/api/gifs/search"));
    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith("", expect.any(Number));
  });

  it("answers 429 once the caller is past the rate-limit threshold, protecting a paid-per-call quota", async () => {
    createGifProvider.mockReturnValue({ search: async () => [TOUCHDOWN] });
    for (let i = 0; i < GIF_CONFIG.searchRateLimit.maxRequests; i += 1) {
      const response = await GET(new Request("http://localhost/api/gifs/search?q=touchdown"));
      expect(response.status).toBe(200);
    }
    const limited = await GET(new Request("http://localhost/api/gifs/search?q=touchdown"));
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toBe("You've searched for a lot of GIFs at once. Give it a minute and try again.");
  });

  it("rate-limits before checking whether a provider is even configured", async () => {
    createGifProvider.mockReturnValue(null);
    for (let i = 0; i < GIF_CONFIG.searchRateLimit.maxRequests; i += 1) {
      await GET(new Request("http://localhost/api/gifs/search?q=touchdown"));
    }
    const limited = await GET(new Request("http://localhost/api/gifs/search?q=touchdown"));
    expect(limited.status).toBe(429);
  });
});
