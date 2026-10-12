import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { userPreferences, users } from "@/db/schema";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { ensureMockBotRoster } from "./bot-roster";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("ensureMockBotRoster", () => {
  it("upserts the whole configured roster, each row flagged is_bot and addressed at the reserved domain", async () => {
    await ensureMockBotRoster(db);

    const rows = await db.select().from(users).orderBy(asc(users.id));
    expect(rows).toHaveLength(MOCK_CONFIG.botRoster.length);

    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const bot of MOCK_CONFIG.botRoster) {
      const row = byId.get(bot.id);
      expect(row).toBeDefined();
      expect(row).toMatchObject({ id: bot.id, displayName: bot.name, isBot: true, email: `${bot.id}@bots.commish.internal` });
    }
  });

  it("is idempotent — a second call against an already-seeded database writes the same values and errors on nothing", async () => {
    await ensureMockBotRoster(db);
    await expect(ensureMockBotRoster(db)).resolves.toBeUndefined();

    const rows = await db.select().from(users);
    expect(rows).toHaveLength(MOCK_CONFIG.botRoster.length);
  });

  it("upserts a rename: a pre-existing bot row's stale display name is corrected on the next call (Task 2, founder directive 2026-08-26)", async () => {
    const bot = MOCK_CONFIG.botRoster[0]!;
    await db.insert(users).values({ id: bot.id, email: `${bot.id}@bots.commish.internal`, displayName: "Old Stale Bot Name", isBot: true });

    await ensureMockBotRoster(db);

    const [row] = await db.select().from(users).where(eq(users.id, bot.id));
    expect(row?.displayName).toBe(bot.name);
    expect(row?.displayName).not.toBe("Old Stale Bot Name");
    // The id, email and is_bot columns are never part of the update — only display_name rides
    // the conflict path.
    expect(row).toMatchObject({ id: bot.id, email: `${bot.id}@bots.commish.internal`, isBot: true });
  });

  it("never disturbs a real user row that happens to share no id with any bot", async () => {
    await db.insert(users).values({ id: "real_u1", email: "real@test.local", displayName: "A Real Manager" });
    await ensureMockBotRoster(db);

    const [real] = await db.select().from(users).where(eq(users.id, "real_u1"));
    expect(real).toMatchObject({ isBot: false, displayName: "A Real Manager" });
  });

  it("gives every bot a distinct id, so the seat draw's unique (league, user) index never collides seating two", async () => {
    await ensureMockBotRoster(db);
    const rows = await db.select({ id: users.id }).from(users);
    expect(new Set(rows.map((row) => row.id)).size).toBe(MOCK_CONFIG.botRoster.length);
  });

  it("holds no preference row for a bot — a bot never opens the settings this table exists for", async () => {
    await ensureMockBotRoster(db);
    const prefRows = await db.select().from(userPreferences);
    expect(prefRows).toHaveLength(0);
  });
});
