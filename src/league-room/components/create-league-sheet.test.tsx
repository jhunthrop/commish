import { describe, it, expect, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { LeagueRoomDeps } from "@/league-room/hooks/deps";
import { renderInLeague } from "@/league-room/test-fixtures";
import { CreateLeagueSheetHost, openCreateLeagueSheet } from "./create-league-sheet";
import type { CreateSheetDefaults } from "./create-sheet";

const DEFAULTS: CreateSheetDefaults = { teamCount: 12, scoringPreset: "half_ppr", draftDaysFromCreation: 7 };

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

/** Mirrors `create-sheet.test.tsx`'s own `stubFetch` — the three writes a successful create can make. */
function stubFetch() {
  const fetchJson = vi.fn(async (url: string) => {
    if (url === "/api/leagues") return jsonResponse({ ok: true, data: { leagueId: "L1", teamId: "T1", draftId: "D1" } });
    if (url === "/api/leagues/L1/invites")
      return jsonResponse({
        ok: true,
        data: { code: "CREW1234", path: "/app/join/CREW1234", url: "https://commish.test/app/join/CREW1234", expiresAt: "2026-09-16T00:00:00.000Z", maxUses: 32, uses: 0 },
      });
    throw new Error(`unexpected fetch: ${url}`);
  });
  return { fetchJson, deps: { fetchJson } as unknown as LeagueRoomDeps };
}

afterEach(() => {
  window.location.hash = "";
});

describe("CreateLeagueSheetHost (the one sheet every in-app trigger reaches)", () => {
  it("renders nothing until something opens it", () => {
    const { container } = render(<CreateLeagueSheetHost defaults={DEFAULTS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens on openCreateLeagueSheet(), and closes on the sheet's own close control", () => {
    render(<CreateLeagueSheetHost defaults={DEFAULTS} />);
    act(() => openCreateLeagueSheet());
    expect(screen.getByRole("dialog", { name: "Start a league" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does nothing, quietly, once its host has unmounted — a dead click, never a crash", () => {
    const { unmount } = render(<CreateLeagueSheetHost defaults={DEFAULTS} />);
    unmount();
    expect(() => openCreateLeagueSheet()).not.toThrow();
  });

  it("opens on mount when the URL already carries #create-league, and clears the fragment", () => {
    window.location.hash = "#create-league";
    render(<CreateLeagueSheetHost defaults={DEFAULTS} />);
    expect(screen.getByRole("dialog", { name: "Start a league" })).toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("stays closed on mount for any other, or no, fragment", () => {
    window.location.hash = "#something-else";
    render(<CreateLeagueSheetHost defaults={DEFAULTS} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens when the fragment arrives AFTER mount — the league rail's own click path", () => {
    // Production incident, 2026-09-03 (`StartOrJoinDisclosure`'s old docblock recounts the
    // same one): a fragment link into an already-loaded page only fires `hashchange`.
    window.location.hash = "";
    render(<CreateLeagueSheetHost defaults={DEFAULTS} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    window.location.hash = "#create-league";
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("dialog", { name: "Start a league" })).toBeInTheDocument();
  });

  it("closes and hands off to the new league room once the create completes", async () => {
    const { deps } = stubFetch();
    renderInLeague(<CreateLeagueSheetHost defaults={DEFAULTS} />, deps);
    act(() => openCreateLeagueSheet());
    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "The Sunday Regulars" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the league" }));
    const openRoom = await screen.findByRole("link", { name: "Open your league room" });
    expect(openRoom).toHaveAttribute("href", "/app/leagues/L1");
    fireEvent.click(openRoom);
    // The Link itself performs the navigation; this host's own job is to stop holding the sheet
    // open behind whatever page that navigation lands on.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
