import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { ReadingFrame } from "./reading-frame";

describe("ReadingFrame", () => {
  /**
   * The finding this frame exists for: all four measured-paragraph pages rendered `PublicBar`
   * with no `nav` at all, so a stranger who landed on `/support` from a search result had one
   * door back into the product and it was the wordmark. The frame cannot be built without the
   * storefront nav, which is the point of it being a frame rather than four call sites.
   */
  it("carries the storefront nav, so a reading page is never a one-door surface", async () => {
    await renderSurface(
      <ReadingFrame title="Support" lede="One sentence." intent="/support" signedIn={false}>
        <p>Body.</p>
      </ReadingFrame>,
      () => {
        expect(screen.getByRole("link", { name: "Open leagues" })).toHaveAttribute("href", "/browse");
        expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/league-rules");
      },
    );
  });

  /** The lede is the page's one entry point: ink, one step up the body scale, while every
   *  paragraph under it stays muted. Twelve equal sentences is the shape these pages had. */
  it("sets the lede in ink above the muted column, not as a thirteenth equal sentence", async () => {
    await renderSurface(
      <ReadingFrame title="Support" lede="A report lands in a queue." intent="/support" signedIn={false}>
        <p>Body.</p>
      </ReadingFrame>,
      ({ getByText }) => {
        const lede = getByText("A report lands in a queue.");
        expect(lede.className).toContain("text-lg");
        expect(lede.className).toContain("text-text-primary");
        expect(getByText("Body.").closest("div")?.className).toContain("text-text-muted");
      },
    );
  });

  /** A page whose whole content is an act carries no prose column at all — the frame renders the
   *  masthead and stops, rather than an empty measured well under it. */
  it("renders the action in the masthead and no prose column when there is nothing more to say", async () => {
    await renderSurface(
      <ReadingFrame
        title="Sign-in did not go through"
        lede="Nothing about your account changed."
        intent={null}
        signedIn={false}
        action={<button type="button">Go to the front door</button>}
      />,
      ({ getByText }) => {
        expect(getByText("Go to the front door")).toBeInTheDocument();
      },
    );
  });

  it("names the page once, as its own h1, and stays axe-clean in both themes", async () => {
    await renderSurface(
      <ReadingFrame title="Privacy" kicker="Legal" lede="One sentence." intent="/legal/privacy" signedIn>
        <p>Body.</p>
      </ReadingFrame>,
      async ({ container, getByRole }) => {
        expect(getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
