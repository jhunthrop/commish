import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";

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

async function renderPage() {
  const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
  const page = await AdminQueuePage();
  return render(<AccountRoomDepsProvider deps={fixture.deps}>{page}</AccountRoomDepsProvider>);
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue(OPERATOR);
  vi.mocked(listPendingFlags).mockReset();
});

describe("AdminQueuePage — the gate", () => {
  it("404s a signed-in non-operator, never 403", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not an operator."));
    await expect(AdminQueuePage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(vi.mocked(listPendingFlags)).not.toHaveBeenCalled();
  });
});

describe("AdminQueuePage — the two states", () => {
  it("shows the clear-queue empty state, with a way forward, when nothing is open", async () => {
    vi.mocked(listPendingFlags).mockResolvedValue({ rows: [], nextBefore: null });
    await renderPage();
    expect(await screen.findByText("The queue is clear.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your leagues" })).toHaveAttribute("href", "/app");
  });

  it("lists open flags oldest first, each linking to its own detail page", async () => {
    vi.mocked(listPendingFlags).mockResolvedValue({
      rows: [
        { flagId: "flag_old", icon: "alert-triangle", question: "A member reported a review", about: "A review by Ada", raisedAt: "2026-08-01T00:00:00.000Z" },
        { flagId: "flag_new", icon: "users", question: "The platform flagged two accounts that may be the same person", about: "Ada and Bob", raisedAt: "2026-08-02T00:00:00.000Z" },
      ],
      nextBefore: null,
    });
    await renderPage();

    const oldLink = await screen.findByRole("link", { name: /A member reported a review/ });
    const newLink = screen.getByRole("link", { name: /The platform flagged two accounts/ });
    expect(oldLink).toHaveAttribute("href", "/app/admin/queue/flag_old");
    expect(newLink).toHaveAttribute("href", "/app/admin/queue/flag_new");
    expect(screen.getByText("A review by Ada")).toBeInTheDocument();
    expect(screen.getByText("Ada and Bob")).toBeInTheDocument();
  });
});
