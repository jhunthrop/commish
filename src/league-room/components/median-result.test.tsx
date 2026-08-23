import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { MedianResultLine } from "./median-result";

describe("MedianResultLine", () => {
  it("says the exact sentence for the viewer's own team's win, in both themes, axe-clean", async () => {
    await inBothThemes(
      <MedianResultLine teamName="Bay Bandits" isMine score={118.4} medianScore={104.2} result="win" />,
      async ({ container }) => {
        expect(
          screen.getByText("You scored 118.40. The league median was 104.20, so you won that one too."),
        ).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("says the loss and tie variants for the viewer's own team", () => {
    const { rerender } = render(<MedianResultLine teamName="Bay Bandits" isMine score={90} medianScore={104.2} result="loss" />);
    expect(screen.getByText("You scored 90.00. The league median was 104.20, so you lost that one too.")).toBeInTheDocument();

    rerender(<MedianResultLine teamName="Bay Bandits" isMine score={104.2} medianScore={104.2} result="tie" />);
    expect(screen.getByText("You scored 104.20. The league median was 104.20, so you tied that one too.")).toBeInTheDocument();
  });

  it("names the team and uses third person for a team that is not the viewer's own", () => {
    render(<MedianResultLine teamName="Iron Owls" isMine={false} score={98.25} medianScore={104.2} result="loss" />);
    expect(
      screen.getByText("Iron Owls scored 98.25. The league median was 104.20, so they lost that one too."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^You /)).not.toBeInTheDocument();
  });
});
