import { desc, eq } from "drizzle-orm";
import type { Db } from "@research/db/client";
import { captureSnapshots } from "@research/db/schema";

/** One harvested headline. `publishedAt` is read defensively off the feed's own `date` field —
 *  UNVERIFIED against a live fixture (no Tank01 news response is on file in this codebase; see
 *  `src/capsules/collect.ts`'s own note) — and is `null` whenever the snapshot carries no such
 *  field for this story, never fabricated. */
export interface NewsStory {
  readonly title: string;
  readonly link: string;
  readonly publishedAt: string | null;
}

/** One read of the news feed, as both the stories and the stamp that produced them. */
export interface NewsSnapshot {
  readonly capturedAt: Date | null;
  readonly byName: ReadonlyMap<string, readonly NewsStory[]>;
}

async function latestNewsSnapshot(db: Db): Promise<{ readonly capturedAt: Date | null; readonly body: readonly unknown[] }> {
  const [snapshot] = await db
    .select({ payload: captureSnapshots.payload, capturedAt: captureSnapshots.capturedAt })
    .from(captureSnapshots)
    .where(eq(captureSnapshots.source, "tank01_news"))
    .orderBy(desc(captureSnapshots.capturedAt))
    .limit(1);
  const body = snapshot?.payload;
  return { capturedAt: snapshot?.capturedAt ?? null, body: Array.isArray(body) ? body : [] };
}

function storyFrom(raw: unknown): { readonly title: string; readonly link: string; readonly publishedAt: string | null } | null {
  const entry = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const title = typeof entry.title === "string" ? entry.title : "";
  const link = typeof entry.link === "string" ? entry.link : "";
  if (title === "" || link === "") return null;
  const publishedAt = typeof entry.date === "string" && entry.date !== "" ? entry.date : null;
  return { title, link, publishedAt };
}

/**
 * Headlines that name any of `names`, from the latest harvested news snapshot — ONE read of the
 * snapshot serving every name at once, extracted from `player.ts`'s own single-player `newsFor`
 * (2026-08-30) the day a second consumer (`src/capsules/collect.ts`'s board-wide sweep) needed the
 * same feed for hundreds of players in one pass, the same "extract when a second consumer
 * arrives" precedent `injuries.ts` already set for designations.
 *
 * The feed carries no `playerID`, only titles in Tank01's own "Name: sentence" convention — the
 * prefix up to the first colon is the join, strict on purpose: a missed headline costs nothing,
 * another man's headline on his card is the failure this guards. At most three stories per name,
 * newest-first order as the feed itself lists them.
 */
export async function newsForPlayers(db: Db, names: readonly string[]): Promise<ReadonlyMap<string, readonly NewsStory[]>> {
  return (await newsSnapshotForPlayers(db, names)).byName;
}

/** What one news feed says about a list of names, WITH the capture instant that produced it — the
 *  same single read, plus the stamp a stored document's basis has to carry so a reader can see how
 *  old its headlines are (peek document design §3.1). `capturedAt` is `null` when the archive holds
 *  no news capture at all, which is exactly when every name's list is empty. */
export async function newsSnapshotForPlayers(db: Db, names: readonly string[]): Promise<NewsSnapshot> {
  const byName = new Map<string, NewsStory[]>(names.map((name) => [name, []]));
  if (names.length === 0) return { capturedAt: null, byName };

  const { capturedAt, body } = await latestNewsSnapshot(db);
  for (const raw of body) {
    const story = storyFrom(raw);
    if (story === null) continue;
    const colonIndex = story.title.indexOf(":");
    if (colonIndex === -1) continue;
    const prefix = story.title.slice(0, colonIndex);
    const bucket = byName.get(prefix);
    if (bucket === undefined || bucket.length >= 3) continue;
    bucket.push(story);
  }
  return { capturedAt, byName };
}

/** One player's own headlines — the single-name convenience `player.ts` keeps using. */
export async function newsFor(db: Db, name: string): Promise<readonly NewsStory[]> {
  return (await newsForPlayers(db, [name])).get(name) ?? [];
}
