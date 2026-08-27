import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { InvitePanel } from "./invite-panel";
import { LeagueRoomDepsProvider } from "../hooks/deps";

const LIVE_INVITE = {
  code: "SUNDAY12",
  path: "/app/join/SUNDAY12",
  url: "https://commish.example/app/join/SUNDAY12",
  expiresAt: "2026-08-31T12:00:00.000Z",
  maxUses: 32,
  uses: 0,
};

const EMPTY_LIST = { ok: true, data: { invites: [] } };
const ONE_LIVE = { ok: true, data: { invites: [LIVE_INVITE] } };

afterEach(() => {
  vi.restoreAllMocks();
  // `navigator.clipboard`/`navigator.share` are defined with `Object.defineProperty` (jsdom
  // exposes both as read-only getters `Object.assign` can't touch) — undone here so one test's
  // override can never leak into the next.
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(navigator, "share");
});

describe("InvitePanel", () => {
  it("loads the league's live invites on mount, and offers one next action when there are none", async () => {
    const fixture = fixtureLeagueDeps(EMPTY_LIST);
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <InvitePanel leagueId="l1" />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        await waitFor(() => expect(screen.getByRole("button", { name: "Create invite link" })).toBeInTheDocument());
        // `renderSurface` renders once per theme, so this fires twice on the SAME fixture — every
        // call is still the one, idempotent GET, never a write.
        expect(fixture.calls.every((call) => call === "GET /api/leagues/l1/invites")).toBe(true);
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows the ABSOLUTE url a live invite already has on reload, never the empty-state button (C-03)", async () => {
    const fixture = fixtureLeagueDeps(ONE_LIVE);
    renderInLeague(<InvitePanel leagueId="l1" />, fixture.deps);
    await waitFor(() => expect(screen.getByLabelText("Invite link")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Create invite link" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Invite link")).toHaveValue("https://commish.example/app/join/SUNDAY12");
    expect(screen.getByText("SUNDAY12")).toBeInTheDocument();
  });

  it("mints a new invite and renders its absolute url (C-01)", async () => {
    const fixture = fixtureLeagueDeps(EMPTY_LIST);
    renderInLeague(<InvitePanel leagueId="l1" />, fixture.deps);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create invite link" })).toBeInTheDocument());

    fixture.response = { ok: true, data: LIVE_INVITE };
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));

    await waitFor(() => expect(screen.getByLabelText("Invite link")).toHaveValue("https://commish.example/app/join/SUNDAY12"));
    expect(fixture.calls).toEqual(["GET /api/leagues/l1/invites", "POST /api/leagues/l1/invites"]);
  });

  it("copies the ABSOLUTE url to the clipboard and confirms with Copied (C-01)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // jsdom exposes `navigator.clipboard` as a read-only getter — `Object.assign` throws.
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const fixture = fixtureLeagueDeps(ONE_LIVE);
    renderInLeague(<InvitePanel leagueId="l1" />, fixture.deps);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://commish.example/app/join/SUNDAY12"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
  });

  it("carries the league name in the mailto share fallback when navigator.share is unavailable", async () => {
    const fixture = fixtureLeagueDeps(ONE_LIVE);
    renderInLeague(<InvitePanel leagueId="l1" leagueName="Ana's Office League" />, fixture.deps);
    await waitFor(() => expect(screen.getByRole("link", { name: "Email invite" })).toBeInTheDocument());

    const href = screen.getByRole("link", { name: "Email invite" }).getAttribute("href")!;
    expect(href.startsWith("mailto:")).toBe(true);
    expect(decodeURIComponent(href)).toContain("Join Ana's Office League on Commish");
    expect(decodeURIComponent(href)).toContain("https://commish.example/app/join/SUNDAY12");
  });

  it("uses navigator.share, carrying the league name, when it is available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });

    const fixture = fixtureLeagueDeps(ONE_LIVE);
    renderInLeague(<InvitePanel leagueId="l1" leagueName="Ana's Office League" />, fixture.deps);
    await waitFor(() => expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() =>
      expect(share).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Join Ana's Office League on Commish", url: "https://commish.example/app/join/SUNDAY12" }),
      ),
    );
  });

  it("revokes a live invite, and it drops out of the list (C-03)", async () => {
    const fixture = fixtureLeagueDeps(ONE_LIVE);
    renderInLeague(<InvitePanel leagueId="l1" />, fixture.deps);
    await waitFor(() => expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument());

    fixture.response = { ok: true, data: { code: "SUNDAY12" } };
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Create invite link" })).toBeInTheDocument());
    expect(fixture.calls).toEqual(["GET /api/leagues/l1/invites", "DELETE /api/leagues/l1/invites"]);
  });

  it("keeps the existing live invite visible and offers a SEPARATE, deliberate action to mint another", async () => {
    const fixture = fixtureLeagueDeps(ONE_LIVE);
    renderInLeague(<InvitePanel leagueId="l1" />, fixture.deps);
    await waitFor(() => expect(screen.getByLabelText("Invite link")).toBeInTheDocument());

    const another = { ...LIVE_INVITE, code: "MONDAY99", url: "https://commish.example/app/join/MONDAY99" };
    fixture.response = { ok: true, data: another };
    fireEvent.click(screen.getByRole("button", { name: "Create another link" }));

    await waitFor(() => expect(screen.getAllByLabelText("Invite link")).toHaveLength(2));
    // The original invite is still there — creating another never silently replaced it.
    expect(screen.getByText("SUNDAY12")).toBeInTheDocument();
    expect(screen.getByText("MONDAY99")).toBeInTheDocument();
  });

  it("shows the server's reason when loading fails", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "We could not load your invites just now." });
    renderInLeague(<InvitePanel leagueId="l1" />, fixture.deps);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("We could not load your invites"));
  });

  it("shows the server's reason when minting fails", async () => {
    const fixture = fixtureLeagueDeps(EMPTY_LIST);
    renderInLeague(<InvitePanel leagueId="l1" />, fixture.deps);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create invite link" })).toBeInTheDocument());

    fixture.response = { ok: false, error: "We could not create an invite just now. Please try again." };
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("We could not create an invite"));
  });
});
