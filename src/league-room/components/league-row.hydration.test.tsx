import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { hydrateSurface } from "@/components/ui/test-utils";
import { UI_CONFIG } from "@/components/ui/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { LeagueRow } from "./league-row";

afterEach(() => {
  vi.useRealTimers();
});

const BASE: PublicLeagueSummary = {
  id: "hp241",
  name: "Half-PPR #241",
  format: "snake",
  experienceTier: "experienced",
  stakeTier: 0,
  entryFeeCents: 0,
  teamCount: 12,
  filledTeams: 9,
  scoringLabel: "Half PPR",
  compositionCategory: "open",
  draftAt: "Thursday 10 September, 8:00 PM UTC (in 3 days)",
  medianGame: false,
  startTrigger: "scheduled",
  houseRung: null,
  heldSeats: 0,
  rosterSummary: "15 slots, 1 flex",
  playoffWeeks: [15, 16, 17],
  kickoffRolls: 0,
};

/** The realistic server-to-client skew that made the founder's dev server throw: the client's
 *  hydration render happens milliseconds-to-seconds after the server computed its HTML. */
const HYDRATION_SKEW_MS = 1_500;

/**
 * FOUNDER-REPORTED LIVE DEFECT (2026-08-24): pages carrying the shelf threw React's
 * hydration-mismatch error. Root cause: `useNow` seeded `useState(() => Date.now())`, so the
 * server rendered countdown text from the server's clock and the client's hydration render
 * recomputed it from its own clock milliseconds later — two different strings for the same
 * node. This suite renders the shelf row the way the server does (`renderToString`), hydrates
 * onto that exact HTML with the clock advanced, and asserts ZERO hydration errors — the truth
 * the dev-server overlay was asserting for us.
 */
describe("LeagueRow SSR hydration (scheduled league inside the clock window)", () => {
  const soonLeague = () => ({
    ...BASE,
    draftAtIso: new Date(Date.now() + UI_CONFIG.openLeagueCard.clockWithinMs / 2).toISOString(),
  });

  it("hydrates onto the server's HTML with zero hydration errors, even with clock skew", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T18:00:00.000Z"));
    const league = soonLeague();

    await hydrateSurface(
      () => <LeagueRow league={league} signedIn={false} />,
      ({ recoverableErrors, consoleErrors }) => {
        expect(recoverableErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
      },
      { beforeHydrate: () => vi.setSystemTime(new Date(Date.now() + HYDRATION_SKEW_MS)) },
    );
  });

  it("serves the non-ticking fallback in the server HTML — the absolute time, never digits computed from the server's clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T18:00:00.000Z"));
    const league = soonLeague();

    await hydrateSurface(
      () => <LeagueRow league={league} signedIn={false} />,
      ({ serverHtml }) => {
        expect(serverHtml).toContain(BASE.draftAt);
        expect(serverHtml).not.toContain('data-testid="draft-clock"');
      },
      { beforeHydrate: () => vi.setSystemTime(new Date(Date.now() + HYDRATION_SKEW_MS)) },
    );
  });

  it("upgrades to the ticking clock after hydration, and the tick still ticks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T18:00:00.000Z"));
    const league = soonLeague();

    await hydrateSurface(
      () => <LeagueRow league={league} signedIn={false} />,
      async ({ container }) => {
        // Post-hydration effects have flushed: the clock has snapped and the digits render.
        const clock = container.querySelector('[data-testid="draft-clock"]');
        expect(clock).not.toBeNull();
        const before = clock!.textContent;
        expect(before).toMatch(/\d:\d\d/);

        await act(async () => {
          vi.advanceTimersByTime(UI_CONFIG.countdown.tickMs);
        });
        expect(clock!.textContent).toMatch(/\d:\d\d/);
        expect(clock!.textContent).not.toBe(before);
      },
      { beforeHydrate: () => vi.setSystemTime(new Date(Date.now() + HYDRATION_SKEW_MS)) },
    );
  });
});
