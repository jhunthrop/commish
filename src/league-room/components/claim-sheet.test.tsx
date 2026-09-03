import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FreeAgentRow } from "@/league-service/claims";
import { LeagueRoomDepsProvider, type LeagueRoomDeps } from "../hooks/deps";
import type { DropCandidate } from "../lib/claim-drop";
import { ClaimSheet } from "./claim-sheet";

function capturingDeps(response: unknown = { ok: true, data: {} }) {
  const calls: { url: string; body: unknown }[] = [];
  const deps: LeagueRoomDeps = {
    fetchJson: (url, init) => {
      calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      return Promise.resolve({ json: () => Promise.resolve(response) } as Response);
    },
    openEventSource: () => ({ addEventListener: () => undefined, close: () => undefined }),
  };
  return { deps, calls };
}

const AGENT: FreeAgentRow = {
  id: "fa1",
  name: "Romeo Doubs",
  position: "WR",
  nflTeam: "GB",
  headshotUrl: null,
  adp: 90,
  onWaiversUntil: "2026-09-16T03:00:00.000Z",
};

const DROPS: readonly DropCandidate[] = [
  { playerId: "b2", playerName: "Quentin Johnston", position: "WR", nflTeam: "LAC", projection: 6.4, adp: 120 },
  { playerId: "b1", playerName: "Jalen McMillan", position: "WR", nflTeam: "TB", projection: 7.1, adp: 110 },
];

const sheet = (deps: LeagueRoomDeps, options: { rosterFull?: boolean; onClaimed?: () => void } = {}) => (
  <LeagueRoomDepsProvider deps={deps}>
    <ClaimSheet
      leagueId="l1"
      agent={AGENT}
      dropCandidates={DROPS}
      rosterFull={options.rosterFull ?? true}
      onClose={vi.fn()}
      onClaimed={options.onClaimed ?? vi.fn()}
    />
  </LeagueRoomDepsProvider>
);

describe("ClaimSheet", () => {
  it("pre-fills the drop with the lowest-projected bench player and states the clear time", () => {
    render(sheet(capturingDeps().deps));
    expect(screen.getByRole("dialog", { name: "Claim Romeo Doubs" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Drop Quentin Johnston/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/on waivers · clears Wednesday, 3:00 AM UTC/)).toBeTruthy();
  });

  it("lets the viewer pick a different drop before the verb", () => {
    render(sheet(capturingDeps().deps));
    fireEvent.click(screen.getByRole("radio", { name: /Drop Jalen McMillan/ }));
    expect(screen.getByRole("radio", { name: /Drop Jalen McMillan/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /Drop Quentin Johnston/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("needs no drop with an open roster spot, and says so", () => {
    render(sheet(capturingDeps().deps, { rosterFull: false }));
    expect(screen.getByText(/no drop is needed/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Keep everyone/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("submits the claim with the chosen drop and renders the filed arm", async () => {
    const { deps, calls } = capturingDeps({ ok: true, data: { waiverFiled: true, clearsAt: "2026-09-16T03:00:00.000Z" } });
    render(sheet(deps));
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    await waitFor(() => expect(screen.getByText(/Claim filed\. It clears Wednesday, 3:00 AM UTC\./)).toBeTruthy());
    expect(calls[0]?.url).toBe("/api/leagues/l1/claims");
    expect(calls[0]?.body).toEqual({ addPlayerId: "fa1", dropPlayerId: "b2" });
  });

  it("renders the immediate-add arm for a free agent off waivers", async () => {
    const { deps } = capturingDeps({ ok: true, data: { added: "fa1", dropped: "b2" } });
    render(sheet(deps));
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    await waitFor(() => expect(screen.getByText("Romeo Doubs is on your roster.")).toBeTruthy());
  });

  it("shows the service's refusal sentence verbatim", async () => {
    const { deps } = capturingDeps({ ok: false, error: "Your roster is full. Pick someone to drop." });
    render(sheet(deps));
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Your roster is full. Pick someone to drop."));
  });
});
