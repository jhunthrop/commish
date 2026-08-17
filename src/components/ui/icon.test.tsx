import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Icon } from "./icon";

describe("Icon", () => {
  it("is decorative (aria-hidden) by default", () => {
    const { container } = render(<Icon name="trophy" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
  it("is an accessible image when given a label", () => {
    const { getByRole } = render(<Icon name="trophy" label="Champion" />);
    expect(getByRole("img", { name: "Champion" })).toBeInTheDocument();
  });
});
