import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LeagueRoomDeps } from "@/league-room/hooks/deps";
import { renderInLeague } from "@/league-room/test-fixtures";
import { defaultPodiumPrizeTable } from "@/money/prize-table";
import { CreateSheet, type CreateSheetDefaults } from "./create-sheet";
import { CrewDoor } from "./crew-door";

/**
 * The defaults a server page threads from `LEAGUE_CONFIG.defaults`. The client boundary bans a
 * `@/league` value import from this directory (its tests included), so THIS literal mirrors the
 * constant, and `src/app/front-door.test.tsx` — server-side, where the import is legal — pins
 * the page's threaded defaults against the real `LEAGUE_CONFIG.defaults` so a drift fails there.
 */
const DEFAULTS: CreateSheetDefaults = {
  teamCount: 12,
  scoringPreset: "half_ppr",
  draftDaysFromCreation: 7,
};

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

/** A fetchJson stub that answers the three writes the sheet can make, recording each call. */
function stubFetch() {
  const fetchJson = vi.fn(async (url: string) => {
    if (url === "/api/leagues") return jsonResponse({ ok: true, data: { leagueId: "L1", teamId: "T1", draftId: "D1" } });
    if (url === "/api/leagues/L1/draft-schedule") return jsonResponse({ ok: true, data: { draftId: "D1" } });
    if (url === "/api/leagues/L1/invites")
      return jsonResponse({
        ok: true,
        data: { code: "CREW1234", path: "/app/join/CREW1234", url: "https://commish.test/app/join/CREW1234", expiresAt: "2026-09-16T00:00:00.000Z", maxUses: 32, uses: 0 },
      });
    throw new Error(`unexpected fetch: ${url}`);
  });
  return { fetchJson, deps: { fetchJson } as unknown as LeagueRoomDeps };
}

function postedBody(fetchJson: ReturnType<typeof vi.fn>, url: string): Record<string, unknown> {
  const call = fetchJson.mock.calls.find(([calledUrl]) => calledUrl === url);
  expect(call, `expected a call to ${url}`).toBeDefined();
  return JSON.parse((call![1] as { body: string }).body) as Record<string, unknown>;
}

describe("CreateSheet (the crew door's four questions)", () => {
  it("pre-fills the threaded house defaults — the service's own, selected on open", () => {
    const { deps } = stubFetch();
    renderInLeague(<CreateSheet signedIn defaults={DEFAULTS} live={false} onClose={() => undefined} />, deps);
    expect(screen.getByRole("button", { name: `${DEFAULTS.teamCount} teams` })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Half PPR" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(new RegExp(`${DEFAULTS.draftDaysFromCreation} days out`))).toBeInTheDocument();
  });

  it("POSTs only the asked fields on an accept-the-defaults create, so the schema's own defaults govern", async () => {
    const { fetchJson, deps } = stubFetch();
    renderInLeague(<CreateSheet signedIn defaults={DEFAULTS} live={false} onClose={() => undefined} />, deps);
    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "The Sunday Regulars" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the league" }));
    await screen.findByText("Your league is live");
    const body = postedBody(fetchJson, "/api/leagues");
    expect(body).toEqual({
      name: "The Sunday Regulars",
      teamCount: DEFAULTS.teamCount,
      scoringPreset: DEFAULTS.scoringPreset,
    });
    // No draft night chosen: the schedule write never fires; the service's default stands.
    expect(fetchJson.mock.calls.some(([url]) => url === "/api/leagues/L1/draft-schedule")).toBe(false);
  });

  it("mints the invite through the existing route and shows the real shareable URL", async () => {
    const { deps } = stubFetch();
    renderInLeague(<CreateSheet signedIn defaults={DEFAULTS} live={false} onClose={() => undefined} />, deps);
    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "The Sunday Regulars" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the league" }));
    expect((await screen.findByTestId("invite-url")).textContent).toBe("https://commish.test/app/join/CREW1234");
    expect(screen.getByRole("link", { name: "Open your league room" })).toHaveAttribute("href", "/app/leagues/L1");
  });

  it("writes a chosen draft night through the existing draft-schedule route, after the create", async () => {
    const { fetchJson, deps } = stubFetch();
    renderInLeague(<CreateSheet signedIn defaults={DEFAULTS} live={false} onClose={() => undefined} />, deps);
    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Night Owls" } });
    fireEvent.change(screen.getByLabelText("Draft night"), { target: { value: "2026-09-11T20:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the league" }));
    await screen.findByText("Your league is live");
    const body = postedBody(fetchJson, "/api/leagues/L1/draft-schedule");
    expect(body.kickoffAt).toBe(new Date("2026-09-11T20:00").toISOString());
  });

  it("asks no buy-in question while money is dark — the derived free sentence stands in", () => {
    const { deps } = stubFetch();
    renderInLeague(<CreateSheet signedIn defaults={DEFAULTS} live={false} onClose={() => undefined} />, deps);
    expect(screen.queryByRole("group", { name: "Buy-in" })).not.toBeInTheDocument();
    expect(screen.getByText("Every league is free this season.")).toBeInTheDocument();
  });

  it("publishes the zero-rake podium table with a live paid create, and no money keys otherwise", async () => {
    const { fetchJson, deps } = stubFetch();
    renderInLeague(<CreateSheet signedIn defaults={DEFAULTS} live onClose={() => undefined} />, deps);
    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Paid Crew" } });
    fireEvent.click(screen.getByRole("button", { name: "$50.00" }));
    fireEvent.click(screen.getByRole("button", { name: "Create the league" }));
    await screen.findByText("Your league is live");
    const body = postedBody(fetchJson, "/api/leagues");
    expect(body.entryFeeCents).toBe(5000);
    expect(body.platformFeeCents).toBe(0);
    expect(body.payoutTable).toEqual(defaultPodiumPrizeTable(5000, DEFAULTS.teamCount));
  });

  it("shows the server's own refusal in place, and never a success state", async () => {
    const fetchJson = vi.fn(async () => jsonResponse({ ok: false, error: "A league needs a name." }));
    renderInLeague(
      <CreateSheet signedIn defaults={DEFAULTS} live={false} onClose={() => undefined} />,
      { fetchJson } as unknown as LeagueRoomDeps,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create the league" }));
    await waitFor(() => expect(screen.getByText("A league needs a name.")).toBeInTheDocument());
    expect(screen.queryByText("Your league is live")).not.toBeInTheDocument();
  });

  it("puts sign-in on the verb for a signed-out visitor, riding the create surface's own intent", () => {
    render(<CreateSheet signedIn={false} defaults={DEFAULTS} live={false} onClose={() => undefined} />);
    const verb = screen.getByRole("link", { name: "Sign in to start your league" });
    expect(verb.getAttribute("href")).toContain(encodeURIComponent("/app#create-league"));
    expect(screen.queryByRole("button", { name: "Create the league" })).not.toBeInTheDocument();
  });
});

describe("CrewDoor (the second door, never hidden)", () => {
  it("keeps the outline verb — the solid amber belongs to the featured row", () => {
    render(<CrewDoor signedIn={false} defaults={DEFAULTS} live={false} />);
    const verb = screen.getByRole("button", { name: "Start a league" });
    expect(verb.className).not.toContain("bg-accent");
    expect(verb).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("opens the create sheet, and derives the pitch from the money switch", () => {
    const { unmount } = render(<CrewDoor signedIn={false} defaults={DEFAULTS} live={false} />);
    expect(screen.getByText(/We run the draft, the schedule and the scoring, and referee trades/)).toBeInTheDocument();
    expect(screen.queryByText(/collect the buy-ins/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start a league" }));
    expect(screen.getByRole("dialog", { name: "Start a league" })).toBeInTheDocument();
    unmount();

    render(<CrewDoor signedIn={false} defaults={DEFAULTS} live />);
    expect(screen.getByText(/collect the buy-ins before the draft/)).toBeInTheDocument();
  });
});
