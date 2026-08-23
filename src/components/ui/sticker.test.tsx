import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { positionStickerClass } from "./position-badge";
import { Sticker } from "./sticker";

describe("Sticker", () => {
  it("wears its position's pigment from the one sanctioned source, in both themes, axe-clean", async () => {
    await renderSurface(
      <Sticker position="QB" className="px-2">
        <p>Trey Ward</p>
      </Sticker>,
      async ({ container }) => {
        const sticker = screen.getByText("Trey Ward").parentElement!;
        for (const cls of positionStickerClass("QB").split(" ")) {
          expect(sticker.className).toContain(cls);
        }
        expect(sticker.className).toContain("shadow-sticker");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("lets the call site add layout classes without touching pigment or shape", () => {
    render(
      <Sticker position="DEF" className="flex h-full px-3">
        <p>TB Defense</p>
      </Sticker>,
    );
    const sticker = screen.getByText("TB Defense").parentElement!;
    expect(sticker.className).toContain("px-3");
    expect(sticker.className).toContain("rounded-sm");
    for (const cls of positionStickerClass("DEF").split(" ")) {
      expect(sticker.className).toContain(cls);
    }
  });
});
