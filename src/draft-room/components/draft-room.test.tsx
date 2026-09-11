import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ToastProvider } from "@/components/ui";
import { hydrateSurface, renderSurface } from "@/components/ui/test-utils";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import { AUCTION_VIEW, clockOf, fixtureDeps, MOCK_RESULTS_INFO, MOCK_ROOM, renderInRoom, SNAKE_VIEW, type FixtureDeps } from "../test-fixtures";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { DraftRoomDepsProvider } from "../hooks/deps";
import { DraftRoom } from "./draft-room";

// The debrief (`MockResults`) owns its own rematch navigation now, so mounting a finished mock
// pulls `useRouter` into the tree — mocked the same way every page test mocks it.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ push: vi.fn() }),
}));

/** Already dismissed, so `RoomTour` stays out of the way of every case that isn't testing it. */
const TOUR_DISMISSED = "2026-01-01T00:00:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * THE POOL IS THE DOCK (Sideline rulings 2026-09-10): the list is always on stage at desktop
 * width, and only the composition for the current width mounts. This waits for the room to be
 * ready, which is when the list exists.
 */
async function openPool(): Promise<void> {
  await waitFor(() => expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument());
}

/**
 * The room and the stream's presence each subscribe to the league stream through the deps seam
 * (one shared `EventSource` in a browser; two fake sources here). A frame is delivered to both,
 * the way the shared stream would, once both are open.
 */
async function awaitSources(fixture: FixtureDeps): Promise<void> {
  await waitFor(() => expect(fixture.sources).toHaveLength(2));
}

function emit(fixture: FixtureDeps, type: string, payload?: unknown): void {
  for (const source of fixture.sources) source.emit(type, payload);
}

function mount(fixture = fixtureDeps(), dismissedAt: string | null = TOUR_DISMISSED) {
  const rendered = renderInRoom(
    <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
      <ToastProvider>
        {/* The topBar slot is whatever the page composed — a stub here, because these tests
            assert WHERE the room mounts it, not what TopBar renders (top-bar.test.tsx's job). */}
        <DraftRoom draftId="d1" dismissedAt={dismissedAt} topBar={<div data-testid="top-bar-slot" />} />
      </ToastProvider>
    </ChatRoomDepsProvider>,
    fixture.deps,
  );
  return { fixture, rendered };
}

describe("DraftRoom", () => {
  it("shows a loading state, then the live snake room — both themes, axe-clean", async () => {
    const fixture = fixtureDeps();
    await renderSurface(
      <DraftRoomDepsProvider deps={fixture.deps}>
        <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
          <ToastProvider>
            <DraftRoom draftId="d1" dismissedAt={TOUR_DISMISSED} />
          </ToastProvider>
        </ChatRoomDepsProvider>
      </DraftRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText("Loading…")).toBeInTheDocument();
        // The quilt's column heads carry the full team name as each code's <abbr> title.
        await waitFor(() => expect(screen.getAllByTitle("Bay Bandits").length).toBeGreaterThan(0));
        expect(screen.getByTestId("quilt-room")).toBeInTheDocument();
        await openPool();
        expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // SIDELINE (2026-09-10): the snake room's right-edge aside is GONE. Rosters are sheets from
  // the wall's manager heads, the stream is the room's own, and the auction room still renders
  // the old shell's band (`auction-room.test.tsx` covers it).
  it("opens a roster as a sheet from a manager head on the wall instead of the old aside", async () => {
    mount();
    await openPool();
    expect(screen.queryByTestId("room-aside")).not.toBeInTheDocument();
    expect(screen.queryByTestId("roster-spine")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Bay Bandits, you. Open the roster." }));
    });
    expect(screen.getByTestId("roster-sheet")).toHaveTextContent("Dana Whitfield");
  });

  it("tells a commissioner with no team of their own that nothing in the dock is theirs to pick", async () => {
    const fixture = fixtureDeps();
    fixture.teamId = null;
    mount(fixture);
    await waitFor(() => expect(screen.getByTestId("quilt-room")).toBeInTheDocument());
    expect(screen.getByTestId("dock-call")).toHaveAttribute("data-empty", "true");
    expect(screen.queryByTestId("dock-verb")).not.toBeInTheDocument();
  });

  it("offers a retry when the draft cannot be loaded", async () => {
    const fixture = fixtureDeps();
    fixture.deps = { ...fixture.deps, fetchJson: async () => ({ json: async () => ({ ok: false, error: "That draft does not exist." }) }) as unknown as Response };
    renderInRoom(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <ToastProvider>
          <DraftRoom draftId="d1" dismissedAt={TOUR_DISMISSED} />
        </ToastProvider>
      </ChatRoomDepsProvider>,
      fixture.deps,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That draft does not exist."));
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("submits a pick and shows the reducer's reason in a toast when it is rejected", async () => {
    const fixture = fixtureDeps();
    fixture.postResponse = { ok: false, error: "It's not your turn to pick." };
    mount(fixture);
    await openPool();
    await waitFor(() => expect(screen.getByTestId("dock-verb")).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByTestId("dock-verb"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("It's not your turn to pick.");
    // rolled back: the player is available again
    expect(within(screen.getByRole("list", { name: /available players/i })).getByRole("button", { name: "Jalen Croft" })).toBeInTheDocument();
  });

  it("queues a player and shows the reducer's reason in a toast when the queue change is rejected", async () => {
    // Off your clock: a pool row's one verb is Queue (on it, the verb is Draft).
    const fixture = fixtureDeps({ ...SNAKE_VIEW, onClockTeamId: "t2", upcoming: ["t2", "t1"] });
    fixture.queueResponse = { ok: false, error: "A queue can hold at most 50 players." };
    mount(fixture);
    await openPool();
    await waitFor(() => expect(within(screen.getByRole("list", { name: /available players/i })).getByRole("button", { name: "Queue Jalen Croft" })).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(within(screen.getByRole("list", { name: /available players/i })).getByRole("button", { name: "Queue Jalen Croft" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("A queue can hold at most 50 players.");
    // Rolled back: the pool still offers to queue the player, not to remove them.
    expect(within(screen.getByRole("list", { name: /available players/i })).getByRole("button", { name: "Queue Jalen Croft" })).toBeInTheDocument();
  });

  it("tells the user when the connection drops", async () => {
    const { fixture } = mount();
    await awaitSources(fixture);
    act(() => emit(fixture, "error"));
    expect(await screen.findByText("Reconnecting…")).toBeInTheDocument();
  });

  // Task 4, R3: a real `DraftRoom` renders `RoomRail`/`RoomDock`/`PlayerPool`, so every anchor
  // target `RoomTour` looks for is already in the DOM the moment the tour opens here — it gets
  // the anchored coach marks, not the modal (`room-tour.test.tsx` covers the modal fallback
  // itself, on surfaces — like the waiting room's preview — that never render those three).
  it("shows the room tour once, anchored to the real clock, before it has ever been dismissed", async () => {
    mount(fixtureDeps(), null);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "The clock" })).toBeInTheDocument());
  });

  // T4 review MEDIUM: a SCHEDULED room renders no ticking clock, so `room-clock` is absent and
  // the tour must degrade to the modal — cleanly, no crash, no empty overlay. This is the
  // waiting phase a lobby/link mock's first-timer actually lands in.
  it("falls back to the modal tour in a scheduled room, where the clock anchor does not exist yet", async () => {
    mount(fixtureDeps({ ...SNAKE_VIEW, phase: "scheduled", onClockTeamId: null, deadlineAt: null }), null);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "How this room works" })).toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "The clock" })).toBeNull();
  });

  it("PATCHes the dismissal and closes the anchored tour without blocking the room", async () => {
    const { fixture } = mount(fixtureDeps(), null);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "The clock" })).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fixture.calls).toContain("PATCH /api/preferences");
    // The rest of the room is unaffected — the tour never sat between a manager and the board.
    await openPool();
    expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();
  });

  it("never shows the tour once it has already been dismissed", async () => {
    mount();
    await openPool();
    expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Task 1 (player-name adoption sweep): the host is mounted in the live room viewport, inert
  // until a name is pressed — a real press reaches all the way to the season peek.
  it("mounts the player-peek host in the live room, reachable from a pool row's name", async () => {
    mount();
    await openPool();
    expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();
    const name = screen.getByRole("button", { name: "Jalen Croft" });
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: "Jalen Croft" })).toBeInTheDocument();
    // The room's own no-page-scroll contract is untouched: the sheet overlays, it does not add
    // a scrolling child to the viewport frame.
    expect(screen.getByTestId("room-viewport").className).toContain("lg:overflow-hidden");
  });
});

/**
 * Task 8: the room's own honest chrome for a mock draft. `mock: null` (the default `fixtureDeps`
 * already sets) is a REAL draft, and every case above already proves that shape unaffected —
 * these cases exercise the three new `mock`-populated shapes instead.
 */
describe("DraftRoom — Task 8's mock room dressing", () => {
  it("mounts no practice banner and no share panel for a real draft", async () => {
    mount();
    await openPool();
    expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();
    expect(screen.queryByTestId("practice-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("share-link-panel")).not.toBeInTheDocument();
  });

  it("shows the practice banner for the whole life of a mock room", async () => {
    const fixture = fixtureDeps();
    fixture.mock = MOCK_ROOM;
    mount(fixture);
    await waitFor(() => expect(screen.getByTestId("practice-banner")).toHaveTextContent(MOCK_ROOM.practiceBanner));
    // The rest of the room is unaffected — the banner is additive chrome, not a replacement.
    await openPool();
    expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();
  });

  it("mounts ShareLinkPanel beside the waiting room for an unstarted link-mode mock", async () => {
    const fixture = fixtureDeps({ ...SNAKE_VIEW, phase: "scheduled", onClockTeamId: null });
    fixture.mock = {
      ...MOCK_ROOM,
      share: { shareCode: "ABC123", path: "/app/mock-drafts/ABC123", url: "https://commish.football/app/mock-drafts/ABC123", teamCount: 8, seatsFilled: 3, startsAt: "2026-09-01T00:10:00.000Z" },
    };
    mount(fixture);
    await waitFor(() => expect(screen.getByTestId("share-link-panel")).toBeInTheDocument());
    expect(screen.getByLabelText("Share link")).toHaveValue("https://commish.football/app/mock-drafts/ABC123");
  });

  // Task 1 (player-name adoption sweep): the host is mounted in the settled debrief branch too
  // — the founder's own screenshot — reachable from the pick-log's name.
  it("mounts the player-peek host in the settled debrief, reachable from a pick-log row's name", async () => {
    const fixture = fixtureDeps({
      ...SNAKE_VIEW,
      phase: "complete",
      onClockTeamId: null,
      picks: [{ pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false }],
      rosters: { t1: [{ slot: "QB", slotIndex: 0, playerId: "qb1" }], t2: [] },
    });
    fixture.mock = { ...MOCK_ROOM, results: MOCK_RESULTS_INFO };
    mount(fixture);
    await waitFor(() => expect(screen.getByRole("heading", { name: "The debrief" })).toBeInTheDocument());
    // Scoped to the wire: the same name also shows on the verdict lane and the finished board,
    // and this test only needs proof that ONE of them reaches the host.
    const name = within(screen.getByTestId("pick-wire")).getByRole("button", { name: "Jalen Croft" });
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: "Jalen Croft" })).toBeInTheDocument();
  });

  it("lets the board yield entirely to MockResults once a mock draft finishes", async () => {
    const fixture = fixtureDeps({ ...SNAKE_VIEW, phase: "complete", onClockTeamId: null });
    fixture.mock = {
      ...MOCK_ROOM,
      results: MOCK_RESULTS_INFO,
    };
    mount(fixture);
    await waitFor(() => expect(screen.getByRole("heading", { name: "The debrief" })).toBeInTheDocument());
    // The board and dock are gone — the debrief is what the room shows now.
    expect(screen.queryByRole("list", { name: /available players/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the mock draft lobby" })).toBeInTheDocument();
  });

  it("mounts the page's topBar slot on the settled debrief, and ONLY there — the live room stays chrome-less", async () => {
    // Founder, 2026-09-04: the debrief is a normal scrolling page again, so it gets normal
    // wayfinding; the live room's chrome remains RoomRail alone (no-page-scroll contract).
    const settled = fixtureDeps({ ...SNAKE_VIEW, phase: "complete", onClockTeamId: null });
    settled.mock = { ...MOCK_ROOM, results: MOCK_RESULTS_INFO };
    const { rendered } = mount(settled);
    await waitFor(() => expect(screen.getByRole("heading", { name: "The debrief" })).toBeInTheDocument());
    expect(screen.getByTestId("top-bar-slot")).toBeInTheDocument();
    rendered.unmount();

    mount(fixtureDeps());
    await waitFor(() => expect(screen.getByTestId("room-viewport")).toBeInTheDocument());
    expect(screen.queryByTestId("top-bar-slot")).not.toBeInTheDocument();
  });

  it("is axe-clean with every one of its own additions mounted at once, in both themes", async () => {
    const fixture = fixtureDeps({ ...SNAKE_VIEW, phase: "scheduled", onClockTeamId: null });
    fixture.mock = {
      ...MOCK_ROOM,
      share: { shareCode: "ABC123", path: "/app/mock-drafts/ABC123", url: "https://commish.football/app/mock-drafts/ABC123", teamCount: 8, seatsFilled: 3, startsAt: "2026-09-01T00:10:00.000Z" },
    };
    await renderSurface(
      <DraftRoomDepsProvider deps={fixture.deps}>
        <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
          <ToastProvider>
            <DraftRoom draftId="d1" dismissedAt="2026-01-01T00:00:00.000Z" />
          </ToastProvider>
        </ChatRoomDepsProvider>
      </DraftRoomDepsProvider>,
      async ({ container }) => {
        await waitFor(() => expect(screen.getByTestId("share-link-panel")).toBeInTheDocument());
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // T3 review HIGH, still load-bearing after the founder directive 2026-08-26 (room-product
  // pass) removed the chat's own matchMedia read: DraftRoom must hydrate cleanly regardless —
  // the LeagueRow/useNow incident's exact defect class this guard exists to catch, should any
  // future render-time global read sneak back in.
  it("hydrates onto the server HTML with zero errors on a narrow viewport", async () => {
    const fixture = fixtureDeps();
    await hydrateSurface(
      () => (
        <DraftRoomDepsProvider deps={fixture.deps}>
          <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
            <ToastProvider>
              <DraftRoom draftId="d1" dismissedAt={TOUR_DISMISSED} />
            </ToastProvider>
          </ChatRoomDepsProvider>
        </DraftRoomDepsProvider>
      ),
      ({ recoverableErrors, consoleErrors }) => {
        expect(recoverableErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
      },
    );
  });

  // Trivially true since the founder directive 2026-08-26 (room-product pass) removed the
  // chat's own matchMedia read entirely (`chatOpen` is a plain `useState(false)`) — kept as a
  // regression guard against a lazy useState initializer reaching for `matchMedia` (or any
  // other render-time global read) ever coming back.
  it("never reads matchMedia during render — the mount effect is the one sanctioned reader", () => {
    const source = readFileSync(join(process.cwd(), "src/draft-room/components/draft-room.tsx"), "utf8");
    expect(source).not.toMatch(/useState[^\n]*matchMedia/);
    expect(source).not.toMatch(/useState<boolean>\(\(\) =>/);
  });

  it("mounts the practice banner INSIDE the room viewport frame — a band above an h-dvh frame scrolls the page (founder screenshot)", async () => {
    const fixture = fixtureDeps();
    fixture.mock = MOCK_ROOM;
    mount(fixture);
    await waitFor(() => expect(screen.getByTestId("practice-banner")).toBeInTheDocument());
    const viewport = screen.getByTestId("room-viewport");
    expect(viewport.className).toContain("lg:h-dvh");
    expect(viewport.className).toContain("lg:overflow-hidden");
    expect(viewport.contains(screen.getByTestId("practice-banner"))).toBe(true);
    expect(viewport.contains(screen.getByTestId("quilt-room"))).toBe(true);
  });
});

/**
 * THE FINALE (2026-09-04, `docs/superpowers/specs/2026-09-04-draft-finale-design.md`): the
 * completion moment and what follows it. Every case here drives the live room through the
 * `in_progress → complete` TRANSITION over the stream — the one gate the detector fires on —
 * except the guards, which prove a draft already complete at load stays exactly as it was.
 */
describe("DraftRoom — the finale", () => {
  const { momentMs, resultsRetryMs, resultsRetryCount } = DRAFT_ROOM_CONFIG.finale;

  /** The stream frame that finishes the draft: the same view, phase flipped, one sequence on. */
  const COMPLETE_VIEW = { ...SNAKE_VIEW, phase: "complete" as const, sequence: 2, onClockTeamId: null, deadlineAt: null };

  async function mountLive(fixture: FixtureDeps) {
    mount(fixture);
    await awaitSources(fixture);
    await openPool();
    expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();
  }

  /** Flips the room to complete over the stream, under fake timers, and asserts the beat. */
  function finish(fixture: FixtureDeps): void {
    vi.useFakeTimers();
    act(() => emit(fixture, "draft.status", { draftId: "d1", clock: clockOf(COMPLETE_VIEW), phase: "complete" }));
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays the beat on a mock's completion, then refetches and swaps to the debrief in place", async () => {
    const fixture = fixtureDeps();
    fixture.mock = MOCK_ROOM;
    await mountLive(fixture);

    // The draft finishes on the stream; settlement means the NEXT snapshot carries results.
    fixture.view = COMPLETE_VIEW;
    fixture.mock = { ...MOCK_ROOM, results: MOCK_RESULTS_INFO };
    finish(fixture);

    // The beat: the banner in the strip's place, the celebration, the board still the room —
    // and NOT the debrief yet, even though the server already has it.
    expect(screen.getByTestId("finale-banner")).toHaveTextContent("The draft is in the books.");
    expect(screen.getByTestId("finale-celebration")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "The debrief" })).not.toBeInTheDocument();

    // The beat ends, the refetch lands, and the debrief takes the room in place — no reload.
    await advance(momentMs);
    await advance(0);
    await advance(0);
    expect(screen.getByRole("heading", { name: "The debrief" })).toBeInTheDocument();
    expect(screen.queryByTestId("finale-banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /available players/i })).not.toBeInTheDocument();
  });

  // Fix round 1, HIGH 1: one combined resync (the stream's onOpen refetch after a dropped
  // connection) can deliver the phase flip and `mock.results` in a single state update. This
  // test guards the WIRING of that path — combined update in, beat showing and debrief absent
  // once settled, then the in-place swap after the beat. It cannot observe the single-frame
  // debrief flash the bug produced (act() flushes effects before any assertion runs in jsdom),
  // so the frame-level no-flash guarantee is pinned ONLY by the hook's commit-logging probe
  // test in use-draft-finale.test.tsx.
  it("wears the beat, not the debrief, when one resync carries the flip and the results together", async () => {
    const fixture = fixtureDeps();
    fixture.mock = MOCK_ROOM;
    await mountLive(fixture);

    fixture.view = COMPLETE_VIEW;
    fixture.mock = { ...MOCK_ROOM, results: MOCK_RESULTS_INFO };
    vi.useFakeTimers();
    await act(async () => {
      emit(fixture, "open");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("finale-banner")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "The debrief" })).not.toBeInTheDocument();

    // After the beat the debrief takes the room with no further fetch needed.
    await advance(momentMs);
    await advance(0);
    expect(screen.getByRole("heading", { name: "The debrief" })).toBeInTheDocument();
  });

  it("retries when the refetch races settlement, says so quietly, then offers the manual door — which opens the debrief", async () => {
    const fixture = fixtureDeps();
    fixture.mock = MOCK_ROOM;
    await mountLive(fixture);

    // The draft finishes but settlement never lands: every refetch answers without results.
    fixture.view = COMPLETE_VIEW;
    finish(fixture);
    await advance(momentMs);

    // Walk the bounded cycles: the quiet line appears along the way, then the manual door —
    // and the room never spins (no progressbar, ever).
    let sawPreparing = false;
    for (let step = 0; step < (resultsRetryCount + 2) * 4; step++) {
      await advance(resultsRetryMs);
      sawPreparing ||= screen.queryByTestId("finale-preparing") !== null;
    }
    expect(sawPreparing).toBe(true);
    expect(screen.getByRole("button", { name: "See your debrief" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();

    // Settlement finally lands; the manual door refetches its way to the debrief.
    fixture.mock = { ...MOCK_ROOM, results: MOCK_RESULTS_INFO };
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "See your debrief" }));
    });
    await advance(0);
    await advance(0);
    expect(screen.getByRole("heading", { name: "The debrief" })).toBeInTheDocument();
  });

  it("gives a real league the completion panel after the beat — one verb home, and a dismiss back to the board", async () => {
    const fixture = fixtureDeps();
    await mountLive(fixture);

    fixture.view = COMPLETE_VIEW;
    finish(fixture);
    expect(screen.getByTestId("finale-banner")).toHaveTextContent("The draft is in the books.");
    expect(screen.queryByTestId("finale-panel")).not.toBeInTheDocument();

    await advance(momentMs);
    const panel = screen.getByTestId("finale-panel");
    expect(panel).toHaveTextContent("The draft is in the books.");
    expect(screen.getByRole("link", { name: "Open your league room" })).toHaveAttribute("href", "/app/leagues/l1");
    // No refetch machinery for a real draft: the room asked for its snapshot once, at mount.
    expect(fixture.calls.filter((call) => call === "GET /api/drafts/d1")).toHaveLength(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stay on the board" }));
    });
    expect(screen.queryByTestId("finale-panel")).not.toBeInTheDocument();
    // The completed board stays browsable.
    expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();
  });

  it("plays the same beat and panel over the auction shell — the overlay rides the viewport, not the format", async () => {
    const fixture = fixtureDeps(AUCTION_VIEW);
    mount(fixture);
    await waitFor(() => expect(fixture.sources).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("room-viewport")).toBeInTheDocument());

    const completeAuction = { ...AUCTION_VIEW, phase: "complete" as const, sequence: 2, onClockTeamId: null, deadlineAt: null };
    fixture.view = completeAuction;
    vi.useFakeTimers();
    act(() => fixture.sources[0]!.emit("draft.status", { draftId: "d1", clock: clockOf(completeAuction), phase: "complete" }));

    expect(screen.getByTestId("finale-banner")).toHaveTextContent("The draft is in the books.");
    await advance(momentMs);
    expect(screen.getByTestId("finale-panel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open your league room" })).toHaveAttribute("href", "/app/leagues/l1");
  });

  it("gives a real draft already complete at load no fanfare at all — no beat, no panel, no refetch", async () => {
    const fixture = fixtureDeps({ ...SNAKE_VIEW, phase: "complete", onClockTeamId: null, deadlineAt: null });
    await mountLive(fixture);
    expect(screen.queryByTestId("finale-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("finale-panel")).not.toBeInTheDocument();
    expect(fixture.calls.filter((call) => call === "GET /api/drafts/d1")).toHaveLength(1);
  });

  it("gives a mock already complete at load the debrief directly, with no beat and no retry chrome", async () => {
    const fixture = fixtureDeps({ ...SNAKE_VIEW, phase: "complete", onClockTeamId: null, deadlineAt: null });
    fixture.mock = { ...MOCK_ROOM, results: MOCK_RESULTS_INFO };
    mount(fixture);
    await waitFor(() => expect(screen.getByRole("heading", { name: "The debrief" })).toBeInTheDocument());
    expect(screen.queryByTestId("finale-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("finale-preparing")).not.toBeInTheDocument();
    expect(fixture.calls.filter((call) => call === "GET /api/drafts/d1")).toHaveLength(1);
  });
});
