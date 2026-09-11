import { mkdirSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { createDb, type Db } from "../src/db/client";
import { drafts, leagues, matchups, players, scoringSettings, teams, users, weeks } from "../src/db/schema";
import { STANDARD_ROSTER_SLOTS } from "../src/domain/roster";
import { STANDARD_SCORING } from "../src/domain/scoring";
import { createAuditLogger } from "../src/integrity-service/audit-logger";
import { expect, managerAUserId, test } from "./support/fixtures";

/**
 * THE LEAGUE HOME, COMPLETED (league home completion round). Two things this page could not do
 * before, walked in a real browser against a real league:
 *
 * 1. A reaction on a PICK. The stream carried reactions on messages only; picks, claims and
 *    trades had no slot. Pressed here for real — the write goes to
 *    `POST /api/leagues/[leagueId]/activity/[eventId]/reactions`, the count lands, and a reload
 *    proves the row is in Postgres rather than in this tab's optimistic state.
 * 2. The HEAD-TO-HEAD line on the rival card. "You are 2 and 1 against ..." with the seasons it
 *    covers, counted from settled matchups between the two managers.
 *
 * ITS OWN LEAGUE, not the shared trades fixture. That league keeps exactly one unscored matchup
 * as an enforced invariant (`global-setup.ts`'s own note), and a head-to-head needs SETTLED
 * games; adding them there would quietly change a fixture three other specs depend on.
 */
const OUT_DIR = ".superpowers/mocks/screenshots";

const LEAGUE_ID = "e2e_home_completion_league";
const DRAFT_ID = "e2e_home_completion_draft";
const TEAM_A = "e2e_home_completion_team_a";
const TEAM_B = "e2e_home_completion_team_b";
const CO_MANAGER = "e2e_home_completion_co";
/** Three settled weeks behind, one live week the page opens on. */
const SETTLED_WEEKS = [1, 2, 3] as const;
const CURRENT_WEEK = 4;
/** Manager A wins weeks 1 and 2, loses week 3: "You are 2 and 1 against ...". */
const SCORES: Readonly<Record<number, readonly [number, number]>> = { 1: [110.5, 90.25], 2: [101, 80], 3: [70, 99.5] };

const PICK_EVENT_ID = "e2e_home_completion_pick";

/**
 * Wiped and rebuilt every run, the same idiom `ensureRoomJourneyLeague` uses: a two-team league
 * manager A runs, a complete draft, three settled weeks between the two of them and one week
 * still to play, plus ONE `draft_pick` audit event so the stream has something to react to.
 *
 * The pick event is written through the REAL `createAuditLogger`, never an `INSERT` of my own:
 * `audit_events` is a hash-chained log, and a hand-rolled row would be a broken chain the
 * verifier would later refuse.
 */
async function ensureLeague(db: Db): Promise<void> {
  const commissionerUserId = await managerAUserId(db);
  await db.delete(leagues).where(eq(leagues.id, LEAGUE_ID));
  // `audit_events` has no foreign key to `leagues` — deliberately, the chain outlives what it
  // records — so the delete above leaves this fixture's own chain behind, and a second run would
  // collide on the fixed event id. Erased here with the triggers off, which is the same
  // ownership-level act `@/integrity-service/test-support` performs for the unit suite, and is
  // only ever done to a chain scope this file itself minted.
  await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER USER`);
  try {
    await db.execute(sql`DELETE FROM audit_events WHERE chain_scope = ${LEAGUE_ID}`);
  } finally {
    await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER USER`);
  }
  await db.execute(sql`DELETE FROM audit_chain_checkpoints WHERE scope = ${LEAGUE_ID}`);
  await db.execute(sql`DELETE FROM audit_chains WHERE scope = ${LEAGUE_ID}`);
  await db
    .insert(users)
    .values({ id: CO_MANAGER, email: `${CO_MANAGER}@commish-lab.test`, displayName: "Rey Moreno" })
    .onConflictDoNothing({ target: users.id });

  await db.insert(leagues).values({
    id: LEAGUE_ID,
    name: "Completion League",
    format: "snake",
    teamCount: 2,
    isPublicMatchmade: false,
    commissionerUserId,
    rosterSlots: [...STANDARD_ROSTER_SLOTS],
  });
  await db.insert(scoringSettings).values({ leagueId: LEAGUE_ID, ...STANDARD_SCORING });
  await db.insert(teams).values([
    { id: TEAM_A, leagueId: LEAGUE_ID, userId: commissionerUserId, name: "Sunday Scaries" },
    { id: TEAM_B, leagueId: LEAGUE_ID, userId: CO_MANAGER, name: "Trap Game" },
  ]);
  await db.insert(drafts).values({
    id: DRAFT_ID,
    leagueId: LEAGUE_ID,
    format: "snake",
    status: "complete",
    kickoffAt: new Date(Date.now() - 60 * 60 * 1000),
    auctionBudget: null,
  });

  await db.insert(weeks).values([...SETTLED_WEEKS, CURRENT_WEEK].map((weekNumber) => ({ leagueId: LEAGUE_ID, weekNumber })));
  await db.insert(matchups).values([
    ...SETTLED_WEEKS.map((weekNumber) => ({
      leagueId: LEAGUE_ID,
      weekNumber,
      homeTeamId: TEAM_A,
      awayTeamId: TEAM_B,
      homeScore: SCORES[weekNumber]![0],
      awayScore: SCORES[weekNumber]![1],
    })),
    { leagueId: LEAGUE_ID, weekNumber: CURRENT_WEEK, homeTeamId: TEAM_A, awayTeamId: TEAM_B, homeScore: null, awayScore: null },
  ]);

  // A real player id from the seeded pool, so the stream's sentence names a person rather than
  // falling back to "a player who is no longer listed".
  const [player] = await db.select({ id: players.id, name: players.name }).from(players).limit(1);
  const logger = createAuditLogger({ newId: () => PICK_EVENT_ID });
  await db.transaction((tx) =>
    logger.record(tx, {
      eventType: "draft_pick",
      actorId: CO_MANAGER,
      actorType: "user",
      leagueId: LEAGUE_ID,
      payload: {
        draftId: DRAFT_ID,
        teamId: TEAM_B,
        playerId: player?.id ?? "unknown",
        position: "RB",
        round: 1,
        pickNumber: 1,
        slot: "RB",
        slotIndex: 0,
        price: null,
        auto: false,
      },
      occurredAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    }),
  );
}

test.beforeAll(async () => {
  const db = createDb();
  await ensureLeague(db);
  await db.$client.end();
});

test("a reaction on a pick lands and survives a reload, and the rival card states the head to head", async ({ managerA }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  const theme = process.env.E2E_COLOR_SCHEME ?? "light";
  await managerA.setViewportSize({ width: 1440, height: 900 });
  await managerA.goto(`/app/leagues/${LEAGUE_ID}`);

  // P6: the history between the two of you, in plain numbers, with the seasons it covers.
  const rival = managerA.getByRole("region", { name: "Your game this week" });
  await expect(rival).toBeVisible();
  await expect(rival.getByText("You are 2 and 1 against Rey")).toBeVisible();
  await expect(rival.getByText(/^settled games, \d{4} season$/)).toBeVisible();

  // P5: a pick in the stream wears the same five the messages wear.
  const pick = managerA.getByTestId("stream-event").filter({ hasText: "drafted" }).first();
  await expect(pick).toBeVisible();
  const fire = pick.getByRole("button", { name: "React with 🔥" });
  await expect(fire).toHaveAttribute("aria-pressed", "false");

  await managerA.screenshot({ path: `${OUT_DIR}/league-home-completion-1440-${theme}.png`, fullPage: false });

  // FLUIDITY: a reaction landing must move the pill and NOTHING ELSE. Measured, not asserted by
  // eye — the stream's own top edge before and after the count appears.
  const streamTopBefore = await managerA.getByRole("log", { name: "What happened" }).evaluate((node) => node.getBoundingClientRect().top);
  await fire.click();
  await expect(fire).toHaveAttribute("aria-pressed", "true");
  await expect(fire).toContainText("1");
  const streamTopAfter = await managerA.getByRole("log", { name: "What happened" }).evaluate((node) => node.getBoundingClientRect().top);
  test.info().annotations.push({ type: "layout-shift", description: `stream top moved ${Math.abs(streamTopAfter - streamTopBefore)}px when the reaction landed` });
  expect(Math.abs(streamTopAfter - streamTopBefore), "the stream moved when a reaction landed").toBe(0);

  // IN POSTGRES, NOT IN THIS TAB. A reload re-reads the page server-side; an optimistic count
  // that never reached the database would be gone.
  await managerA.reload();
  const afterReload = managerA.getByTestId("stream-event").filter({ hasText: "drafted" }).first().getByRole("button", { name: "React with 🔥" });
  await expect(afterReload).toHaveAttribute("aria-pressed", "true");
  await expect(afterReload).toContainText("1");

  // And off again, the same one verb in both directions.
  await afterReload.click();
  await expect(afterReload).toHaveAttribute("aria-pressed", "false");
});

test("the completed league home fits a phone, with the head to head and the pick's own reactions", async ({ managerA }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  const theme = process.env.E2E_COLOR_SCHEME ?? "light";
  await managerA.setViewportSize({ width: 360, height: 740 });
  await managerA.goto(`/app/leagues/${LEAGUE_ID}`);

  const rival = managerA.getByRole("region", { name: "Your game this week" });
  await expect(rival.getByText("You are 2 and 1 against Rey")).toBeVisible();
  await expect(managerA.getByRole("log", { name: "What happened" })).toBeAttached();
  await managerA.screenshot({ path: `${OUT_DIR}/league-home-completion-360-${theme}.png`, fullPage: false });

  // P10: the reaction row never pushes the room past a 360px viewport.
  const overflow = await managerA.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll<HTMLElement>("main *"))
      .filter((node) => node.getBoundingClientRect().right > width + 1)
      .slice(0, 8)
      .map((node) => `${node.tagName.toLowerCase()}@${Math.round(node.getBoundingClientRect().right)}`);
  });
  expect(overflow, "the room sticks out past a 360px viewport").toEqual([]);

  const pick = managerA.getByTestId("stream-event").filter({ hasText: "drafted" }).first();
  await pick.scrollIntoViewIfNeeded();
  await expect(pick.getByRole("button", { name: "React with 🤝" })).toBeVisible();
  await managerA.screenshot({ path: `${OUT_DIR}/league-home-completion-360-${theme}-room.png`, fullPage: false });
});
