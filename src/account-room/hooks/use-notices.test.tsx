import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { NoticesBody } from "../contract";
import { fixtureAccountDeps } from "../test-fixtures";
import { AccountRoomDepsProvider, type AccountRoomDeps } from "./deps";
import { useNotices } from "./use-notices";

function wrapper(deps: AccountRoomDeps) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <AccountRoomDepsProvider deps={deps}>{children}</AccountRoomDepsProvider>;
  };
}

const NOTICE_A: NoticesBody["notices"][number] = {
  id: "n1",
  noticeType: "draft_auto_picked",
  title: "We drafted for you",
  body: "The clock ran out on pick 24, so we used your queue and drafted Bijan Robinson (RB).",
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
});
