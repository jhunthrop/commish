import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { OperatorTool } from "./operator-tool";

describe("OperatorTool", () => {
  it("names the tool as the page's own h1 and states its intent once", async () => {
    await renderSurface(
      <OperatorTool title="Held payouts" intent="Resolve a payout held at settlement.">
        <p>control</p>
      </OperatorTool>,
      ({ getByRole, getByText }) => {
        expect(getByRole("heading", { level: 1 })).toHaveTextContent("Held payouts");
        expect(getByText("Resolve a payout held at settlement.")).toBeInTheDocument();
      },
    );
  });

  it("bounds the work area, so a field cannot claim the whole content column", async () => {
    // LAW 4 ON A TOOL. A field's width is a claim about how much to type, and every one of these
    // pages used to render a thirty-character user id into a 1300px box. The measure is set here
    // once rather than at five call sites that would drift apart; asserting the class is what
    // stops the next author dropping it from one page and not noticing.
    await renderSurface(
      <OperatorTool title="Held payouts" intent="One line.">
        <input aria-label="Member id" />
      </OperatorTool>,
      ({ getByRole }) => {
        const work = getByRole("textbox").closest("section");
        expect(work?.className).toContain("max-w-xl");
      },
    );
  });

  it("spends no drama on an operator surface: no accent fill, no hero number, no motion, nothing live", async () => {
    // The restraint ruling on this route group, as a test: "Sunday's tokens, faces and registers
    // apply; its drama does not." The spellings below are the ways drama has actually arrived on
    // a surface in this product — a money-filled verb, a display-scale figure, and a transition —
    // plus the one Sunday v5 adds: the LIVE channel, which means happening right now and nothing
    // else ever, and nothing on an operator surface ever is. A page that needs one of them is not
    // this component's caller.
    await renderSurface(
      <OperatorTool title="Money reconciliation" intent="One line.">
        <p>control</p>
      </OperatorTool>,
      ({ container }) => {
        const frame = container.querySelector("section")?.className ?? "";
        expect(frame).not.toMatch(/bg-accent|text-display-(xl|2xl|3xl)|transition|-live/);
      },
    );
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(
      <OperatorTool title="Self exclusion" intent="One line.">
        <p>control</p>
      </OperatorTool>,
      async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
