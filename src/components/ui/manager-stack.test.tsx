import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ManagerStack } from "./manager-stack";
import { renderSurface } from "./test-utils";

const PEOPLE = [
  { name: "Dana Whitfield" },
  { name: "Rey Okafor" },
  { name: "Coach Parker" },
  { name: "Jordan Tate" },
  { name: "Maya Kerr" },
  { name: "Alex Lin" },
];

describe("ManagerStack", () => {
  it("shows at most `max` faces and counts the rest, in both themes", async () => {
    await renderSurface(<ManagerStack people={PEOPLE} caption="6 already in" />, ({ getByTestId }) => {
      const stack = getByTestId("manager-stack");
      expect(stack.textContent).toContain("+2");
      expect(stack.textContent).toContain("6 already in");
    });
  });

  it("never shows an overflow chip when every person fits", async () => {
    await renderSurface(<ManagerStack people={PEOPLE.slice(0, 3)} caption="3 already in" />, ({ getByTestId }) => {
      expect(getByTestId("manager-stack").textContent).not.toContain("+");
    });
  });

  it("rings your own face in amber, and nobody else's", async () => {
    const mine = [{ name: "Dana Whitfield", isSelf: true }, { name: "Rey Okafor" }];
    await renderSurface(<ManagerStack people={mine} caption="2 already in" />, ({ container }) => {
      // `self` is Sideline's fourth chroma, and "yours" is the one job it was split out for.
      expect(container.querySelectorAll('[data-ring="self"]')).toHaveLength(1);
    });
  });

  it("renders nothing but the caption for an empty room — absence, never invented circles", async () => {
    await renderSurface(<ManagerStack people={[]} caption="Nobody yet" />, ({ getByTestId }) => {
      const stack = getByTestId("manager-stack");
      expect(stack.querySelector("img")).toBeNull();
      expect(stack.textContent).toBe("Nobody yet");
    });
  });

  it("puts the whole announcement in the caption, never in four unlabelled avatars", async () => {
    await renderSurface(<ManagerStack people={PEOPLE} caption="6 already in" />, ({ container }) => {
      // P1 is satisfied by the sentence: an overlapping stack read one avatar at a time is a
      // pile of images, so the faces stay decorative and the words carry the meaning.
      for (const hidden of Array.from(container.querySelectorAll("[aria-hidden]"))) {
        expect(hidden).toHaveAttribute("aria-hidden", "true");
      }
      expect(screen.getByText("6 already in")).toBeInTheDocument();
    });
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(<ManagerStack people={PEOPLE} caption="6 already in" />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
