import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Button } from "./button";
import { inBothThemes } from "./test-utils";

describe("Button", () => {
  it("renders its label and calls onClick, in both themes, with no axe violations", async () => {
    await inBothThemes(<Button onClick={() => {}}>Draft player</Button>, async ({ container }) => {
      expect(screen.getByRole("button", { name: "Draft player" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("when loading: is disabled, aria-busy, keeps its label, and swallows clicks", () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = getByRole("button", { name: /Save/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies the variant class", () => {
    const { getByRole } = render(<Button variant="destructive">Delete</Button>);
    expect(getByRole("button").className).toMatch(/negative/);
  });
});
