import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SimSummary } from "@/draft-service/sim/types";
import type { SimRunView } from "@/draft-service/sim/view";
import { SimulatorClient } from "./simulator-client";

const SUMMARY: SimSummary = {
  runs: 100,
  teamCount: 12,
  slot: 1,
  rounds: 2,
  baselineTop3Rate: 0.25,
  builds: [
    { label: "hero-RB", runsWithLabel: 40, top3FinishRate: 0.4 },
    { label: "zero-RB", runsWithLabel: 20, top3FinishRate: 0.2 },
    { label: "robust-RB", runsWithLabel: 40, top3FinishRate: 0.3 },
    { label: "early-TE", runsWithLabel: 10, top3FinishRate: 0.5 },
    { label: "late-QB", runsWithLabel: 60, top3FinishRate: 0.35 },
  ],
  availability: [
    { pickNumber: 1, round: 1, expectedBestAvailable: { playerId: "p1", position: "RB" }, survivalRate: 1, fallbacks: [] },
    { pickNumber: 24, round: 2, expectedBestAvailable: { playerId: "p2", position: "TE" }, survivalRate: 0.4, fallbacks: [{ playerId: "p3", position: "TE", runs: 30 }] },
  ],
  exposure: [{ playerId: "p1", position: "RB", rosterShare: 1 }],
  meanFinishRank: 4,
  elapsedMs: 1234,
};

const SUCCEEDED_RUN: SimRunView = {
  id: "run-1",
  leagueId: null,
  config: { teamCount: 12, rosterSlots: [], slot: 1, rounds: 2, runs: 100, sharpness: 0.5, seed: 1 },
  status: "succeeded",
  requestedAt: "2026-09-01T00:00:00.000Z",
  finishedAt: "2026-09-01T00:00:01.000Z",
  summary: SUMMARY,
  error: null,
  players: { p1: { name: "Player One", team: "SF" }, p2: { name: "Player Two", team: "DAL" }, p3: { name: "Player Three", team: "MIA" } },
};

function renderWithClient(children: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

describe("SimulatorClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an empty state before any sim has been run", () => {
    renderWithClient(<SimulatorClient leagueId={null} leagueLabel="Generic (PPR, 12-team)" teamCount={12} rounds={15} />);
    expect(screen.getByText("No sim run yet")).toBeInTheDocument();
  });

  it("runs a sim and renders the real build, availability, and exposure numbers back", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: SUCCEEDED_RUN }) } as Response);

    renderWithClient(<SimulatorClient leagueId={null} leagueLabel="Generic (PPR, 12-team)" teamCount={12} rounds={15} />);
    await userEvent.click(screen.getByRole("button", { name: /Run 100 drafts/ }));

    await waitFor(() => expect(screen.getByText(/What wins from pick 1/)).toBeInTheDocument());
    expect(screen.getByText(/Hero-RB \(40 runs\)/)).toBeInTheDocument();
    expect(screen.getAllByText("Player One (RB)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("100%").length).toBeGreaterThan(0);

    const [createCall] = fetchMock.mock.calls;
    expect(createCall![0]).toBe("/api/draft/sim");
    const body = JSON.parse((createCall![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ leagueId: null, slot: 1, rounds: 15, runs: 100, sharpness: 0.5 });
  });

  it("shows an honest queued state, never a fake spinner sentence, for a pending run", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { ...SUCCEEDED_RUN, status: "pending", summary: null, players: {} } }),
    } as Response);

    renderWithClient(<SimulatorClient leagueId={null} leagueLabel="Generic (PPR, 12-team)" teamCount={12} rounds={15} />);
    await userEvent.click(screen.getByRole("button", { name: /Run 100 drafts/ }));

    await waitFor(() => expect(screen.getByText("Queued")).toBeInTheDocument());
    expect(screen.getByText("Waiting for a worker to pick this run up.")).toBeInTheDocument();
  });

  it("shows the failure reason for a failed run, never a fabricated summary", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { ...SUCCEEDED_RUN, status: "failed", summary: null, error: "the evidence board carries fewer players than the draft needs." } }),
    } as Response);

    renderWithClient(<SimulatorClient leagueId={null} leagueLabel="Generic (PPR, 12-team)" teamCount={12} rounds={15} />);
    await userEvent.click(screen.getByRole("button", { name: /Run 100 drafts/ }));

    await waitFor(() => expect(screen.getByText(/This sim run failed/)).toBeInTheDocument());
    expect(screen.getByText(/fewer players/)).toBeInTheDocument();
  });

  it("changing the slot picker changes the create request's own slot", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: SUCCEEDED_RUN }) } as Response);

    renderWithClient(<SimulatorClient leagueId={null} leagueLabel="Generic (PPR, 12-team)" teamCount={12} rounds={15} />);
    const slotGroup = screen.getByRole("group", { name: "Your slot" });
    await userEvent.click(within(slotGroup).getByRole("button", { name: "7" }));
    await userEvent.click(screen.getByRole("button", { name: /Run 100 drafts/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.slot).toBe(7);
  });
});
