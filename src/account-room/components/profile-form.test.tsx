import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { fixtureAccountDeps, renderInAccount, PROFILE } from "../test-fixtures";
import { AccountRoomDepsProvider } from "../hooks/deps";
import { ProfileForm } from "./profile-form";

const refresh = vi.fn();
// `ProfileForm` navigates via `next/navigation`'s `useRouter` after a successful save, which
// throws outside a mounted App Router. Stubbing the hook — not the component — keeps this a
// real render of `ProfileForm`'s own markup and logic, mirrors `JoinForm.test.tsx`.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

describe("ProfileForm", () => {
  it("shows the current name, tier and avatar picker, in both themes, axe-clean", async () => {
    const fixture = fixtureAccountDeps();
    await inBothThemes(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <ProfileForm profile={PROFILE} />
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByLabelText("Display name")).toHaveValue("Ada Lovelace");
        expect(screen.getByLabelText("Experience")).toHaveValue("beginner");
        expect(screen.getByRole("radiogroup", { name: "Avatar" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows plain-language copy for each experience tier, not the raw enum value", () => {
    renderInAccount(<ProfileForm profile={PROFILE} />, fixtureAccountDeps().deps);
    expect(screen.getByRole("option", { name: "New to fantasy" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Played before" })).toBeInTheDocument();
  });

  it("saves the edited name, tier and avatar, and refreshes the page", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { ...PROFILE, displayName: "Ada Byron", avatarPreset: "shield", avatar: "preset:shield" } });
    renderInAccount(<ProfileForm profile={PROFILE} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Ada Byron" } });
    fireEvent.change(screen.getByLabelText("Experience"), { target: { value: "experienced" } });
    fireEvent.click(screen.getByRole("radio", { name: "Shield" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fixture.calls).toEqual(["PATCH /api/profile"]));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("shows the server's reason without losing what was typed", async () => {
    const fixture = fixtureAccountDeps({ ok: false, error: "displayName: Your name needs at least 2 characters." });
    renderInAccount(<ProfileForm profile={PROFILE} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Your name needs at least 2 characters."));
    expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("A");
  });

  it("disables the button while the request is in flight", async () => {
    const fixture = fixtureAccountDeps();
    fixture.deps = { ...fixture.deps, fetchJson: () => new Promise(() => {}) };
    renderInAccount(<ProfileForm profile={PROFILE} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  });
});
