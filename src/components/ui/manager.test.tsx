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
});
