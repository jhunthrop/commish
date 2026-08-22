import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { NoticesProvider } from "@/components/app-shell/notices-provider";
import type { NoticesBody } from "../contract";
import { fixtureAccountDeps } from "../test-fixtures";
import { AccountRoomDepsProvider, type AccountRoomDeps } from "./deps";
import { useNotices } from "./use-notices";

/** No `NoticesProvider` anywhere in this wrapper — every case below (except the last describe
 *  block) exercises `useNotices`' STANDALONE FALLBACK, the pre-Task-9 implementation kept
 *  verbatim for a caller with no provider ancestor. That is deliberate, not an oversight: most
 *  of the product's own tests (page-level tests under `src/app/app/**`, `AppHeader`'s own test)
 *  wrap only `AccountRoomDepsProvider`, and this file is what proves that fallback still behaves
 *  exactly as `useNotices` always did. The provider-backed path — the one `src/app/layout.tsx`
 *  actually renders in production — has its own lifetime tests in `notices-provider.test.tsx`;
 *  the last describe block here covers only that `useNotices()` correctly DELEGATES to a
 *  `NoticesProvider` ancestor when one is present, rather than fetching a second, competing copy
 *  of the same state. */
function wrapper(deps: AccountRoomDeps) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <AccountRoomDepsProvider deps={deps}>{children}</AccountRoomDepsProvider>;
  };
}

function wrapperWithProvider(deps: AccountRoomDeps) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <AccountRoomDepsProvider deps={deps}>
        <NoticesProvider>{children}</NoticesProvider>
      </AccountRoomDepsProvider>
    );
  };
}

const NOTICE_A: NoticesBody["notices"][number] = {
  id: "n1",
  noticeType: "draft_auto_picked",
  title: "We drafted for you",
  body: "The clock ran out on pick 24, so we used your queue and drafted Bijan Robinson (RB).",
  quote: null,
  leagueId: "l1",
  createdAt: "2026-08-18T20:00:00.000Z",
  readAt: null,
};

const NOTICE_B: NoticesBody["notices"][number] = { ...NOTICE_A, id: "n2", title: "Second notice", readAt: "2026-08-18T20:05:00.000Z" };

const PAGE: NoticesBody = { notices: [NOTICE_A], unreadCount: 1 };

describe("useNotices", () => {
  it("loads the caller's own page on mount and derives the unread count from it", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: PAGE });
    const { result } = renderHook(() => useNotices(), { wrapper: wrapper(fixture.deps) });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.notices).toEqual([NOTICE_A]);
    expect(result.current.unreadCount).toBe(1);
    expect(fixture.calls).toEqual(["GET /api/notices"]);
  });

  it("says so plainly when the fetch fails", async () => {
    const fixture = fixtureAccountDeps({ ok: false, error: "Not signed in." });
    const { result } = renderHook(() => useNotices(), { wrapper: wrapper(fixture.deps) });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Not signed in.");
  });

  it("refetches — never folds — on a notice.created frame, since the frame itself carries no title or body", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    const { result } = renderHook(() => useNotices(), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.notices).toEqual([]);

    fixture.response = { ok: true, data: PAGE };
    act(() => fixture.emit("notice.created", { noticeId: NOTICE_A.id, noticeType: NOTICE_A.noticeType }));

    await waitFor(() => expect(result.current.notices).toEqual([NOTICE_A]));
    expect(fixture.calls).toEqual(["GET /api/notices", "GET /api/notices"]);
  });

  it("refetches on the stream's own open, to cover the gap before its listeners attached", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    const { result } = renderHook(() => useNotices(), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    fixture.response = { ok: true, data: PAGE };
    act(() => fixture.fire("open"));

    await waitFor(() => expect(result.current.notices).toEqual([NOTICE_A]));
  });

  it("keeps working when the stream never connects — the mount fetch is not the stream's job", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: PAGE });
    const { result } = renderHook(() => useNotices(), { wrapper: wrapper(fixture.deps) });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.notices).toEqual([NOTICE_A]);
    // No `fire`/`emit` call anywhere in this test — the stream simply never spoke, and the
    // hook's state is unaffected.
  });

  it("marks the given ids read on the server and locally, and is a no-op for an empty list", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [NOTICE_A, NOTICE_B], unreadCount: 1 } });
    const { result } = renderHook(() => useNotices(), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.unreadCount).toBe(1);

    await act(async () => {
      await result.current.markRead([]);
    });
    expect(fixture.calls).toEqual(["GET /api/notices"]); // the empty call sent nothing

    fixture.response = { ok: true, data: { stamped: 1 } };
    await act(async () => {
      await result.current.markRead([NOTICE_A.id]);
    });

    expect(fixture.calls).toEqual(["GET /api/notices", "POST /api/notices/read"]);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.notices.find((notice) => notice.id === NOTICE_A.id)?.readAt).not.toBeNull();
  });

  // Fix round 1, FIX 1: three uncoordinated writers (the mount fetch, the `open`-triggered
  // refetch, the `notice.created`-triggered refetch) plus `markRead`'s own optimistic write, all
  // racing to be the last one to call `setNotices`. This forces the exact interleaving the
  // `generationRef` guard exists for: a refetch already in flight when `markRead` applies its
  // optimistic update, resolving AFTER it with a snapshot from before the read landed
  // server-side. Mirrors `useLiveScores`'s "keeps a fresher live frame's values..." test and
  // `useLeagueChat`'s "keeps the newest refresh..." test — the same idiom, generalized to a
  // refetch racing a local write rather than two refetches racing each other.
  it("keeps an optimistic mark-read when a slower, earlier-started refetch resolves after it", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } }, { deferred: true });
    const { result } = renderHook(() => useNotices(), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(fixture.pending()).toBe(1)); // the mount fetch, in flight

    // Let the mount fetch land right away, seeded with one unread notice — otherwise there is
    // nothing for `markRead` to act on.
    await act(async () => {
      await fixture.settle(0, { ok: true, data: { notices: [NOTICE_A], unreadCount: 1 } });
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // A second refetch starts — the stream's own `open` — and stays in flight...
    act(() => fixture.fire("open"));
    await waitFor(() => expect(fixture.pending()).toBe(1)); // the open-triggered refetch

    // ...while the reader marks the notice read. `markRead`'s own POST is a THIRD call,
    // deliberately settled right away so the optimistic update lands well before the slow
    // refetch above does.
    let markReadDone!: Promise<void>;
    act(() => {
      markReadDone = result.current.markRead([NOTICE_A.id]);
    });
    await waitFor(() => expect(fixture.pending()).toBe(2)); // the open refetch + the read POST
    await act(async () => {
      await fixture.settle(2, { ok: true, data: { stamped: 1 } });
    });
    await markReadDone;
    expect(result.current.notices.find((notice) => notice.id === NOTICE_A.id)?.readAt).not.toBeNull();

    // NOW the slow, earlier-started refetch finally resolves — carrying the snapshot it was
    // issued to fetch, from BEFORE the mark-read landed server-side, so it still shows the
    // notice unread. Without the generation guard this clobbers the optimistic read; with it,
    // the stale response is refused.
    await act(async () => {
      await fixture.settle(1, { ok: true, data: { notices: [NOTICE_A], unreadCount: 1 } });
    });

    expect(result.current.notices.find((notice) => notice.id === NOTICE_A.id)?.readAt).not.toBeNull();
    expect(result.current.unreadCount).toBe(0);
  });
});

// Plan D Task 9: the state moved into `NoticesProvider`; `useNotices()` becomes a `useContext`
// read plus a subscribe effect when a provider ancestor exists. The provider's own lifetime
// guarantees (one fetch across many navigations, one stream never closed) are
// `notices-provider.test.tsx`'s job — this describe block only proves the hook reads THROUGH
// the provider rather than falling back to its own standalone fetch when one is present.
describe("useNotices, wrapped in a NoticesProvider", () => {
  it("reads the provider's shared state instead of fetching a second copy of its own", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: PAGE });
    const { result } = renderHook(() => useNotices(), { wrapper: wrapperWithProvider(fixture.deps) });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.notices).toEqual([NOTICE_A]);
    expect(fixture.calls).toEqual(["GET /api/notices"]);
  });

  it("stops counting as a subscriber on unmount, without refetching or reopening the stream", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: PAGE });
    const { result, unmount } = renderHook(() => useNotices(), { wrapper: wrapperWithProvider(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    unmount();

    expect(fixture.calls).toEqual(["GET /api/notices"]);
  });
});
