import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { SEARCH_CONFIG } from "./config";
import type { SearchResult } from "./contract";
import { useSiteSearch, type FetchJson } from "./use-site-search";

const GIBBS: SearchResult = {
  kind: "player",
  player: { id: "rb1", name: "Jahmyr Gibbs", position: "RB", nflTeam: "DET", headshotUrl: null, adp: null },
  positionRank: 2,
  boardRank: 3,
  byeWeek: 8,
};

interface Call {
  readonly url: string;
  readonly signal: AbortSignal | null | undefined;
  readonly resolve: (body: unknown) => void;
  readonly reject: (error: unknown) => void;
}

/** A fetch that records every call and lets the test settle each one in whatever order it likes. */
function wire() {
  const calls: Call[] = [];
  const fetchJson: FetchJson = (url, init) =>
    new Promise<Response>((resolve, reject) => {
      calls.push({
        url,
        signal: init?.signal,
        resolve: (body) => resolve({ json: async () => body } as unknown as Response),
        reject,
      });
    });
  return { calls, fetchJson };
}

function Probe({ query, fetchJson }: { readonly query: string; readonly fetchJson: FetchJson }) {
  const state = useSiteSearch(query, fetchJson);
  return (
    <p>
      {state.status}:{state.query}:{state.results.map((result) => (result.kind === "player" ? result.player.id : result.code)).join(",")}
    </p>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const settle = async (call: Call, body: unknown) => {
  await act(async () => {
    call.resolve(body);
  });
};

describe("useSiteSearch", () => {
  it("is idle for a blank query and never asks the wire", () => {
    const { calls, fetchJson } = wire();
    render(<Probe query="   " fetchJson={fetchJson} />);
    act(() => vi.advanceTimersByTime(SEARCH_CONFIG.debounceMs * 2));
    expect(screen.getByText("idle::")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("debounces: many keystrokes inside the window cost one request, for the last query", async () => {
    const { calls, fetchJson } = wire();
    const view = render(<Probe query="g" fetchJson={fetchJson} />);
    view.rerender(<Probe query="gi" fetchJson={fetchJson} />);
    view.rerender(<Probe query="gib" fetchJson={fetchJson} />);
    expect(screen.getByText("loading:gib:")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(SEARCH_CONFIG.debounceMs));
    expect(calls.map((call) => call.url)).toEqual(["/api/search?q=gib"]);
    await settle(calls[0]!, { ok: true, data: { query: "gib", results: [GIBBS] } });
    expect(screen.getByText("ready:gib:rb1")).toBeInTheDocument();
  });

  it("aborts a superseded request and ignores its late answer", async () => {
    const { calls, fetchJson } = wire();
    const view = render(<Probe query="gi" fetchJson={fetchJson} />);
    act(() => vi.advanceTimersByTime(SEARCH_CONFIG.debounceMs));
    view.rerender(<Probe query="gibbs" fetchJson={fetchJson} />);
    act(() => vi.advanceTimersByTime(SEARCH_CONFIG.debounceMs));
    expect(calls).toHaveLength(2);
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(calls[1]!.signal?.aborted).toBe(false);
    await settle(calls[1]!, { ok: true, data: { query: "gibbs", results: [GIBBS] } });
    await settle(calls[0]!, { ok: true, data: { query: "gi", results: [] } });
    expect(screen.getByText("ready:gibbs:rb1")).toBeInTheDocument();
  });

  it("keeps the last answer on screen while the next one is in flight", async () => {
    const { calls, fetchJson } = wire();
    const view = render(<Probe query="gib" fetchJson={fetchJson} />);
    act(() => vi.advanceTimersByTime(SEARCH_CONFIG.debounceMs));
    await settle(calls[0]!, { ok: true, data: { query: "gib", results: [GIBBS] } });
    view.rerender(<Probe query="gibb" fetchJson={fetchJson} />);
    expect(screen.getByText("loading:gibb:rb1")).toBeInTheDocument();
  });

  it("reports a failed request or a refusing envelope as failed, with no results", async () => {
    const { calls, fetchJson } = wire();
    render(<Probe query="gib" fetchJson={fetchJson} />);
    act(() => vi.advanceTimersByTime(SEARCH_CONFIG.debounceMs));
    await settle(calls[0]!, { ok: false, error: "You have searched a lot in a short time." });
    expect(screen.getByText("failed:gib:")).toBeInTheDocument();
  });

  it("treats a thrown fetch as failed rather than an unhandled rejection", async () => {
    const { calls, fetchJson } = wire();
    render(<Probe query="gib" fetchJson={fetchJson} />);
    act(() => vi.advanceTimersByTime(SEARCH_CONFIG.debounceMs));
    await act(async () => {
      calls[0]!.reject(new Error("offline"));
    });
    expect(screen.getByText("failed:gib:")).toBeInTheDocument();
  });
});
