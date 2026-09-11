import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { ReactionPill } from "./reaction-pill";

beforeEach(() => {
  vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
});

describe("ReactionPill", () => {
  it("is a pressed-state toggle named by its emoji, with the count as plain text, in both themes, axe-clean", async () => {
    await renderSurface(<ReactionPill emoji="🔥" count={3} mine={false} onToggle={() => {}} />, async ({ container }) => {
      const pill = screen.getByRole("button", { name: "React with 🔥" });
      expect(pill).toHaveAttribute("aria-pressed", "false");
      expect(pill).toHaveTextContent("3");
      expect(pill.className).toContain("rounded-pill");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("wears the Court blue ring when it is yours, and fires the toggle on press", () => {
    const onToggle = vi.fn();
    render(<ReactionPill emoji="🔥" count={1} mine onToggle={onToggle} />);
    const pill = screen.getByRole("button", { name: "React with 🔥" });
    expect(pill).toHaveAttribute("aria-pressed", "true");
    expect(pill.className).toContain("ring-accent");
    fireEvent.click(pill);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("hides a zero count rather than printing 0", () => {
    render(<ReactionPill emoji="👏" count={0} mine={false} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "React with 👏" })).not.toHaveTextContent("0");
  });

  it("pops from the finger only when the count rises: nothing on mount, nothing on a same-count render", () => {
    const view = render(<ReactionPill emoji="🔥" count={2} mine={false} onToggle={() => {}} />);
    const glyph = () => screen.getByRole("button", { name: "React with 🔥" }).firstElementChild!;
    expect(glyph().className).not.toContain("animate-spring-in");
    view.rerender(<ReactionPill emoji="🔥" count={2} mine={false} onToggle={() => {}} />);
    expect(glyph().className).not.toContain("animate-spring-in");
    view.rerender(<ReactionPill emoji="🔥" count={3} mine onToggle={() => {}} />);
    expect(glyph().className).toContain("animate-spring-in");
    view.rerender(<ReactionPill emoji="🔥" count={2} mine={false} onToggle={() => {}} />);
    // A count going DOWN is an un-reaction; nothing pops for a departure.
    expect(glyph().className).toContain("animate-spring-in");
  });

  it("never pops when the reader asked for less motion, and still updates the count", () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    const view = render(<ReactionPill emoji="🔥" count={2} mine={false} onToggle={() => {}} />);
    view.rerender(<ReactionPill emoji="🔥" count={3} mine onToggle={() => {}} />);
    const pill = screen.getByRole("button", { name: "React with 🔥" });
    expect(pill.firstElementChild!.className).not.toContain("animate-spring-in");
    expect(pill).toHaveTextContent("3");
  });
});
