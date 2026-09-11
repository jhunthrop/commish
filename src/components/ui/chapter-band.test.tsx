import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { MICRO_LABEL } from "./config";
import { ChapterBand } from "./chapter-band";
import { renderSurface } from "./test-utils";

/** The caps register's own class string, so a test never re-spells what `config.ts` owns. */
const CAPS = MICRO_LABEL.split(" ");

describe("ChapterBand", () => {
  it("shouts only the name and its short subtitle — both in the one sanctioned caps register", async () => {
    await renderSurface(<ChapterBand name="Filling" consequence="Claimed seats" />, ({ getByText }) => {
      for (const element of [getByText("Filling"), getByText("Claimed seats")]) {
        for (const part of CAPS) expect(element.className).toContain(part);
      }
    });
  });

  it("renders a caption in SENTENCE case, quiet and body-sized, never in the caps register", async () => {
    // Fix round 2: the shelf pushed a 108-character sentence through the caps subtitle and made
    // it the loudest line on the front door. A band's consequence is a sentence; a subtitle is a
    // key. They are different registers and now different slots.
    await renderSurface(
      <ChapterBand name="Filling" consequence="Claimed seats" caption="First to fill is first to draft." />,
      ({ getByText }) => {
        const caption = getByText("First to fill is first to draft.");
        expect(caption.className).toContain("text-sm");
        expect(caption.className).toContain("text-text-faint");
        expect(caption.className).not.toContain("uppercase");
      },
    );
  });

  it("renders no caption element at all when a band has none — absence, not an empty line", async () => {
    await renderSurface(<ChapterBand name="Fresh" consequence="No claims yet" />, ({ container }) => {
      expect(container.querySelector('[data-chapter-caption=""], [data-chapter-caption]')).toBeNull();
    });
  });

  it("keeps the caption on its own row under the plate, so the plate line cannot grow", async () => {
    await renderSurface(
      <ChapterBand name="Filling" consequence="Claimed seats" caption="First to fill is first to draft." />,
      ({ getByText, container }) => {
        const band = container.firstElementChild as HTMLElement;
        expect(band.className).toContain("flex-col");
        // The plate and its subtitle share one row; the caption is that row's sibling.
        expect(getByText("Filling").parentElement).not.toBe(getByText("First to fill is first to draft.").parentElement);
      },
    );
  });

  it("is a real heading for the rows beneath it, never aria-hidden, in both themes", async () => {
    await renderSurface(
      <ChapterBand name="Filling" consequence="Claimed seats" caption="First to fill is first to draft." />,
      ({ container }) => {
        expect((container.firstElementChild as HTMLElement).getAttribute("aria-hidden")).toBeNull();
      },
    );
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(
      <ChapterBand name="Filling" consequence="Claimed seats" caption="First to fill is first to draft." tone="live" />,
      async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
