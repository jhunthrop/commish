import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research/db/client";
import { captureSnapshots } from "@research/db/schema";
import { createTestDb, truncateAll } from "@research/db/test-db";
import { newsFor, newsForPlayers } from "./news";

async function plantNews(db: Db, stories: readonly { title: string; link: string; date?: string }[]): Promise<void> {
  await db.insert(captureSnapshots).values({ source: "tank01_news", capturedAt: new Date(), digest: "d1", payload: stories });
}

describe("newsForPlayers", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("returns an empty bucket per requested name when no snapshot exists", async () => {
    const result = await newsForPlayers(db, ["Rashad Long", "Second Back"]);
    expect(result.get("Rashad Long")).toEqual([]);
    expect(result.get("Second Back")).toEqual([]);
  });

  it("splits one snapshot's stories across every requested name in one pass", async () => {
    await plantNews(db, [
      { title: "Rashad Long: limited in practice", link: "https://example.com/1", date: "2026-09-02" },
      { title: "Second Back: activated from IR", link: "https://example.com/2" },
      { title: "Rashad Long: full participant", link: "https://example.com/3", date: "2026-09-03" },
      { title: "Unrelated Player: waived", link: "https://example.com/4" },
    ]);
    const result = await newsForPlayers(db, ["Rashad Long", "Second Back"]);
    expect(result.get("Rashad Long")).toEqual([
      { title: "Rashad Long: limited in practice", link: "https://example.com/1", publishedAt: "2026-09-02" },
      { title: "Rashad Long: full participant", link: "https://example.com/3", publishedAt: "2026-09-03" },
    ]);
    expect(result.get("Second Back")).toEqual([{ title: "Second Back: activated from IR", link: "https://example.com/2", publishedAt: null }]);
  });

  it("caps each name's stories at three, newest-first as the feed lists them", async () => {
    await plantNews(db, [
      { title: "Rashad Long: one", link: "https://example.com/1" },
      { title: "Rashad Long: two", link: "https://example.com/2" },
      { title: "Rashad Long: three", link: "https://example.com/3" },
      { title: "Rashad Long: four", link: "https://example.com/4" },
    ]);
    const result = await newsForPlayers(db, ["Rashad Long"]);
    expect(result.get("Rashad Long")).toHaveLength(3);
  });

  it("newsFor stays the single-name convenience it always was", async () => {
    await plantNews(db, [{ title: "Rashad Long: limited in practice", link: "https://example.com/1" }]);
    const stories = await newsFor(db, "Rashad Long");
    expect(stories).toEqual([{ title: "Rashad Long: limited in practice", link: "https://example.com/1", publishedAt: null }]);
  });

  it("never attributes another man's headline via a loose match", async () => {
    await plantNews(db, [{ title: "Rashad Longfellow: unrelated story", link: "https://example.com/1" }]);
    const result = await newsForPlayers(db, ["Rashad Long"]);
    expect(result.get("Rashad Long")).toEqual([]);
  });
});
