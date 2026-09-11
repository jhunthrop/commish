import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { MessageBubble } from "./message-bubble";

describe("MessageBubble", () => {
  it("puts somebody else's words on paper beside their face with their name and the clock, in both themes, axe-clean", async () => {
    await renderSurface(
      <MessageBubble author="Rey Okafor" time="7:42 pm">
        leave Cook alone
      </MessageBubble>,
      async ({ container }) => {
        const row = screen.getByTestId("message-bubble");
        expect(row).not.toHaveAttribute("data-mine");
        expect(row.className).not.toContain("flex-row-reverse");
        expect(screen.getByText("RO")).toBeInTheDocument();
        expect(screen.getByText("Rey Okafor")).toBeInTheDocument();
        expect(screen.getByText("7:42 pm")).toBeInTheDocument();
        const bubble = screen.getByText("leave Cook alone").parentElement!;
        expect(bubble.className).toContain("rounded-lg");
        expect(bubble.className).toContain("bg-surface-elevated");
        expect(bubble.className).toContain("shadow-card");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("puts your own words in Court blue on the right, with no author line", () => {
    render(
      <MessageBubble author="You" mine time="7:43 pm">
        no promises
      </MessageBubble>,
    );
    const row = screen.getByTestId("message-bubble");
    expect(row).toHaveAttribute("data-mine", "true");
    expect(row.className).toContain("flex-row-reverse");
    const bubble = screen.getByText("no promises").parentElement!;
    expect(bubble.className).toContain("bg-accent");
    expect(bubble.className).toContain("text-accent-text");
    expect(screen.queryByText("You")).toBeNull();
    expect(screen.getByText("7:43 pm")).toBeInTheDocument();
  });

  it("hangs the reactions under the bubble and renders nothing there without them", () => {
    const bare = render(<MessageBubble author="Dana Whitfield">hi</MessageBubble>);
    expect(bare.getByTestId("message-bubble").lastElementChild!.children).toHaveLength(1);
    bare.unmount();
    render(
      <MessageBubble author="Dana Whitfield" reactions={<button type="button">React with 🔥</button>}>
        hi
      </MessageBubble>,
    );
    expect(screen.getByRole("button", { name: "React with 🔥" })).toBeInTheDocument();
  });

  it("marks the row as the intent surface quiet controls reveal on", () => {
    render(<MessageBubble author="Dana Whitfield">hi</MessageBubble>);
    expect(screen.getByTestId("message-bubble").className).toContain("group/msg");
  });
});
