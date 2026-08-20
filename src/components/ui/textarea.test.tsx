import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { axe } from "vitest-axe";
import { REVIEW_CONFIG } from "@/reviews/config";
import { Textarea } from "./textarea";
import { inBothThemes } from "./test-utils";

function ControlledTextarea(props: { readonly maxLength?: number; readonly initial?: string }) {
  const [value, setValue] = useState(props.initial ?? "");
  return <Textarea label="Your review" maxLength={props.maxLength} value={value} onChange={(event) => setValue(event.target.value)} />;
}

describe("Textarea", () => {
  it("has a visible label associated with the control, both themes, no axe violations", async () => {
    await inBothThemes(<Textarea label="Your review" />, async ({ container }) => {
      expect(screen.getByLabelText("Your review")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("links error text via aria-describedby and sets aria-invalid", () => {
    render(<Textarea label="Your review" error="Say a little more." />);
    const textarea = screen.getByLabelText("Your review");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    const describedBy = textarea.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!.split(" ")[0]!)?.textContent).toBe("Say a little more.");
  });

  it("shows a hint when provided", () => {
    render(<Textarea label="Your review" hint="Be specific about what happened." />);
    expect(screen.getByText("Be specific about what happened.")).toBeInTheDocument();
  });

  it("renders no character count when maxLength is omitted", () => {
    render(<Textarea label="Your review" />);
    expect(screen.queryByText(/characters left/)).not.toBeInTheDocument();
  });

  it("shows a live remaining-character count wired to the field via aria-describedby, announced politely", () => {
    render(<ControlledTextarea maxLength={20} />);
    const textarea = screen.getByLabelText("Your review");
    const describedBy = textarea.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    expect(screen.getByText("20 characters left")).toBeInTheDocument();
    const countNode = screen.getByText("20 characters left");
    expect(countNode).toHaveAttribute("aria-live", "polite");
    expect(describedBy!.split(" ")).toContain(countNode.id);

    fireEvent.change(textarea, { target: { value: "Great league" } });
    expect(screen.getByText("8 characters left")).toBeInTheDocument();
  });

  it("counts past the limit as over, not negative", () => {
    render(<ControlledTextarea maxLength={5} initial="Way too long for this box" />);
    expect(screen.getByText(/over the limit/)).toBeInTheDocument();
  });

  it("counts down to exactly zero at the review body's own configured ceiling", () => {
    // The name used to claim this "reads validateReviewDraft's own length window" while the body
    // hardcoded 1000 and imported no config at all — so a change to the ceiling would have left
    // this green and the claim false. It now reads the same constant the composer passes.
    // (The composer's wiring through `validateReviewDraft` is review-composer.test.tsx's job;
    // this proves the count is exact at the boundary.)
    const max = REVIEW_CONFIG.body.maxLength;
    render(<ControlledTextarea maxLength={max} initial={"x".repeat(max)} />);
    expect(screen.getByText("0 characters left")).toBeInTheDocument();
  });
});
