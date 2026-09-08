import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import { NoticesProvider } from "./notices-provider";
import { TopBar } from "./top-bar";

// `SiteSearch` (site search round) reads `usePathname()` for the league its player links belong
// to and `useRouter()` to open a chosen result — both throw outside a mounted App Router, so
// they are stubbed the same way `app-shell.test.tsx` stubs them. `site-search.test.tsx` is where
// the search itself is exercised; this file only proves the header carries it.
vi.mock("next/navigation", () => ({
  usePathname: () => "/app/wallet",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// `TopBar` renders `NoticeInbox` (Task 10), a `"use client"` component whose `useNotices()`
// (Plan D Task 9) requires a `NoticesProvider` ancestor — it throws without one, no silent
// standalone fallback. Every case below wraps `TopBar` in `AccountRoomDepsProvider` AND
// `NoticesProvider` with a fixture so no case ever reaches the real `fetch` — the same
// no-module-mocks, no-real-network discipline every other account-room test already follows.
function renderTopBar(displayName: string, avatar: string | null, isAdmin = false) {
  const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
  return render(
    <AccountRoomDepsProvider deps={fixture.deps}>
      <NoticesProvider>
        <TopBar displayName={displayName} avatar={avatar} isAdmin={isAdmin} />
      </NoticesProvider>
    </AccountRoomDepsProvider>,
  );
}

describe("TopBar", () => {
  it("names the signed-in user and links to their profile, with their avatar, in both themes, axe-clean", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticesProvider>
          <TopBar displayName="Ada Lovelace" avatar="preset:shield" isAdmin={false} />
        </NoticesProvider>
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        const link = screen.getByRole("link", { name: /Ada Lovelace/ });
        expect(link).toHaveAttribute("href", "/app/profile");
        expect(container.querySelector("svg")).not.toBeNull();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("still renders a working profile link and initials fallback with no avatar chosen", () => {
    renderTopBar("Ada Lovelace", null);
    expect(screen.getByRole("link", { name: /Ada Lovelace/ })).toHaveAttribute("href", "/app/profile");
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("keeps the wordmark link to /app and a working sign-out form", () => {
    renderTopBar("Ada Lovelace", null);
    expect(screen.getByRole("link", { name: "Commish" })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("renders the notice inbox trigger left of the profile link", async () => {
    renderTopBar("Ada Lovelace", null);
    const inbox = await screen.findByRole("button", { name: "Notices" });
    const profile = screen.getByRole("link", { name: /Ada Lovelace/ });
    // DOM order IS visual order here — both are plain flow siblings in the same flex row, no
    // `order-*` utility on either.
    expect(inbox.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no queue link to an ordinary member — the queue is operator-only (Task 5)", () => {
    renderTopBar("Ada Lovelace", null, false);
    expect(screen.queryByRole("link", { name: /Queue/ })).not.toBeInTheDocument();
  });

  it("links an operator to the dispute queue, in both themes, axe-clean", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticesProvider>
          <TopBar displayName="Ada Lovelace" avatar={null} isAdmin={true} />
        </NoticesProvider>
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByRole("link", { name: /Queue/ })).toHaveAttribute("href", "/app/admin/queue");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("stops being centered — no mx-auto/max-w wrapper, full width for AppShell to span", () => {
    const { container } = renderTopBar("Ada Lovelace", null);
    const header = container.querySelector("header")!;
    expect(header.innerHTML).not.toMatch(/max-w-4xl/);
  });

  it("accepts a null liveState without rendering anything for it (ruling 12)", () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    const { container } = render(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticesProvider>
          <TopBar displayName="Ada Lovelace" avatar={null} isAdmin={false} liveState={null} />
        </NoticesProvider>
      </AccountRoomDepsProvider>,
    );
    expect(container.querySelector("header")).toBeInTheDocument();
    expect(screen.queryByText(/games live/i)).not.toBeInTheDocument();
  });

  it("renders the live pill (Task 10, Step 3) once liveState carries a real game window", () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    render(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticesProvider>
          <TopBar displayName="Ada Lovelace" avatar={null} isAdmin={false} liveState={{ weekday: "Sunday", gamesLive: 7 }} />
        </NoticesProvider>
      </AccountRoomDepsProvider>,
    );
    // Task 13, Step 1c: icon-only at every width — the sentence lives in an `sr-only` sibling,
    // never as visible text (`LiveStatePill`'s own test covers the glyph/count rendering).
    expect(screen.getByText("Sunday · 7 games live")).toBeInTheDocument();
  });

  it("carries the one site search field on every render, ahead of the live pill (site search round)", () => {
    renderTopBar("Ada Lovelace", null);
    const search = screen.getByRole("button", { name: "Search players and teams" });
    const inbox = screen.getByRole("button", { name: "Notices" });
    expect(search.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
