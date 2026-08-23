import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import { NoticesProvider } from "@/components/app-shell/notices-provider";

// Route-level: the layout's own gate and its one call to `shellData` — every read is mocked, the
// same discipline `admin/queue/page.test.tsx` uses for `withAdmin`'s own Server Component page.
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/components/app-shell/shell-data", () => ({ shellData: vi.fn() }));

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
});
