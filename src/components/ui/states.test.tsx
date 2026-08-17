import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { Button } from "./button";
import { inBothThemes } from "./test-utils";

describe("Skeleton", () => {
  it("is aria-busy and announces loading to screen readers", () => {
    render(<Skeleton lines={2} />);
    const el = screen.getByText("Loading…").parentElement!;
    expect(el).toHaveAttribute("aria-busy", "true");
  });
});

describe("EmptyState", () => {
  it("renders title, description and the required action, both themes, no axe violations", async () => {
    await inBothThemes(
      <EmptyState title="No leagues yet" description="Create one or join a public league." action={<Button>Create a league</Button>} icon="inbox" />,
      async ({ container }) => {
        expect(screen.getByRole("heading", { name: "No leagues yet" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Create a league" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});

describe("ErrorState", () => {
  it("is an alert with a recovery action", async () => {
    render(<ErrorState title="Couldn't load standings" description="Check your connection and try again." action={<Button>Retry</Button>} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load standings");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
