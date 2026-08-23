import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Avatar } from "./avatar";
import { renderSurface } from "./test-utils";

describe("Avatar", () => {
  it("falls back to initials and stays decorative by default, in both themes", async () => {
    await renderSurface(<Avatar name="Dana Whitfield" />, async ({ container }) => {
      expect(screen.getByText("DW")).toBeInTheDocument();
      expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("uses a single initial for a one-word name and ignores middle words", () => {
    const { rerender } = render(<Avatar name="Prince" />);
    expect(screen.getByText("P")).toBeInTheDocument();
    rerender(<Avatar name="  ada  byron   lovelace " />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("shows a question mark rather than nothing for a blank name", () => {
    render(<Avatar name="   " />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("renders the image when a remote https avatar ref is given, with an empty alt while decorative", () => {
    const { container } = render(<Avatar name="Dana Whitfield" avatar="https://workoscdn.com/u/a.png" />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://workoscdn.com/u/a.png");
    expect(img).toHaveAttribute("alt", "");
  });

  it("becomes an accessible image when labelled", async () => {
    const { container } = render(
      <Avatar name="Dana Whitfield" label="Dana Whitfield" avatar="https://workoscdn.com/u/a.png" />,
    );
    expect(screen.getByRole("img", { name: "Dana Whitfield" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders a chosen preset as an icon, both themes, no axe violations", async () => {
    await renderSurface(<Avatar name="Ada Lovelace" avatar="preset:shield" label="Ada Lovelace" />, async ({ container }) => {
      expect(screen.getByRole("img", { name: "Ada Lovelace" })).toBeInTheDocument();
      expect(container.querySelector("svg")).not.toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("falls back to initials rather than an image for a value it will not render", () => {
    render(<Avatar name="Ada Lovelace" avatar="javascript:alert(1)" />);
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
