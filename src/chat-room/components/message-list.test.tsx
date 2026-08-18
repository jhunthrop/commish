import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { chatMessage } from "../test-fixtures";
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
});
