import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { PublicBar } from "./public-bar";

describe("PublicBar", () => {
  it("renders bare with just the wordmark and a sign-in link, in both themes, axe-clean", async () => {
    await renderSurface(<PublicBar intent="/reviews" signedIn={false} />, async ({ container, getByRole, queryByRole }) => {
      expect(getByRole("link", { name: "Commish" })).toHaveAttribute("href", "/");
      expect(getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?returnTo=%2Freviews");
      expect(queryByRole("navigation")).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("carries the visitor's own intent through its sign-in link, per page", () => {
    renderSurface(<PublicBar intent="/browse" signedIn={false} />, ({ getByRole }) => {
      expect(getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?returnTo=%2Fbrowse");
    });
  });

  it("falls back to a plain sign-in when a caller has no intent worth carrying", () => {
    renderSurface(<PublicBar intent={null} signedIn={false} />, ({ getByRole }) => {
      expect(getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    });
  });

  /**
   * FOUNDER 2026-08-27: "when I'm logged in it still says login on the main page." This bar had no
   * idea who was reading it, so a member standing on the front door, /browse or /reviews was
   * invited to sign in to the account they were already using. The front door even had the answer
   * in hand — it awaits `getCurrentUser()` for `helpLevel` — and never passed it to the header.
   */
  it("offers the way IN, not a second sign-in, to somebody already signed in", async () => {
    await renderSurface(<PublicBar intent="/reviews" signedIn />, async ({ container, getByRole, queryByRole }) => {
      expect(getByRole("link", { name: "Your leagues" })).toHaveAttribute("href", "/app");
      expect(queryByRole("link", { name: "Sign in" })).toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("renders the front door's nav and action when a caller fills them in (F5)", () => {
    renderSurface(
      <PublicBar
        intent="/"
        signedIn={false}
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
