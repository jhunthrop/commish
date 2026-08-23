import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import { NoticesProvider } from "@/components/app-shell/notices-provider";

// Route-level: proves the page's own gate and its two states without a real Postgres
// connection — every read the page makes is mocked, and `notFound()` is the real
// `next/navigation` implementation (a plain synchronous throw with a
// `NEXT_HTTP_ERROR_FALLBACK;404` digest), same discipline `activity/page.test.tsx` uses.
vi.mock("@/lib/auth/current-user", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/integrity-service/flags", () => ({ listPendingFlags: vi.fn() }));

import { requireAdmin } from "@/lib/auth/current-user";
import { listPendingFlags } from "@/integrity-service/flags";
import AdminQueuePage from "./page";

const OPERATOR = { id: "u_op", email: "u_op@test.local", displayName: "Op Erator", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: true };

function callPage(searchParams: Record<string, string | undefined> = {}) {
  return AdminQueuePage({ searchParams: Promise.resolve(searchParams) });
}

async function renderPage(searchParams?: Record<string, string | undefined>) {
  const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
  const page = await callPage(searchParams);
  return render(
    <AccountRoomDepsProvider deps={fixture.deps}>
      <NoticesProvider>{page}</NoticesProvider>
    </AccountRoomDepsProvider>,
  );
}

const TWO_ROWS = [
  { flagId: "flag_old", icon: "alert-triangle" as const, question: "A member reported a review", about: "A review by Ada", raisedAt: "2026-08-01T00:00:00.000Z" },
  { flagId: "flag_new", icon: "users" as const, question: "The platform flagged two accounts that may be the same person", about: "Ada and Bob", raisedAt: "2026-08-02T00:00:00.000Z" },
];

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue(OPERATOR);
  vi.mocked(listPendingFlags).mockReset();
});

describe("AdminQueuePage — the gate", () => {
  it("404s a signed-in non-operator, never 403", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not an operator."));
    await expect(callPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(vi.mocked(listPendingFlags)).not.toHaveBeenCalled();
  });
});

describe("AdminQueuePage — the two states", () => {
  it("shows the clear-queue empty state, with a way forward, when nothing is open, in both themes, axe-clean", async () => {
    vi.mocked(listPendingFlags).mockResolvedValue({ rows: [], nextBefore: null });
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    const page = await callPage();
    await inBothThemes(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticesProvider>{page}</NoticesProvider>
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        expect(await screen.findByText("The queue is clear.")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Go to your leagues" })).toHaveAttribute("href", "/app");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("lists open flags oldest first, each linking to its own detail page, in both themes, axe-clean", async () => {
    vi.mocked(listPendingFlags).mockResolvedValue({ rows: TWO_ROWS, nextBefore: null });
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    const page = await callPage();
    await inBothThemes(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticesProvider>{page}</NoticesProvider>
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        const oldLink = await screen.findByRole("link", { name: /A member reported a review/ });
        const newLink = screen.getByRole("link", { name: /The platform flagged two accounts/ });
        expect(oldLink).toHaveAttribute("href", "/app/admin/queue/flag_old");
        expect(newLink).toHaveAttribute("href", "/app/admin/queue/flag_new");
        expect(screen.getByText("A review by Ada")).toBeInTheDocument();
        expect(screen.getByText("Ada and Bob")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});

describe("AdminQueuePage — pagination (fix round 1, FIX 3)", () => {
  it("passes the ?before= query param through to listPendingFlags, decoded", async () => {
    vi.mocked(listPendingFlags).mockResolvedValue({ rows: [], nextBefore: null });
    await callPage({ before: "2026-08-02T00:00:00.000Z|flag_new" });
    expect(vi.mocked(listPendingFlags)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ before: { raisedAt: "2026-08-02T00:00:00.000Z", id: "flag_new" } }),
    );
  });

  it("treats a malformed cursor as no cursor at all, rather than crashing", async () => {
    vi.mocked(listPendingFlags).mockResolvedValue({ rows: [], nextBefore: null });
    await callPage({ before: "not-a-real-cursor" });
    expect(vi.mocked(listPendingFlags)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ before: undefined }));
  });

  it("renders a Load more link carrying the next cursor when a page is full", async () => {
    vi.mocked(listPendingFlags).mockResolvedValue({ rows: TWO_ROWS, nextBefore: { raisedAt: "2026-08-02T00:00:00.000Z", id: "flag_new" } });
    await renderPage();
    const link = await screen.findByRole("link", { name: "Load more" });
    expect(link).toHaveAttribute("href", `/app/admin/queue?before=${encodeURIComponent("2026-08-02T00:00:00.000Z|flag_new")}`);
  });

  it("never renders Load more once the queue has no further page", async () => {
    vi.mocked(listPendingFlags).mockResolvedValue({ rows: TWO_ROWS, nextBefore: null });
    await renderPage();
    await screen.findByText("A review by Ada");
    expect(screen.queryByRole("link", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("does not show the clear-queue empty state when a page came back empty but a cursor remains", async () => {
    // Pathological today (every row currently renders something), but the guard is cheap and
    // the same one `ActivityFeed` holds to for the identical reason.
    vi.mocked(listPendingFlags).mockResolvedValue({ rows: [], nextBefore: { raisedAt: "2026-08-02T00:00:00.000Z", id: "flag_new" } });
    await renderPage();
    expect(screen.queryByText("The queue is clear.")).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Load more" })).toBeInTheDocument();
  });
});
