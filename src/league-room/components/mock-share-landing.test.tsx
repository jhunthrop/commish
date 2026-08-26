import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { MockRoomSummary } from "@/mock-draft-service/lobby";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { MOCK_SHARE_LANDING_PRACTICE_SENTENCE, MockShareLanding } from "./mock-share-landing";

const calls: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => calls.push(`push:${href}`) }),
}));

const SUMMARY: MockRoomSummary = {
  leagueId: "l1",
  shareCode: "ABC123",
  teamCount: 8,
  seatsOpen: 3,
  pickSeconds: 60,
  startsInMs: 90_000,
  mode: "link",
  started: false,
  alreadySeated: false,
};

describe("MockShareLanding", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("shows the room's own seat count and clock", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockShareLanding code="ABC123" summary={SUMMARY} />, fixture.deps);
    expect(screen.getByText("Private link · 8 teams · 60s clock")).toBeInTheDocument();
  });

  it("renders the room's own mode, per summary.mode (E10)", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockShareLanding code="ABC123" summary={{ ...SUMMARY, mode: "lobby" }} />, fixture.deps);
    expect(screen.getByText("Open lobby · 8 teams · 60s clock")).toBeInTheDocument();
  });

  it("states the invitation in the title and the act on the button — not the same words twice (E10)", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockShareLanding code="ABC123" summary={SUMMARY} />, fixture.deps);
    expect(screen.getByRole("heading", { name: "You are invited to a mock draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join this mock draft" })).toBeInTheDocument();
  });

  it("states the practice promise before a stranger commits to anything (E10)", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockShareLanding code="ABC123" summary={SUMMARY} />, fixture.deps);
    expect(screen.getByText(MOCK_SHARE_LANDING_PRACTICE_SENTENCE)).toBeInTheDocument();
  });

  it("carries no hand-rolled wrapper margins — the shell owns the gutter (E9)", () => {
    const fixture = fixtureLeagueDeps();
    const { container } = renderInLeague(<MockShareLanding code="ABC123" summary={SUMMARY} />, fixture.deps);
    expect(container.querySelector(".mx-4")).toBeNull();
    expect(container.querySelector(".mt-3")).toBeNull();
  });

  it("joins on the button and navigates straight into the room", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l1", draftId: "d1", teamId: "t1", alreadySeated: false } });
    renderInLeague(<MockShareLanding code="ABC123" summary={SUMMARY} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join this mock draft" }));
    await waitFor(() => expect(calls).toEqual(["push:/app/drafts/d1"]));
    expect(fixture.calls).toEqual(["POST /api/mock-drafts/ABC123"]);
  });

  it("labels the button for re-entry when the caller already holds a seat", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockShareLanding code="ABC123" summary={{ ...SUMMARY, alreadySeated: true }} />, fixture.deps);
    expect(screen.getByRole("button", { name: "Enter this mock draft" })).toBeInTheDocument();
  });

  it("shows the server's own refusal when a join fails, and never navigates", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "This mock draft is already full. Start a new one whenever you like." });
    renderInLeague(<MockShareLanding code="ABC123" summary={SUMMARY} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join this mock draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already full");
    expect(calls).toEqual([]);
  });

  it("offers no join control to a stranger once the room has started, only a way to start fresh", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockShareLanding code="ABC123" summary={{ ...SUMMARY, started: true, alreadySeated: false }} />, fixture.deps);
    expect(screen.queryByRole("button", { name: /mock draft/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a new one" })).toHaveAttribute("href", "/app/mock-drafts");
  });

  it("still lets an already-seated member re-enter a started room", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockShareLanding code="ABC123" summary={{ ...SUMMARY, started: true, alreadySeated: true }} />, fixture.deps);
    expect(screen.getByRole("button", { name: "Enter this mock draft" })).toBeInTheDocument();
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(<MockShareLanding code="ABC123" summary={SUMMARY} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
