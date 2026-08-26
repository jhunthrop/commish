import { describe, it, expect } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { PracticeBanner } from "./practice-banner";

const MESSAGE = "This is a practice draft. Nothing here counts, and this room clears itself after a day.";

describe("PracticeBanner", () => {
  it("renders exactly the message it is given, in both themes, axe-clean", async () => {
    await renderSurface(<PracticeBanner message={MESSAGE} />, async ({ getByTestId, container }) => {
      expect(getByTestId("practice-banner")).toHaveTextContent(MESSAGE);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
