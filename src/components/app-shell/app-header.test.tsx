import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import { NoticesProvider } from "./notices-provider";
import { AppHeader } from "./app-header";

// `AppHeader` renders `NoticeInbox` (Task 10), a `"use client"` component whose `useNotices()`
// (Plan D Task 9) requires a `NoticesProvider` ancestor — it throws without one, no silent
// standalone fallback. Every case below wraps `AppHeader` in `AccountRoomDepsProvider` AND
// `NoticesProvider` with a fixture so no case ever reaches the real `fetch` — the same
// no-module-mocks, no-real-network discipline every other account-room test already follows.
function renderHeader(displayName: string, avatar: string | null, isAdmin = false) {
  const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
  return render(
    <AccountRoomDepsProvider deps={fixture.deps}>
      <NoticesProvider>
        <AppHeader displayName={displayName} avatar={avatar} isAdmin={isAdmin} />
      </NoticesProvider>
    </AccountRoomDepsProvider>,
  );
}

describe("AppHeader", () => {
  it("names the signed-in user and links to their profile, with their avatar, in both themes, axe-clean", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticesProvider>
          <AppHeader displayName="Ada Lovelace" avatar="preset:shield" isAdmin={false} />
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
    renderHeader("Ada Lovelace", null);
    expect(screen.getByRole("link", { name: /Ada Lovelace/ })).toHaveAttribute("href", "/app/profile");
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("keeps the wordmark link to /app and a working sign-out form", () => {
    renderHeader("Ada Lovelace", null);
    expect(screen.getByRole("link", { name: "Commish" })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("renders the notice inbox trigger left of the profile link", async () => {
    renderHeader("Ada Lovelace", null);
    const inbox = await screen.findByRole("button", { name: "Notices" });
    const profile = screen.getByRole("link", { name: /Ada Lovelace/ });
    // DOM order IS visual order here — both are plain flow siblings in the same flex row, no
    // `order-*` utility on either.
    expect(inbox.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no queue link to an ordinary member — the queue is operator-only (Task 5)", () => {
    renderHeader("Ada Lovelace", null, false);
    expect(screen.queryByRole("link", { name: /Queue/ })).not.toBeInTheDocument();
  });

  it("links an operator to the dispute queue, in both themes, axe-clean", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticesProvider>
          <AppHeader displayName="Ada Lovelace" avatar={null} isAdmin={true} />
        </NoticesProvider>
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByRole("link", { name: /Queue/ })).toHaveAttribute("href", "/app/admin/queue");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
