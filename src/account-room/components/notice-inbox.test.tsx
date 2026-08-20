import { describe, it, expect } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import type { NoticesBody, NoticeView } from "../contract";
import { fixtureAccountDeps, renderInAccount } from "../test-fixtures";
import { AccountRoomDepsProvider } from "../hooks/deps";
import { NoticeInbox } from "./notice-inbox";

const UNREAD: NoticeView = {
  id: "n1",
  noticeType: "draft_auto_picked",
  title: "We drafted for you",
  body: "The clock ran out on pick 24, so we used your queue and drafted Bijan Robinson (RB).",
  quote: null,
  leagueId: "l1",
  createdAt: "2026-08-18T20:00:00.000Z",
  readAt: null,
};

const READ: NoticeView = { ...UNREAD, id: "n2", title: "Already seen", readAt: "2026-08-17T00:00:00.000Z" };

const EMPTY_PAGE: NoticesBody = { notices: [], unreadCount: 0 };
const ONE_UNREAD: NoticesBody = { notices: [UNREAD], unreadCount: 1 };

describe("NoticeInbox", () => {
  it("shows nothing but the control when there is nothing to say, in both themes, axe-clean", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: EMPTY_PAGE });
    await inBothThemes(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticeInbox />
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        expect(await screen.findByRole("button", { name: "Notices" })).toBeInTheDocument();
        // No unread badge — the "no dot" this case is named for.
        expect(container.querySelector("[class*='rounded-pill']")).toBeNull();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("counts unread notices and announces the count to a screen reader, ignoring already-read ones", async () => {
    const notices = [UNREAD, READ, { ...UNREAD, id: "n3" }, { ...UNREAD, id: "n4" }];
    const fixture = fixtureAccountDeps({ ok: true, data: { notices, unreadCount: 3 } });
    renderInAccount(<NoticeInbox />, fixture.deps);
    const trigger = await screen.findByRole("button", { name: "Notices, 3 unread" });
    expect(trigger).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("opens on click, closes on Escape, and returns focus to the trigger", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: EMPTY_PAGE });
    renderInAccount(<NoticeInbox />, fixture.deps);
    const trigger = await screen.findByRole("button", { name: "Notices" });

    fireEvent.click(trigger);
    expect(screen.getByRole("region", { name: "Notices" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Notices" })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it("marks what it showed as read, once, and not again on reopen", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: ONE_UNREAD });
    renderInAccount(<NoticeInbox />, fixture.deps);
    const trigger = await screen.findByRole("button", { name: "Notices, 1 unread" });

    fixture.response = { ok: true, data: { stamped: 1 } };
    fireEvent.click(trigger); // open — shows the one unread notice, marks it read
    await waitFor(() => expect(fixture.calls).toContain("POST /api/notices/read"));
    expect(fixture.calls.filter((call) => call === "POST /api/notices/read")).toHaveLength(1);

    fireEvent.click(trigger); // close
    fireEvent.click(trigger); // reopen — nothing unread left locally, so no second stamp
    await waitFor(() => expect(screen.getByRole("region", { name: "Notices" })).toBeInTheDocument());
    expect(fixture.calls.filter((call) => call === "POST /api/notices/read")).toHaveLength(1);
  });

  it("adds a notice that arrives on the stream without a reload", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: EMPTY_PAGE });
    renderInAccount(<NoticeInbox />, fixture.deps);
    await screen.findByRole("button", { name: "Notices" });

    fixture.response = { ok: true, data: ONE_UNREAD };
    act(() => fixture.emit("notice.created", { noticeId: UNREAD.id, noticeType: UNREAD.noticeType }));

    await screen.findByRole("button", { name: "Notices, 1 unread" });
  });

  it("keeps working when the stream never connects", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: ONE_UNREAD });
    renderInAccount(<NoticeInbox />, fixture.deps);
    const trigger = await screen.findByRole("button", { name: "Notices, 1 unread" });

    fireEvent.click(trigger);
    expect(await screen.findByText(UNREAD.title)).toBeInTheDocument();
    // No `emit`/`fire` anywhere in this test: the EventSource simply never opened, and every
    // other behavior — the mount fetch, opening the panel, reading the notice — still works.
  });

  it("says so plainly when the fetch fails, and offers a retry", async () => {
    const fixture = fixtureAccountDeps({ ok: false, error: "Not signed in." });
    renderInAccount(<NoticeInbox />, fixture.deps);
    const trigger = await screen.findByRole("button", { name: "Notices" });
    fireEvent.click(trigger);

    expect(await screen.findByText("We couldn't load your notices.")).toBeInTheDocument();
    expect(screen.getByText("Not signed in.")).toBeInTheDocument();

    fixture.response = { ok: true, data: ONE_UNREAD };
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(UNREAD.title)).toBeInTheDocument();
  });

  // Fix round 1, FIX 4: the first-timer's question — does "drafted from their queue" explain
  // autopick to someone who has never seen one? An `InfoTip` beside the notice body is the
  // answer for the ONE notice type this applies to.
  it("offers the queue glossary term beside an autopick notice, and not beside any other type", async () => {
    const removal: NoticeView = { ...UNREAD, id: "n5", noticeType: "review_removed", title: "We removed your review", quote: "off topic" };
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [UNREAD, removal], unreadCount: 0 } });
    renderInAccount(<NoticeInbox />, fixture.deps);
    fireEvent.click(await screen.findByRole("button", { name: "Notices" }));

    expect(await screen.findByRole("button", { name: "What is your draft queue?" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "What is your draft queue?" })).toHaveLength(1);
  });

  // Fix round 1, FIX 7: an operator's own words render as a distinct blockquote, not folded
  // into the body's own sentence.
  it("renders a review-removal notice's quoted reason as its own blockquote", async () => {
    const removal: NoticeView = { ...UNREAD, id: "n5", noticeType: "review_removed", title: "We removed your review", body: "An operator removed your review. We keep your review on file exactly as you wrote it.", quote: "off topic" };
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [removal], unreadCount: 0 } });
    renderInAccount(<NoticeInbox />, fixture.deps);
    fireEvent.click(await screen.findByRole("button", { name: "Notices" }));

    const quote = await screen.findByText('"off topic"');
    expect(quote.tagName).toBe("BLOCKQUOTE");
    // The body's own sentence no longer inlines the words this blockquote already shows.
    expect(screen.getByText(removal.body)).not.toHaveTextContent("off topic");
  });
});
