import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { CHAT_CONFIG } from "@/chat/config";
import { renderSurface } from "@/components/ui/test-utils";
import { ReactionBar } from "./reaction-bar";

describe("ReactionBar", () => {
  it("offers every configured reaction, in both themes, axe-clean", async () => {
    await renderSurface(
      <ReactionBar messageId="1" reactions={[]} meUserId="u1" disabled={false} onReact={() => {}} />,
      async ({ container }) => {
        for (const emoji of CHAT_CONFIG.reactions) {
          expect(screen.getByRole("button", { name: `React with ${emoji}` })).toBeInTheDocument();
        }
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows a count and marks the caller's own reaction as pressed", () => {
    render(
      <ReactionBar
        messageId="1"
        reactions={[{ emoji: "🔥", userId: "u1" }, { emoji: "🔥", userId: "u2" }]}
        meUserId="u1"
        disabled={false}
        onReact={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: "React with 🔥" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveTextContent("2");
  });

  it("reports which emoji was pressed", () => {
    const onReact = vi.fn();
    render(<ReactionBar messageId="7" reactions={[]} meUserId="u1" disabled={false} onReact={onReact} />);
    fireEvent.click(screen.getByRole("button", { name: "React with 👏" }));
    expect(onReact).toHaveBeenCalledWith("7", "👏");
  });
});
