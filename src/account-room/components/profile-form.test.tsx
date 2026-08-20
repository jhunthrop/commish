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

  // Persona review (first-timer, FIX 2): the experience question landed with no explanation of
  // why the product is asking. The hint is deliberately conservative — help-level behavior
  // driven by this field arrives later in this plan — but a first-timer should never wonder
  // why they're being asked at all.
  it("explains why the product asks for experience level", () => {
    renderInAccount(<ProfileForm profile={PROFILE} />, fixtureAccountDeps().deps);
    expect(
      screen.getByText("We use this to match you to leagues and to show you the right amount of help."),
    ).toBeInTheDocument();
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

  it("sends ONLY the changed field, so a stale tab cannot resurrect the others", async () => {
    // H4's client half. `updateProfile` has no version guard, so whatever this body carries is
    // written — a full-row body from a tab that loaded before someone else's rename puts the old
    // name back. Renaming here must produce a body with `displayName` and NOTHING else; the
    // decline-preserves-the-WorkOS-picture contract now holds by OMITTING `avatarPreset`
    // (`updateProfile` treats absent and null identically, see its SPARSE note) rather than by
    // sending a null the service has to interpret.
    const bodies: unknown[] = [];
    const fixture = fixtureAccountDeps({ ok: true, data: { ...PROFILE, displayName: "Ada B." } });
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async (url, init) => {
        bodies.push({ url, body: JSON.parse(String(init?.body)) });
        return { json: async () => fixture.response } as unknown as Response;
      },
    };
    renderInAccount(<ProfileForm profile={PROFILE} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Ada B." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ url: "/api/profile", body: { displayName: "Ada B." } });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("sends only avatarPreset for an avatar-only save", async () => {
    const bodies: unknown[] = [];
    const fixture = fixtureAccountDeps({ ok: true, data: { ...PROFILE, avatarPreset: "shield", avatar: "preset:shield" } });
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async (url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { json: async () => fixture.response } as unknown as Response;
      },
    };
    renderInAccount(<ProfileForm profile={PROFILE} />, fixture.deps);
    fireEvent.click(screen.getByRole("radio", { name: "Shield" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodies).toEqual([{ avatarPreset: "shield" }]));
  });

  it("re-baselines after a save, so a second Save sends nothing and asks for nothing", async () => {
    const bodies: unknown[] = [];
    const fixture = fixtureAccountDeps({ ok: true, data: { ...PROFILE, displayName: "Ada B." } });
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { json: async () => fixture.response } as unknown as Response;
      },
    };
    renderInAccount(<ProfileForm profile={PROFILE} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Ada B." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodies).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Nothing changed yet.")).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
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
    // Something has to be dirty for a request to exist at all — a clean form sends nothing.
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Ada B." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  });
});
