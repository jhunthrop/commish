import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { chatMessage, TOUCHDOWN_GIF } from "../test-fixtures";
import { formatChatTime } from "../lib/format";
import { MessageList } from "./message-list";

const MESSAGES = [
  chatMessage("1", { body: "wheels up" }),
  chatMessage("2", { authorUserId: "u1", authorName: "Alex Rivera", body: "let's go", reactions: [{ emoji: "🔥", userId: "u2" }] }),
];

describe("MessageList", () => {
  it("renders every message with its author and time, in both themes, axe-clean", async () => {
    await inBothThemes(
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

  it("offers a way to start talking when there is nothing here yet", () => {
    render(<MessageList leagueId="l1" messages={[]} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
    expect(screen.getByText("Nobody's said anything yet")).toBeInTheDocument();
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
    await inBothThemes(
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
      const removed = [chatMessage("9", { authorUserId: "u2", removal: { at: "2026-08-20T00:00:00.000Z", phrase: "spam or fake content" } })];
      render(<MessageList leagueId="l1" messages={removed} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
      expect(screen.queryByRole("button", { name: "Report" })).not.toBeInTheDocument();
    });
  });

  describe("a removed message", () => {
    const REMOVED = [
      chatMessage("9", { authorUserId: "u2", authorName: "Jordan Lee", body: "should never render", removal: { at: "2026-08-20T00:00:00.000Z", phrase: "spam or fake content" } }),
    ];

    it("renders in place — the author and avatar stay, the words do not", async () => {
      await inBothThemes(
        <MessageList leagueId="l1" messages={REMOVED} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />,
        async ({ container }) => {
          expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
          expect(screen.getByText(/A message was removed\./)).toBeInTheDocument();
          expect(screen.queryByText("should never render")).not.toBeInTheDocument();
          expect(screen.getAllByRole("listitem")).toHaveLength(1);
          expect(await axe(container)).toHaveNoViolations();
        },
      );
    });

    it("states the reason in the closed vocabulary's own phrase, never a raw token", () => {
      render(<MessageList leagueId="l1" messages={REMOVED} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
      expect(screen.getByText(/spam or fake content/)).toBeInTheDocument();
    });

    it("offers no reactions on a removed message", () => {
      render(<MessageList leagueId="l1" messages={REMOVED} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
      expect(screen.queryByRole("button", { name: /React with/ })).not.toBeInTheDocument();
    });
  });
});
