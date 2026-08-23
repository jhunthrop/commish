import { describe, it, expect } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { AccountRoomDepsProvider, type AccountRoomDeps } from "@/account-room/hooks/deps";
import { NoticeInbox } from "@/account-room/components/notice-inbox";
import { NoticesProvider } from "./notices-provider";

/** One injected `fetchJson` double, recording every call so a test can assert on how many times
 *  `GET /api/notices` actually went out — the same shape `fixtureAccountDeps` uses, kept local
 *  here because this file's fixture also needs `openEventSource`'s OWN call count, which
 *  `fixtureAccountDeps` has no reason to expose (every other account-room test renders exactly
 *  one component per case, so "was `openEventSource` called more than once" is never a question
 *  worth asking there). */
function createFetchJsonDouble(initialResponse: unknown) {
  const calls: string[] = [];
  let response = initialResponse;
  const fetchJson: AccountRoomDeps["fetchJson"] = async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return { json: async () => response } as unknown as Response;
  };
  return {
    fetchJson,
    calls,
    callsTo: (url: string) => calls.filter((call) => call === `GET ${url}`),
    setResponse: (next: unknown): void => {
      response = next;
    },
  };
}

/** One injected `openEventSource` double. Tracks how many TIMES the deps' own factory was
 *  invoked (the thing `subscribeLeagueStream`'s refcount idiom would otherwise hide from a
 *  test double) and how many of the sources it handed out were later `close()`d — the two
 *  numbers this file's tests are actually about. */
function createEventSourceDouble() {
  let opens = 0;
  let closes = 0;
  const listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  const openEventSource: AccountRoomDeps["openEventSource"] = () => {
    opens += 1;
    return {
      addEventListener: (type, listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      close: () => {
        closes += 1;
      },
    };
  };
  return {
    openEventSource,
    get opens() {
      return opens;
    },
    get closes() {
      return closes;
    },
    emit: (type: string, payload: unknown): void => {
      for (const listener of listeners.get(type) ?? []) listener({ data: JSON.stringify({ type, payload }) } as MessageEvent);
    },
  };
}

const EMPTY_PAGE = { ok: true, data: { notices: [], unreadCount: 0 } };

/** Every "page" this file navigates between. Only the ones with a header render `NoticeInbox` —
 *  the thing that actually subscribes — mirroring the real render tree: the draft room and the
 *  landing page render no `TopBar` at all (ruling 10's whole point). */
function HomePage() {
  return <NoticeInbox />;
}
function LeaguePage() {
  return <NoticeInbox />;
}
function TradesPage() {
  return <NoticeInbox />;
}
function DraftPage() {
  return <div>the draft room, no header, no inbox</div>;
}
function LandingPage() {
  return <div>a signed-out visitor landing page</div>;
}

function renderApp(deps: AccountRoomDeps, page: React.ReactElement) {
  return render(
    <AccountRoomDepsProvider deps={deps}>
      <NoticesProvider>{page}</NoticesProvider>
    </AccountRoomDepsProvider>,
  );
}

describe("NoticesProvider", () => {
  it("renders no UI of its own — the draft room's no-header contract depends on this", () => {
    const fetchDouble = createFetchJsonDouble(EMPTY_PAGE);
    const sse = createEventSourceDouble();
    const deps: AccountRoomDeps = { fetchJson: fetchDouble.fetchJson, openEventSource: sse.openEventSource };
    const { container } = render(
      <AccountRoomDepsProvider deps={deps}>
        <NoticesProvider>
          <p>only this</p>
        </NoticesProvider>
      </AccountRoomDepsProvider>,
    );
    expect(container.innerHTML).toBe("<p>only this</p>");
  });

  it("fetches once across three navigations, not six times", async () => {
    const fetchDouble = createFetchJsonDouble(EMPTY_PAGE);
    const sse = createEventSourceDouble();
    const deps: AccountRoomDeps = { fetchJson: fetchDouble.fetchJson, openEventSource: sse.openEventSource };

    const { rerender } = renderApp(deps, <HomePage />);
    await waitFor(() => expect(fetchDouble.callsTo("/api/notices")).toHaveLength(1));

    rerender(
      <AccountRoomDepsProvider deps={deps}>
        <NoticesProvider>
          <LeaguePage />
        </NoticesProvider>
      </AccountRoomDepsProvider>,
    );
    rerender(
      <AccountRoomDepsProvider deps={deps}>
        <NoticesProvider>
          <TradesPage />
        </NoticesProvider>
      </AccountRoomDepsProvider>,
    );

    expect(fetchDouble.callsTo("/api/notices")).toHaveLength(1);
  });

  it("opens exactly one EventSource and never closes it on navigation", async () => {
    const fetchDouble = createFetchJsonDouble(EMPTY_PAGE);
    const sse = createEventSourceDouble();
    const deps: AccountRoomDeps = { fetchJson: fetchDouble.fetchJson, openEventSource: sse.openEventSource };

    const { rerender } = renderApp(deps, <HomePage />);
    await waitFor(() => expect(sse.opens).toBe(1));

    rerender(
      <AccountRoomDepsProvider deps={deps}>
        <NoticesProvider>
          <TradesPage />
        </NoticesProvider>
      </AccountRoomDepsProvider>,
    );

    expect(sse.opens).toBe(1);
    expect(sse.closes).toBe(0);
  });

  it("does not fetch anything until something actually renders the inbox", async () => {
    const fetchDouble = createFetchJsonDouble(EMPTY_PAGE);
    const sse = createEventSourceDouble();
    const deps: AccountRoomDeps = { fetchJson: fetchDouble.fetchJson, openEventSource: sse.openEventSource };

    renderApp(deps, <LandingPage />);
    // Nothing under `LandingPage` ever calls `useNotices()`, so there is no subscriber whose
    // mount effect could kick off the fetch — give any stray microtask a turn and confirm it
    // never arrives, rather than asserting on a synchronous snapshot alone.
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchDouble.calls).toHaveLength(0);
    expect(sse.opens).toBe(0);
  });

  it("keeps the notices it already has when the inbox unmounts and remounts", async () => {
    const fetchDouble = createFetchJsonDouble(EMPTY_PAGE);
    const sse = createEventSourceDouble();
    const deps: AccountRoomDeps = { fetchJson: fetchDouble.fetchJson, openEventSource: sse.openEventSource };

    const { rerender } = renderApp(deps, <HomePage />);
    await waitFor(() => expect(fetchDouble.callsTo("/api/notices")).toHaveLength(1));

    // Into the draft room — no `NoticeInbox`, so the one subscriber drops to zero.
    rerender(
      <AccountRoomDepsProvider deps={deps}>
        <NoticesProvider>
          <DraftPage />
        </NoticesProvider>
      </AccountRoomDepsProvider>,
    );
    // Back out to a page with a header again.
    rerender(
      <AccountRoomDepsProvider deps={deps}>
        <NoticesProvider>
          <LeaguePage />
        </NoticesProvider>
      </AccountRoomDepsProvider>,
    );

    expect(fetchDouble.callsTo("/api/notices")).toHaveLength(1);
  });

  it("still refetches on a notice.created frame, because the frame carries no words", async () => {
    const fetchDouble = createFetchJsonDouble(EMPTY_PAGE);
    const sse = createEventSourceDouble();
    const deps: AccountRoomDeps = { fetchJson: fetchDouble.fetchJson, openEventSource: sse.openEventSource };

    renderApp(deps, <HomePage />);
    await waitFor(() => expect(fetchDouble.callsTo("/api/notices")).toHaveLength(1));

    act(() => sse.emit("notice.created", { noticeId: "n_1", noticeType: "trade_executed" }));

    await waitFor(() => expect(fetchDouble.callsTo("/api/notices")).toHaveLength(2));
  });
});
