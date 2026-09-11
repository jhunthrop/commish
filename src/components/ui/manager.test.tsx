import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { Manager } from "./manager";

describe("Manager", () => {
  it("puts the face beside the name, the name largest, in both themes, axe-clean", async () => {
    await renderSurface(<Manager name="Dana Whitfield" meta="Bay Bandits" />, async ({ container }) => {
      const row = screen.getByTestId("manager");
      expect(row.firstElementChild).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByText("DW")).toBeInTheDocument();
      expect(screen.getByText("Dana Whitfield").className).toContain("font-display");
      expect(screen.getByText("Dana Whitfield").className).toContain("font-bold");
      expect(screen.getByText("Bay Bandits").className).toContain("text-sm");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("wears your amber ring or your rival's rose ring, and no ring by default", () => {
    const you = render(<Manager name="Dana Whitfield" ring="self" />);
    expect(you.getByTestId("manager").firstElementChild!.className).toContain("ring-self");
    you.unmount();
    const rival = render(<Manager name="Rey Okafor" ring="rival" />);
    expect(rival.getByTestId("manager").firstElementChild!.className).toContain("ring-negative");
    rival.unmount();
    const plain = render(<Manager name="Coach Parker" />);
    expect(plain.getByTestId("manager").firstElementChild!.className).not.toContain("ring-");
  });

  it("keeps the trailing slot at its own width and truncates the name instead", () => {
    render(<Manager name="Alexandria Montgomery-Whitfield" trailing={<span>112.5</span>} />);
    expect(screen.getByText("Alexandria Montgomery-Whitfield").className).toContain("truncate");
    expect(screen.getByText("112.5").parentElement!.className).toContain("shrink-0");
  });

  it("renders no empty meta or trailing boxes", () => {
    render(<Manager name="Dana Whitfield" />);
    expect(screen.getByTestId("manager").children).toHaveLength(2);
    expect(screen.getByTestId("manager").children[1]!.children).toHaveLength(1);
  });

  // THE ONE SURFACE WHERE A MANAGER IS THE PAGE (the account room). A manager in a list is a
  // span; a manager who IS the screen is that document's own heading, and the name scales with
  // the face rather than the call site picking a type size.
  it("renders the name as a span by default and as the page heading when it is the page", () => {
    const listed = render(<Manager name="Dana Whitfield" />);
    expect(listed.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Dana Whitfield").className).toContain("text-md");
    listed.unmount();

    render(<Manager name="Dana Whitfield" size="2xl" titleAs="h1" />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Dana Whitfield");
    // P1: at the account room's 96px face the name is the largest thing on the screen.
    expect(heading.className).toContain("text-display-md");
  });

  it("lets a hero's meta stack wrap instead of clipping it to one truncated line", () => {
    const row = render(<Manager name="Dana Whitfield" meta="Bay Bandits" />);
    expect(screen.getByText("Bay Bandits").className).toContain("truncate");
    row.unmount();

    render(<Manager size="2xl" name="Dana Whitfield" meta={<span>dana@example.com</span>} />);
    expect(screen.getByText("dana@example.com").parentElement!.className).not.toContain("truncate");
  });
});
