"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ExperienceTier } from "@/domain/user";
import { EXPERIENCE_TIER_LABEL } from "@/identity/config";
import type { AvatarPresetKey } from "@/identity";
import { Button, Input, Select } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { ProfileBody } from "../contract";
import { useAccountRoomDeps } from "../hooks/deps";
import { AvatarPicker } from "./avatar-picker";

const TIER_OPTIONS = (["beginner", "experienced"] as const).map((tier) => ({
  value: tier,
  label: EXPERIENCE_TIER_LABEL[tier],
}));

function isExperienceTier(value: string): value is ExperienceTier {
  return value === "beginner" || value === "experienced";
}

/** Which caller is rendering `ProfileForm` — Task 17: mechanical only, per its own rule (heading
 *  and density are the ONLY things that differ). `"page"` (the default) is `/app/profile`'s own
 *  rendering, byte-identical to before this variant existed: no heading of its own, since
 *  `ProfilePage` already renders `<PageTitle>Your profile</PageTitle>` above it. `"first-run"` is
 *  `FirstRunPanel`'s identity card (Task 17, Step 2): the fields, the validation, the endpoint
 *  and the success copy are the exact same `ProfileForm`, never a second form A18 would have to
 *  find and retone twice. */
export type ProfileFormVariant = "page" | "first-run";

/** The identity card's own heading, matching the `h3` weight and color every other first-run
 *  path card already uses (`FirstRunPanel`'s `FirstRunPathAction` siblings) — this is the first
 *  card in that list, not a differently-styled one. Exported so `FirstRunPanel` can give the
 *  `Card` wrapping this form the SAME string as its own `aria-label`, one source rather than two
 *  literals that could drift. */
export const PROFILE_FORM_FIRST_RUN_HEADING = "Set up your manager profile";

/** Why the experience question matters, first-run only — the page variant leaves this unsaid
 *  because a returning manager already has an answer on file; a brand-new one has never been
 *  told the fork exists at all (Task 17, Step 1's third test). Placed above the fields rather
 *  than folded into the `Select`'s own `hint`, which stays exactly as it reads on `/app/profile`
 *  per this component's own rule against touching field copy between variants. */
const FIRST_RUN_EXPERIENCE_EXPLAINER = "Some leagues are kept for newer players. Your answer here decides which ones you see.";

/** What a sparse `PATCH /api/profile` body may carry. Absent key means "don't touch it". */
interface ProfilePatch {
  readonly displayName?: string;
  readonly experienceTier?: ExperienceTier;
  readonly avatarPreset?: AvatarPresetKey | null;
}

/**
 * Only what CHANGED since the last known-good server state. A full-row body from a tab that
 * loaded an hour ago resurrects whatever it is still holding, because `updateProfile` has no
 * version guard — so the avatar-only save sends `{ avatarPreset }` and nothing else, and a
 * concurrently-changed display name survives it.
 */
function dirtyFields(baseline: ProfileBody, draft: Required<ProfilePatch>): ProfilePatch {
  return {
    ...(draft.displayName === baseline.displayName ? {} : { displayName: draft.displayName }),
    ...(draft.experienceTier === baseline.experienceTier ? {} : { experienceTier: draft.experienceTier }),
    ...(draft.avatarPreset === baseline.avatarPreset ? {} : { avatarPreset: draft.avatarPreset }),
  };
}

/**
 * The one place this product writes to who a signed-in user is. On success it calls
 * `router.refresh()` rather than a full reload, so `TopBar` — a Server Component reading the
 * same `users` row — picks up the new name and face without losing client state elsewhere on
 * the page.
 *
 * `baseline` is the last state the SERVER confirmed, not the mount-time prop: it starts at
 * `profile` and moves to whatever a successful PATCH returns, so a second Save re-sends nothing
 * the first one already wrote.
 */
export function ProfileForm({
  profile,
  variant = "page",
}: {
  readonly profile: ProfileBody;
  readonly variant?: ProfileFormVariant;
}) {
  const isFirstRun = variant === "first-run";
  const router = useRouter();
  const { fetchJson } = useAccountRoomDeps();
  const [baseline, setBaseline] = useState<ProfileBody>(profile);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [experienceTier, setExperienceTier] = useState<ExperienceTier>(profile.experienceTier);
  const [avatarPreset, setAvatarPreset] = useState<AvatarPresetKey | null>(profile.avatarPreset);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ readonly text: string; readonly saved: boolean } | null>(null);

  const submit = async (): Promise<void> => {
    const changes = dirtyFields(baseline, { displayName, experienceTier, avatarPreset });
    if (Object.keys(changes).length === 0) {
      setStatus({ text: "Nothing changed yet.", saved: false });
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetchJson("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      const body = (await response.json()) as ApiEnvelope<ProfileBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setBaseline(body.data);
      setStatus({ text: "Saved.", saved: true });
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className={`flex flex-col ${isFirstRun ? "gap-3" : "gap-4"}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {isFirstRun ? (
        <div>
          <h3 className="font-medium text-text-primary">{PROFILE_FORM_FIRST_RUN_HEADING}</h3>
          <p className="text-sm text-text-muted">{FIRST_RUN_EXPERIENCE_EXPLAINER}</p>
        </div>
      ) : null}
      <AvatarPicker displayName={displayName} value={avatarPreset} onChange={setAvatarPreset} />

      <Input
        label="Display name"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        error={error ?? undefined}
      />

      <Select
        label="Experience"
        hint="We use this to match you to leagues and to show you the right amount of help."
        options={TIER_OPTIONS}
        value={experienceTier}
        onChange={(event) => {
          if (isExperienceTier(event.target.value)) setExperienceTier(event.target.value);
        }}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" loading={saving} disabled={saving}>
          Save
        </Button>
        <span role="status" className={`text-sm ${status?.saved === true ? "text-positive" : "text-text-muted"}`}>
          {status?.text ?? ""}
        </span>
      </div>
    </form>
  );
}
