import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { NewsList } from "./news-list";

describe("NewsList", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<NewsList news={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every headline as a link to its own source", () => {
    render(<NewsList news={[{ title: "Rashad Long: full practice", link: "https://example.com/1" }]} />);
    expect(screen.getByText("News")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Rashad Long: full practice" });
    expect(link).toHaveAttribute("href", "https://example.com/1");
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<NewsList news={[{ title: "Rashad Long: full practice", link: "https://example.com/1" }]} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
