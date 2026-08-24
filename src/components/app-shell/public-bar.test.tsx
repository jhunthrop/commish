import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { PublicBar } from "./public-bar";

describe("PublicBar", () => {
  it("renders bare with just the wordmark and a sign-in link, in both themes, axe-clean", async () => {
    await renderSurface(<PublicBar intent="/reviews" />, async ({ container, getByRole, queryByRole }) => {
      expect(getByRole("link", { name: "Commish" })).toHaveAttribute("href", "/");
      expect(getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?returnTo=%2Freviews");
      expect(queryByRole("navigation")).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("carries the visitor's own intent through its sign-in link, per page", () => {
    renderSurface(<PublicBar intent="/browse" />, ({ getByRole }) => {
      expect(getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?returnTo=%2Fbrowse");
    });
  });

  it("falls back to a plain sign-in when a caller has no intent worth carrying", () => {
    renderSurface(<PublicBar intent={null} />, ({ getByRole }) => {
      expect(getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    });
  });

  it("renders the front door's nav and action when a caller fills them in (F5)", () => {
    renderSurface(
      <PublicBar
        intent="/"
        nav={[
          { href: "/browse", label: "Open leagues" },
          { href: "/league-rules", label: "How it works" },
          { href: "/reviews", label: "Reviews" },
        ]}
        action={
          <a href="/browse" className="rounded-md bg-accent px-4 py-2 text-accent-text">
            Take a seat
          </a>
        }
      />,
      ({ getByRole }) => {
        const nav = getByRole("navigation", { name: "Commish" });
        expect(nav).toBeInTheDocument();
        expect(getByRole("link", { name: "Open leagues" })).toHaveAttribute("href", "/browse");
        expect(getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/league-rules");
        expect(getByRole("link", { name: "Reviews" })).toHaveAttribute("href", "/reviews");
        expect(getByRole("link", { name: "Take a seat" })).toHaveAttribute("href", "/browse");
      },
    );
  });
});
