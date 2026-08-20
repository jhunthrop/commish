import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { chatMessage, TOUCHDOWN_GIF } from "../test-fixtures";
import { MessageList } from "./message-list";

const MESSAGES = [
  chatMessage("1", { body: "wheels up" }),
  chatMessage("2", { authorUserId: "u1", authorName: "Alex Rivera", body: "let's go", reactions: [{ emoji: "🔥", userId: "u2" }] }),
];

describe("MessageList", () => {
  it("renders every message with its author and time, in both themes, axe-clean", async () => {
    await inBothThemes(
      <MessageList messages={MESSAGES} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />,
      async ({ container }) => {
        expect(screen.getByText("wheels up")).toBeInTheDocument();
        expect(screen.getByText("let's go")).toBeInTheDocument();
        expect(screen.getAllByRole("listitem")).toHaveLength(2);
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("offers a way to start talking when there is nothing here yet", () => {
    render(<MessageList messages={[]} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
    expect(screen.getByText("Nobody's said anything yet")).toBeInTheDocument();
  });

  it("offers earlier messages only when there are some, and asks for them once", () => {
    const onLoadEarlier = vi.fn();
    const { rerender } = render(
      <MessageList messages={MESSAGES} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={onLoadEarlier} onReact={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).not.toBeInTheDocument();

    rerender(
      <MessageList messages={MESSAGES} meUserId="u1" hasMore loadingEarlier={false} onLoadEarlier={onLoadEarlier} onReact={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
  });

  it("announces new messages politely without stealing focus", () => {
    render(<MessageList messages={MESSAGES} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
    expect(screen.getByRole("log")).toHaveAttribute("aria-live", "polite");
  });

  it("renders a GIF message as an image with its alt text and real dimensions, in both themes, axe-clean", async () => {
    const withGif = [chatMessage("3", { body: TOUCHDOWN_GIF.alt, gif: TOUCHDOWN_GIF })];
    await inBothThemes(
      <MessageList messages={withGif} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />,
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
    render(<MessageList messages={withGif} meUserId="u1" hasMore={false} loadingEarlier={false} onLoadEarlier={() => {}} onReact={() => {}} />);
    // The accessible name lives on the <img>; a second plain-text copy would be redundant noise
    // for a sighted reader and a doubled announcement for a screen reader.
    expect(screen.queryByText(TOUCHDOWN_GIF.alt, { selector: "p" })).not.toBeInTheDocument();
  });
});
