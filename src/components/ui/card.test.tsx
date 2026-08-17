import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Card } from "./card";
import { inBothThemes } from "./test-utils";

describe("Card", () => {
  it("renders children as the requested element, both themes, no axe violations", async () => {
    await inBothThemes(
      <Card as="section" aria-label="Standings">
        <p>Row</p>
      </Card>,
      async ({ container }) => {
        expect(screen.getByRole("region", { name: "Standings" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
