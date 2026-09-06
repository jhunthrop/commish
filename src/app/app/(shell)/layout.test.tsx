import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import { NoticesProvider } from "@/components/app-shell/notices-provider";

// Route-level: the layout's own gate and its one call to `shellData` — every read is mocked, the
// same discipline `admin/queue/page.test.tsx` uses for `withAdmin`'s own Server Component page.
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
// `createSheetDefaults` is pure config with no IO, so the real one stays; only the DB-backed
// `shellData` read is stubbed.
vi.mock("@/components/app-shell/shell-data", async (importActual) => ({
  ...(await importActual<typeof import("@/components/app-shell/shell-data")>()),
  shellData: vi.fn(),
}));

import { requireCurrentUser } from "@/lib/auth/current-user";
import { shellData } from "@/components/app-shell/shell-data";
import ShellLayout from "./layout";

const USER = {
  id: "u_ada",
  email: "ada@test.local",
  displayName: "Ada Lovelace",
  experienceTier: "beginner" as const,
  avatarUrl: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  isAdmin: false,
};

async function renderLayout() {
  vi.mocked(requireCurrentUser).mockResolvedValue(USER);
  vi.mocked(shellData).mockResolvedValue({ rail: [], liveState: null });
  const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
  const element = await ShellLayout({ children: <p>Page content</p> });
  return render(
    <AccountRoomDepsProvider deps={fixture.deps}>
      <NoticesProvider>{element}</NoticesProvider>
    </AccountRoomDepsProvider>,
  );
}

describe("the (shell) route group's layout", () => {
  it("calls shellData exactly once and renders AppShell around the page", async () => {
    const { getByText, getAllByRole } = await renderLayout();
    expect(shellData).toHaveBeenCalledTimes(1);
    expect(getByText("Page content")).toBeInTheDocument();
    expect(getAllByRole("banner")).toHaveLength(1);
    expect(getAllByRole("main")).toHaveLength(1);
  });

  // Task 17, Step 4: a brand-new manager's first arrival renders `AppHome`'s first-run branch
  // INSIDE this layout (ruling 8, as amended) — the page no longer renders its own shell, so the
  // rail's zero-league state has to be proven at THIS boundary, with `shellData` handing back the
  // same `rail: []` a zero-league manager's real read produces. The rail is `LeagueRail`'s own
  // component (Task 2 owns it); this asserts it never renders as a broken row of nothing — one
  // real, working control, named for what it does, and no league tile at all.
  it("renders the rail's join-or-create control alone, named for what it does, when the manager has zero leagues", async () => {
    const { getByRole, getAllByRole } = await renderLayout();
    const rail = getByRole("navigation", { name: "Your leagues" });
    const railLinks = getAllByRole("link").filter((link) => rail.contains(link));
    expect(railLinks).toHaveLength(1);
    // The rail redesign (2026-09-03): the + row's words are the blueprint's own.
    expect(railLinks[0]).toHaveAccessibleName("Find or start a league");
  });
});
