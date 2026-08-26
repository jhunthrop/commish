import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, recordStatements, truncateAll } from "@/db/test-db";
import { drafts, leagues, mockRooms, teams, users } from "@/db/schema";
import { LEAGUE_CONFIG } from "@/league";
import { MOCK_CONFIG, MOCK_COPY } from "@/mock-draft/config";
import { copyViolations } from "@/integrity/copy-rules";
import { createMockRoom, MOCK_NOOP_AUDIT, type CreateMockRoomResult } from "./creation";
import { MOCK_TEST_CLOCK, expectNoMockRoomCreated, mockLifecycleDeps, seedLobbyMock, seedPracticePlayers } from "./test-support";

const db = createTestDb();
const NOW_MS = Date.parse(MOCK_TEST_CLOCK.now());

beforeEach(async () => {
  await truncateAll(db);
  vi.restoreAllMocks();
});

async function seedHost(id = "u_host"): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: "Host Person" });
  return id;
}

const soloInput = {
  hostUserId: "u_host",
  mode: "solo",
  teamCount: 12,
  pickSeconds: 60,
  scoringPreset: "ppr",
  rosterShape: "standard",
} as const;

function okOrFail(out: CreateMockRoomResult): Extract<CreateMockRoomResult, { ok: true }> {
  expect(out).toMatchObject({ ok: true });
  return out as Extract<CreateMockRoomResult, { ok: true }>;
}

describe("createMockRoom — solo", () => {
  it("creates a solo room fully seated and started in one call, and the caller lands on a live draft", async () => {
    await seedHost();
    await seedPracticePlayers(db);
    const deps = mockLifecycleDeps(db);

    const out = okOrFail(await createMockRoom(db, soloInput, deps));

    const state = await deps.store.getDraftState(out.draftId);
    expect(state!.phase).toBe("in_progress");
    expect(state!.draftOrder).toHaveLength(12);

    // One human seat (the host), eleven distinct bots off the roster.
    const seated = await db
      .select({ userId: teams.userId, isBot: users.isBot })
      .from(teams)
      .innerJoin(users, eq(users.id, teams.userId))
      .where(eq(teams.leagueId, out.leagueId));
    expect(seated).toHaveLength(12);
    expect(seated.filter((row) => row.isBot)).toHaveLength(11);
    expect(new Set(seated.map((row) => row.userId)).size).toBe(12);

    // A mock is a league row: private by the CHECK's law, free by construction, named honestly.
    const [league] = await db.select().from(leagues).where(eq(leagues.id, out.leagueId));
    expect(league).toMatchObject({ isMock: true, isPublicMatchmade: false, entryFeeCents: 0, name: MOCK_COPY.roomName, commissionerUserId: "u_host" });

    // A solo room's window is `now`: it starts itself, and the ticker's due scan would find it
    // immediately if the in-call start ever failed.
    const [room] = await db.select().from(mockRooms).where(eq(mockRooms.leagueId, out.leagueId));
    expect(room).toMatchObject({ mode: "solo", pickSeconds: 60, botSeed: 7, hostUserId: "u_host", shareCode: out.shareCode });
    expect(room!.startsAt.getTime()).toBe(NOW_MS);
  });

  it("still answers ok when the start refuses after commit: the room stays scheduled for the ticker to retry", async () => {
    await seedHost();
    await seedPracticePlayers(db);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = mockLifecycleDeps(db);
    const out = okOrFail(
      await createMockRoom(db, soloInput, { ...deps, store: { ...deps.store, startDraft: async () => ({ ok: false as const, reason: "injected" }) } }),
    );
    const [draft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, out.draftId));
    expect(draft?.status).toBe("scheduled");
    expect(errors).toHaveBeenCalled();
  });

  it("still answers ok when the start throws after commit, for the same reason", async () => {
    await seedHost();
    await seedPracticePlayers(db);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = mockLifecycleDeps(db);
    const out = okOrFail(
      await createMockRoom(db, soloInput, {
        ...deps,
        store: {
          ...deps.store,
          startDraft: async () => {
            throw new Error("injected");
          },
        },
      }),
    );
    const [draft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, out.draftId));
    expect(draft?.status).toBe("scheduled");
    expect(errors).toHaveBeenCalled();
  });

  it("writes not one audit, notice or money statement across the whole solo lifecycle — ruling 2, held by the statement log", async () => {
    await seedHost();
    await seedPracticePlayers(db);
    const statements = await recordStatements(db, async (logged) => {
      okOrFail(await createMockRoom(logged, soloInput, mockLifecycleDeps(logged)));
    });
    expect(statements.filter((s) => /"(audit_\w+|member_notices|money_\w+)"/.test(s))).toHaveLength(0);
  });
});

describe("createMockRoom — lobby and link", () => {
  it("creates a lobby room unstarted, host seated alone, window at now + fillWindowSeconds", async () => {
    await seedHost();
    const out = okOrFail(await createMockRoom(db, { ...soloInput, mode: "lobby" }, mockLifecycleDeps(db)));

    const [draft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, out.draftId));
    expect(draft?.status).toBe("scheduled");
    expect(await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, out.leagueId))).toHaveLength(1);

    const [room] = await db.select().from(mockRooms).where(eq(mockRooms.leagueId, out.leagueId));
    expect(room?.mode).toBe("lobby");
    expect(room!.startsAt.getTime()).toBe(NOW_MS + MOCK_CONFIG.fillWindowSeconds * 1000);
    expect(out.startsAt).toBe(room!.startsAt.toISOString());
  });

  it("stores a link room's mode and honors the host's own team name", async () => {
    await seedHost();
    const out = okOrFail(await createMockRoom(db, { ...soloInput, mode: "link", teamName: "The Dress Rehearsal" }, mockLifecycleDeps(db)));
    const [room] = await db.select({ mode: mockRooms.mode }).from(mockRooms).where(eq(mockRooms.leagueId, out.leagueId));
    expect(room?.mode).toBe("link");
    const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.leagueId, out.leagueId));
    expect(team?.name).toBe("The Dress Rehearsal");
  });

  it("names the host's team from their profile when no team name is given", async () => {
    await seedHost();
    const out = okOrFail(await createMockRoom(db, { ...soloInput, mode: "lobby" }, mockLifecycleDeps(db)));
    const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.leagueId, out.leagueId));
    expect(team?.name).toBe("Host Person");
  });
});

describe("createMockRoom — refusal proofs", () => {
  it("rolls the whole transaction back when the league id is already claimed: no room, no league, no bot roster", async () => {
    await seedHost();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // A real (non-mock) league already holds the id the injected `newId` mints first.
    await db.insert(users).values({ id: "u_other", email: "other@test.local", displayName: "Other" });
    await db.insert(leagues).values({ id: "taken", name: "Taken", format: "snake", teamCount: 12, commissionerUserId: "u_other" });

    const deps = mockLifecycleDeps(db);
    const out = await createMockRoom(db, { ...soloInput, mode: "lobby" }, { ...deps, newId: () => "taken" });

    expect(out).toMatchObject({ ok: false, status: 500 });
    await expectNoMockRoomCreated(db, "u_host");
    // `ensureMockBotRoster` ran INSIDE the same transaction, so the refusal rolled it back too —
    // the one-transaction shape, proven rather than promised.
    expect(await db.select({ id: users.id }).from(users).where(eq(users.isBot, true))).toEqual([]);
    expect(errors).toHaveBeenCalled();
  });

  it("gives up after the share-code attempts run out, with nothing written", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    await seedHost("u_second_host");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // A `random` pinned to a constant mints the same code every attempt — and that exact code
    // already belongs to the seeded room, so every attempt collides.
    const [existing] = await db.select({ shareCode: mockRooms.shareCode }).from(mockRooms).where(eq(mockRooms.leagueId, room.leagueId));
    const pinned = pinnedRandomFor(existing!.shareCode);

    const deps = mockLifecycleDeps(db);
    const out = await createMockRoom(db, { ...soloInput, hostUserId: "u_second_host", mode: "lobby" }, { ...deps, random: pinned });

    expect(out).toMatchObject({ ok: false, status: 500 });
    await expectNoMockRoomCreated(db, "u_second_host");
    expect(errors).toHaveBeenCalled();
  });

  it("answers a 500 with nothing written when the host does not exist", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await createMockRoom(db, { ...soloInput, hostUserId: "u_ghost", mode: "lobby" }, mockLifecycleDeps(db));
    expect(out).toMatchObject({ ok: false, status: 500 });
    await expectNoMockRoomCreated(db, "u_ghost");
    expect(errors).toHaveBeenCalled();
  });
});

/** Replays an existing share code through `generateInviteCode`'s own arithmetic: a `random`
 *  whose successive draws land each of the code's characters in turn, then repeat. */
function pinnedRandomFor(code: string): () => number {
  const { alphabet } = LEAGUE_CONFIG.invite;
  let i = 0;
  return () => {
    const index = alphabet.indexOf(code[i % code.length]!);
    i += 1;
    return index / alphabet.length;
  };
}

describe("MOCK_NOOP_AUDIT — ruling 2's one sanctioned no-op", () => {
  it("returns synthetic events without ever touching the transaction it was handed", async () => {
    const tx = new Proxy(
      {},
      {
        get() {
          throw new Error("MOCK_NOOP_AUDIT touched the transaction");
        },
      },
    );
    const input = { eventType: "league_created", actorId: "u1", actorType: "user", leagueId: "lg", payload: {}, occurredAt: MOCK_TEST_CLOCK.now() } as const;
    const event = await MOCK_NOOP_AUDIT.record(tx as never, input);
    expect(event).toMatchObject({ eventType: "league_created", chainScope: "lg", sequence: 0 });
    const platform = await MOCK_NOOP_AUDIT.recordAll(tx as never, [{ ...input, leagueId: null }]);
    expect(platform[0]!.chainScope).toBe("");
  });
});

describe("seedLobbyMock — the fixture's own offset lever", () => {
  it("moves starts_at by the given offset", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 2, startsAtOffsetMs: -1 });
    const [row] = await db.select({ startsAt: mockRooms.startsAt }).from(mockRooms).where(eq(mockRooms.leagueId, room.leagueId));
    expect(row!.startsAt.getTime()).toBe(NOW_MS - 1);
  });
});

describe("the practice room's copy", () => {
  it("every sentence this module ships passes the house copy rules", () => {
    expect(copyViolations(MOCK_COPY.roomName)).toEqual([]);
  });
});
