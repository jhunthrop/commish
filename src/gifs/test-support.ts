import { describe, expect, it } from "vitest";
import type { GifProvider } from "./provider";

/**
 * The contract EVERY `GifProvider` implementation must satisfy, written against the interface
 * and never against an implementation's internals — mirroring `describeStatsProviderContract`
 * (`src/stats/test-support.ts`), so a future Tenor adapter runs this same suite unchanged.
 */
export function describeGifProviderContract(label: string, factory: () => Promise<GifProvider>): void {
  describe(`${label} satisfies the GifProvider contract`, () => {
    it("returns at most the number of results asked for", async () => {
      expect((await (await factory()).search("touchdown", 3)).length).toBeLessThanOrEqual(3);
    });

    it("gives every result a usable image, a preview, real dimensions and alt text", async () => {
      // Alt text is not optional: a GIF in a chat log with no alt is a message a blind manager
      // cannot read. If upstream has no description, the adapter synthesizes one from the query.
      for (const gif of await (await factory()).search("touchdown", 5)) {
        expect(gif.url.startsWith("https://")).toBe(true);
        expect(gif.previewUrl.startsWith("https://")).toBe(true);
        expect(gif.width).toBeGreaterThan(0);
        expect(gif.height).toBeGreaterThan(0);
        expect(gif.alt).toMatch(/\S/);
      }
    });

    it("never returns the same id twice in one search", async () => {
      const ids = (await (await factory()).search("touchdown", 10)).map((gif) => gif.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("answers an empty query with no results rather than an error", async () => {
      await expect((await factory()).search("   ", 5)).resolves.toEqual([]);
    });
  });
}
