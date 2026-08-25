import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { PaidJoinConfirmation } from "./paid-join-confirmation";

/**
 * Phase 4, Task 13. No league on this platform can reach this component while `moneyIsLive()`
 * stays false — every assertion below exercises it through injected props, ahead of the day a
 * real fee and a real balance do.
 */
describe("PaidJoinConfirmation", () => {
  it("states the fee, the balance after, and the refund rule in three sentences", () => {
    render(
      <PaidJoinConfirmation entryFeeUsd="$50.00" balanceAfterUsd="$70.00" stateOfEntry={null} onStateOfEntryChange={() => {}} />,
    );
    expect(screen.getByText("This league charges $50.00 to join.")).toBeInTheDocument();
    const balance = screen.getByText("$70.00");
    expect(balance.className).toContain("text-positive");
    expect(
      screen.getByText("Refunded in full if you leave before the draft or the league dissolves before it starts."),
    ).toBeInTheDocument();
  });

  it("renders whatever balance-after string it is given, honestly, even a negative one", () => {
    render(
      <PaidJoinConfirmation entryFeeUsd="$50.00" balanceAfterUsd="-$30.00" stateOfEntry={null} onStateOfEntryChange={() => {}} />,
    );
    expect(screen.getByText("-$30.00")).toBeInTheDocument();
  });

  it("asks the state of entry, and reports the chosen state upward", async () => {
    const user = userEvent.setup();
    const onStateOfEntryChange = vi.fn();
    render(
      <PaidJoinConfirmation
        entryFeeUsd="$50.00"
        balanceAfterUsd="$70.00"
        stateOfEntry={null}
        onStateOfEntryChange={onStateOfEntryChange}
      />,
    );
    await user.selectOptions(screen.getByLabelText("State of entry"), "TX");
    expect(onStateOfEntryChange).toHaveBeenCalledWith("TX");
  });

  it("carries the caller's own chosen state as the select's value", () => {
    render(
      <PaidJoinConfirmation entryFeeUsd="$50.00" balanceAfterUsd="$70.00" stateOfEntry="TX" onStateOfEntryChange={() => {}} />,
    );
    expect(screen.getByLabelText("State of entry")).toHaveValue("TX");
  });

  it("is axe-clean", async () => {
    const { container } = render(
      <PaidJoinConfirmation entryFeeUsd="$50.00" balanceAfterUsd="$70.00" stateOfEntry={null} onStateOfEntryChange={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
