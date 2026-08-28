import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Card } from "./card";
import { renderSurface } from "./test-utils";

describe("Card", () => {
  it("renders children as the requested element, both themes, no axe violations", async () => {
    await renderSurface(
      <Card as="section" aria-label="Standings">
        <p>Row</p>
      </Card>,
      async ({ container }) => {
        expect(screen.getByRole("region", { name: "Standings" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  /**
   * RULE 4, AMENDED (docs/design/2026-08-27-fun-pass-spec.md, founder-approved 2026-08-27):
   * hairlines still beat boxes, and the amendment adds the test for when a thing earns a card
   * anyway — **a thing you act on or compare against its neighbours may be a card; a thing you
   * read down a column stays a row.**
   *
   * `interactive` is that test made available in code. Before it, nothing in this product
   * acknowledged the pointer: `surfaceRaised` is documented as "a row hover, a field, a nested
   * tile" and was used as a hover on exactly zero surfaces, so a shelf of leagues you are meant
   * to compare and then act on sat as still as a page of terms. That is a large part of what
   * "it feels like a legal website" was describing.
   */
  it("acknowledges the pointer when the thing inside is one you act on", async () => {
    await renderSurface(
      <Card interactive aria-label="Open league">
        <p>Row</p>
      </Card>,
      ({ container }) => {
        const card = container.querySelector("[aria-label='Open league']")!;
        expect(card.className).toContain("hover:bg-surface-raised");
      },
    );
  });

  it("gives the keyboard the same response as the pointer", async () => {
    // A card whose action is reachable only by Tab must lift for that too, or the hover is an
    // affordance only a mouse ever sees.
    await renderSurface(
      <Card interactive aria-label="Open league">
        <button type="button">Take a seat</button>
      </Card>,
      ({ container }) => {
        expect(container.querySelector("[aria-label='Open league']")!.className).toContain("focus-within:bg-surface-raised");
      },
    );
  });

  it("earns its place with depth, never with a heavier line — rule 4 did not move", async () => {
    // The whole point of the amendment is that a card is still not a box. Depth is the four-step
    // surface model doing its job; `edge` is a CONTROL boundary and a card is not a control.
    await renderSurface(
      <Card interactive aria-label="Open league">
        <p>Row</p>
      </Card>,
      ({ container }) => {
        const card = container.querySelector("[aria-label='Open league']")!;
        expect(card.className).toContain("border-line");
        expect(card.className).not.toContain("border-edge");
        expect(card.className).not.toContain("border-2");
      },
    );
  });

  it("never becomes the control itself, so the view's one ink action stays inside it", async () => {
    // Rule 5 survives the amendment only if the card is a surface and the action is a real
    // control within it. A card that took a role and a tabindex of its own would swallow its
    // own button, and every shelf would grow a second, invisible click target.
    await renderSurface(
      <Card interactive aria-label="Open league">
        <button type="button">Take a seat</button>
      </Card>,
      async ({ container }) => {
        const card = container.querySelector("[aria-label='Open league']")!;
        expect(card.getAttribute("role")).toBeNull();
        expect(card.getAttribute("tabindex")).toBeNull();
        expect(screen.getByRole("button", { name: "Take a seat" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  /**
   * ONE PADDING DECLARATION, CHOSEN BY NAME. `compact` exists for a card that is also a ROW in a
   * dense list (Task 8's player pool: sixty of them in a 320px rail). The first cut left `p-4` in
   * the base class and layered `px-2 py-1.5` on top, which only resolves correctly if Tailwind
   * reliably emits every shorthand ahead of its longhands — a bet on stylesheet ORDER, settled by
   * the framework's sort rather than by anything the component says. This asserts the two options
   * never both reach the element, so no future sort can decide a card's padding for us.
   */
  it("gives a compact card exactly one padding, and never the comfortable one underneath it", async () => {
    await renderSurface(
      <Card padding="compact" aria-label="Pool row">
        <p>Row</p>
      </Card>,
      ({ container }) => {
        const card = container.querySelector("[aria-label='Pool row']")!;
        expect(card.className).toMatch(/(^|\s)px-2(\s|$)/);
        expect(card.className).not.toMatch(/(^|\s)p-4(\s|$)/);
      },
    );
  });

  it("keeps the panel padding for every caller that does not ask for anything else", async () => {
    await renderSurface(
      <Card aria-label="Standings">
        <p>Row</p>
      </Card>,
      ({ container }) => {
        expect(container.querySelector("[aria-label='Standings']")!.className).toMatch(/(^|\s)p-4(\s|$)/);
      },
    );
  });

  it("stays perfectly still when nothing inside is yours to act on", async () => {
    // A panel you read is the default. A card that lifts under the pointer with nothing to press
    // is decoration, and rule 6 rejects it.
    await renderSurface(
      <Card aria-label="Standings">
        <p>Row</p>
      </Card>,
      ({ container }) => {
        const card = container.querySelector("[aria-label='Standings']")!;
        expect(card.className).not.toContain("hover:");
        expect(card.className).not.toContain("focus-within:");
      },
    );
  });
});
