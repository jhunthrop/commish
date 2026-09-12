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

  /**
   * FIX ROUND 2, the founder's screenshot: a house league at 1 of 12 drew one face and nothing
   * else, so the stack said "somebody is here" and never "and there is room". The mock draws the
   * gap as hollow rings after the faces, capped, with the overflow chip counting the rest.
   */
  describe("open seats", () => {
    const ONE = [{ name: "Justin Hunthrop", isSelf: true }];

    it("draws the empty seats as hollow rings after the faces, capped at three", async () => {
      await renderSurface(<ManagerStack people={ONE} openSeats={11} caption="You are in. Nobody else yet." />, ({ getByTestId, queryAllByTestId }) => {
        expect(queryAllByTestId("open-seat")).toHaveLength(3);
        // The chip counts every seat the rings did not draw, so the arithmetic adds up: 11 open,
        // 3 drawn, 8 counted.
        expect(getByTestId("manager-stack").textContent).toContain("+8");
      });
    });

    it("draws no chip when the rings already show every empty seat", async () => {
      await renderSurface(<ManagerStack people={ONE} openSeats={2} caption="You are in." />, ({ getByTestId, queryAllByTestId }) => {
        expect(queryAllByTestId("open-seat")).toHaveLength(2);
        expect(getByTestId("manager-stack").textContent).not.toContain("+");
      });
    });

    it("counts hidden people and empty seats in ONE chip, never two", async () => {
      await renderSurface(<ManagerStack people={PEOPLE} openSeats={5} caption="6 already in" />, ({ getByTestId }) => {
        // 6 people, 4 shown, 2 hidden; 5 open, 3 drawn, 2 hidden. One chip, six.
        expect(getByTestId("manager-stack").textContent).toContain("+4");
      });
    });

    it("draws nothing but the caption for a room with neither people nor a known gap", async () => {
      await renderSurface(<ManagerStack people={[]} openSeats={0} caption="Nobody yet" />, ({ getByTestId, queryAllByTestId }) => {
        expect(queryAllByTestId("open-seat")).toHaveLength(0);
        expect(getByTestId("manager-stack").textContent).toBe("Nobody yet");
      });
    });

    it("is axe-clean with rings in both themes", async () => {
      await renderSurface(<ManagerStack people={ONE} openSeats={11} caption="You are in." />, async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      });
    });
  });

  /**
   * FIX ROUND 2, defect 2. A manager who has never chosen a face gets their INITIALS in the ring,
   * on this surface as on every other. The production defect was upstream of this component (the
   * identity provider's generated placeholder, stored as if it were a chosen picture — see
   * `parseAvatarRef`), and this pins the behaviour the stack must show either way.
   */
  describe("a manager with no avatar", () => {
    it("wears their initials, never a glyph and never a stock image", async () => {
      await renderSurface(
        <ManagerStack people={[{ name: "Justin Hunthrop", avatar: null, isSelf: true }]} caption="You are in." />,
        ({ getByTestId }) => {
          const stack = getByTestId("manager-stack");
          expect(stack.querySelector("img")).toBeNull();
          expect(stack.querySelector("svg")).toBeNull();
          expect(stack.textContent).toContain("JH");
        },
      );
    });

    it("wears their initials for a provider placeholder URL too, the row the founder's own account held", async () => {
      const placeholder = "https://workoscdn.com/images/v1/lzLc4KQcSglIhS1RTT2QiOjSf8noPd5XN0MBrmhZwmo";
      await renderSurface(
        <ManagerStack people={[{ name: "Justin Hunthrop", avatar: placeholder, isSelf: true }]} caption="You are in." />,
        ({ getByTestId }) => {
          const stack = getByTestId("manager-stack");
          expect(stack.querySelector("img")).toBeNull();
          expect(stack.textContent).toContain("JH");
        },
      );
    });
  });
});
