import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { render, screen } from "@testing-library/react";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  usePathname: () => "/join/lg1/hold",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// `AppShell` needs a `NoticesProvider` its real parent layout supplies (not this page) — this
// file is about the WRITE PATH (`@/league-service/join`, `@research-ts/db/client`, `@/league-service/browse`
// all run real, unmocked, against the test database below), never about `AppShell`'s own
// rendering, which `hold/page.test.tsx` already owns as a unit.
vi.mock("@/components/app-shell/app-shell", () => ({
  AppShell: ({ children }: { readonly children: ReactNode }) => children,
}));

import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, leagues, teams, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import SeatHoldPage from "./page";

const db = createTestDb();

const USER = { id: "u1", email: "u1@test.local", displayName: "Ada", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false };

async function seedOpenPublicLeague(id: string): Promise<void> {
  await db.insert(users).values({ id: "owner", email: "owner@test.local", displayName: "Commissioner Casey" }).onConflictDoNothing();
  await db.insert(leagues).values({
    id,
    name: "Rookie Snake Room",
    format: "snake",
    teamCount: 12,
    stakeTier: 0,
    experienceTier: "beginner",
    isPublicMatchmade: true,
    commissionerUserId: "owner",
  });
  await db.insert(drafts).values({
    id: `${id}_draft`,
    leagueId: id,
    format: "snake",
    status: "scheduled",
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: null,
  });
}

async function teamRowsFor(leagueId: string, userId: string) {
  return db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, leagueId), eq(teams.userId, userId)));
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

/**
 * A1's own regression pin (2026-08-27 flow analysis, finding 1): "a GET request permanently
 * joins you to a league". Everything else in this file — `join.ts`, `db/client`, `browse.ts`,
 * `shell-data.ts` — runs UNMOCKED, against the real test database, exactly so this test proves
 * the fix against the real write path rather than a mock that could silently drift from it.
 */
describe("/join/[leagueId]/hold — signed-in GET writes nothing (A1)", () => {
  it("renders the confirm screen for a signed-in non-member and leaves zero teams rows behind", async () => {
    await seedOpenPublicLeague("lg1");
    await db.insert(users).values({ id: USER.id, email: USER.email, displayName: USER.displayName }).onConflictDoNothing();
    vi.mocked(getCurrentUser).mockResolvedValue(USER);

    const page = await SeatHoldPage({ params: Promise.resolve({ leagueId: "lg1" }) });
    render(page);

    expect(await screen.findByRole("heading", { level: 1, name: "Rookie Snake Room" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take your seat in Rookie Snake Room" })).toBeInTheDocument();

    const rows = await teamRowsFor("lg1", USER.id);
    expect(rows).toHaveLength(0);
  });

  it("still writes nothing on a second GET, for a caller who never confirms", async () => {
    await seedOpenPublicLeague("lg2");
    await db.insert(users).values({ id: USER.id, email: USER.email, displayName: USER.displayName }).onConflictDoNothing();
    vi.mocked(getCurrentUser).mockResolvedValue(USER);

    await render(await SeatHoldPage({ params: Promise.resolve({ leagueId: "lg2" }) }));
    await render(await SeatHoldPage({ params: Promise.resolve({ leagueId: "lg2" }) }));

    const rows = await teamRowsFor("lg2", USER.id);
    expect(rows).toHaveLength(0);
  });
});
