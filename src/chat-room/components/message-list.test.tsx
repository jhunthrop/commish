import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { REASON_FRAGMENTS } from "@/moderation/test-support";
import { chatMessage, TOUCHDOWN_GIF } from "../test-fixtures";
import { formatChatTime } from "../lib/format";
import { MessageList } from "./message-list";

const MESSAGES = [
  chatMessage("1", { body: "wheels up" }),
  chatMessage("2", { authorUserId: "u1", authorName: "Alex Rivera", body: "let's go", reactions: [{ emoji: "🔥", userId: "u2" }] }),
];

describe("MessageList", () => {
  it("renders every message with its author and time, in both themes, axe-clean", async () => {
    await renderSurface(
      <MessageList leagueId="l1" messages={MESSAGES} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />,
      async ({ container }) => {
        expect(screen.getByText("wheels up")).toBeInTheDocument();
        expect(screen.getByText("let's go")).toBeInTheDocument();
        expect(screen.getAllByRole("listitem")).toHaveLength(2);
        // "with its author and time" is two thirds of this test's name and used to query
        // neither: only the bodies were asserted, so a render that dropped both would pass.
        expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
        expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
        expect(screen.getAllByText(formatChatTime(MESSAGES[0]!.createdAt))).toHaveLength(2);
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // The silence used to be a dashed `EmptyState` whose title was a node of its own, so an exact
  // match on the first half found it. It is one quiet line in one paragraph now (founder,
  // 2026-08-30, the scan pass), and the invitation this test is named for rides in the same
  // sentence, so the sentence is what gets pinned.
  it("offers a way to start talking when there is nothing here yet", () => {
    render(<MessageList leagueId="l1" messages={[]} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
    expect(
      screen.getByText("Nobody has said anything yet. Say hello, or ask who is actually starting that kicker."),
    ).toBeInTheDocument();
  });

  it("offers earlier messages only when there are some, and asks for them once", () => {
    const onLoadEarlier = vi.fn();
    const { rerender } = render(
      <MessageList leagueId="l1" messages={MESSAGES} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={onLoadEarlier} onReact={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).not.toBeInTheDocument();

    rerender(
      <MessageList leagueId="l1" messages={MESSAGES} meUserId="u1" hasMore loadingEarlier={false} onLoadEarlier={onLoadEarlier} onReact={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
  });

  it("announces new messages politely without stealing focus", () => {
    render(<MessageList leagueId="l1" messages={MESSAGES} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
    expect(screen.getByRole("log")).toHaveAttribute("aria-live", "polite");
  });

  it("renders a GIF message as an image with its alt text and real dimensions, in both themes, axe-clean", async () => {
    const withGif = [chatMessage("3", { body: TOUCHDOWN_GIF.alt, gif: TOUCHDOWN_GIF })];
    await renderSurface(
      <MessageList leagueId="l1" messages={withGif} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />,
      async ({ container }) => {
        const img = screen.getByRole("img", { name: TOUCHDOWN_GIF.alt });
        expect(img).toHaveAttribute("width", String(TOUCHDOWN_GIF.width));
        expect(img).toHaveAttribute("height", String(TOUCHDOWN_GIF.height));
        expect(img).toHaveAttribute("loading", "lazy");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("does not render the GIF's alt text a second time as plain body text", () => {
    const withGif = [chatMessage("3", { body: TOUCHDOWN_GIF.alt, gif: TOUCHDOWN_GIF })];
    render(<MessageList leagueId="l1" messages={withGif} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
    // The accessible name lives on the <img>; a second plain-text copy would be redundant noise
    // for a sighted reader and a doubled announcement for a screen reader.
    expect(screen.queryByText(TOUCHDOWN_GIF.alt, { selector: "p" })).not.toBeInTheDocument();
  });

  describe("the report affordance", () => {
    it("offers Report on somebody else's message but never on the caller's own", () => {
      render(<MessageList leagueId="l1" messages={MESSAGES} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
      // MESSAGES[0] is authored by u2 (the fixture default); MESSAGES[1] is authored by u1, the
      // caller here — exactly one "Report" button should exist.
      expect(screen.getAllByRole("button", { name: "Report" })).toHaveLength(1);
    });

    it("opens the report dialog for the message that was reported, not some other one", () => {
      render(<MessageList leagueId="l1" messages={MESSAGES} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "Report" }));
      expect(screen.getByRole("dialog", { name: "Report this message" })).toBeInTheDocument();
    });

    it("never offers Report on an already-removed message", () => {
      const removed = [chatMessage("9", { authorUserId: "u2", removal: { at: "2026-08-20T00:00:00.000Z" } })];
      render(<MessageList leagueId="l1" messages={removed} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
      expect(screen.queryByRole("button", { name: "Report" })).not.toBeInTheDocument();
    });
  });

  describe("a removed message", () => {
    const REMOVED = [
      chatMessage("9", { authorUserId: "u2", authorName: "Jordan Lee", body: "should never render", removal: { at: "2026-08-20T00:00:00.000Z" } }),
    ];

    it("renders in place — the author and avatar stay, the words do not", async () => {
      await renderSurface(
        <MessageList leagueId="l1" messages={REMOVED} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />,
        async ({ container }) => {
          expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
          expect(screen.getByText(/We removed this message\./)).toBeInTheDocument();
          expect(screen.queryByText("should never render")).not.toBeInTheDocument();
          expect(screen.getAllByRole("listitem")).toHaveLength(1);
          expect(await axe(container)).toHaveNoViolations();
        },
      );
    });

    /**
     * The room sees only the neutral fact, never the removal reason — reviews' own precedent
     * (private-notice-only) mirrored, not broadcast. Final review, HIGH 1: the message no longer
     * CARRIES the reason at all, so this asserts over the whole closed vocabulary rather than
     * over the one phrase a fixture happened to set.
     */
    it("never renders any removal reason to the room", () => {
      const { container } = render(<MessageList leagueId="l1" messages={REMOVED} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
      for (const fragment of REASON_FRAGMENTS) {
        expect(container.textContent).not.toContain(fragment);
      }
    });

    it("offers no reactions on a removed message", () => {
      render(<MessageList leagueId="l1" messages={REMOVED} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
      expect(screen.queryByRole("button", { name: /React with/ })).not.toBeInTheDocument();
    });
  });

  it("reveals Report on the row's own intent for hover devices, always-on for touch (review E10)", () => {
    render(
      <MessageList
        leagueId="lg1"
        messages={[chatMessage("m1", { authorUserId: "u2" })]}
        meUserId="u1"
        hasMore={false}
        loadingEarlier={false}
        onLoadEarlier={() => {}}
        onReact={() => {}}
      />,
    );
    const report = screen.getByRole("button", { name: "Report" });
    expect(report.className).toContain("[@media(hover:hover)]:opacity-0");
    expect(report.className).toContain("group-hover/msg:opacity-100");
    expect(report.className).toContain("group-focus-within/msg:opacity-100");
    expect(report.className).toContain("focus-visible:opacity-100");
    // The row is the intent surface the reveals key off.
    expect(report.closest("li")?.className).toContain("group/msg");
  });
});
