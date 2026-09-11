import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { CHAT_CONFIG } from "@/chat/config";
import { renderSurface } from "@/components/ui/test-utils";
import { ReactionBar } from "./reaction-bar";

describe("ReactionBar", () => {
  it("offers every configured reaction, in both themes, axe-clean", async () => {
    await renderSurface(
      <ReactionBar targetId="1" reactions={[]} meUserId="u1" disabled={false} onReact={() => {}} />,
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
        targetId="1"
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

  it("quiets unused prompts on hover-capable devices, keeps landed reactions always visible (review E10)", () => {
    render(
      <ReactionBar
        targetId="1"
        reactions={[{ emoji: "\u{1f525}", userId: "u2" }]}
        meUserId="u1"
        disabled={false}
        onReact={() => {}}
      />,
    );
    // A zero-count button is an offer, not information: it reveals on the message row's own
    // hover/focus intent (media-gated, so touch devices never lose it) but stays in the tree,
    // focusable, with its full accessible name.
    const unused = screen.getByRole("button", { name: "React with \u{1f44f}" });
    expect(unused.className).toContain("[@media(hover:hover)]:opacity-0");
    expect(unused.className).toContain("group-hover/msg:opacity-100");
    expect(unused.className).toContain("group-focus-within/msg:opacity-100");
    expect(unused.className).toContain("focus-visible:opacity-100");
    // A landed reaction IS information — never hidden.
    const landed = screen.getByRole("button", { name: "React with \u{1f525}" });
    expect(landed.className).not.toContain("opacity-0");
  });

  it("reports which emoji was pressed", () => {
    const onReact = vi.fn();
    render(<ReactionBar targetId="7" reactions={[]} meUserId="u1" disabled={false} onReact={onReact} />);
    fireEvent.click(screen.getByRole("button", { name: "React with 👏" }));
    expect(onReact).toHaveBeenCalledWith("7", "👏");
  });
});
