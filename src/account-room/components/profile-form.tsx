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
 * `router.refresh()` rather than a full reload, so `AppHeader` — a Server Component reading the
 * same `users` row — picks up the new name and face without losing client state elsewhere on
 * the page.
 *
 * `baseline` is the last state the SERVER confirmed, not the mount-time prop: it starts at
 * `profile` and moves to whatever a successful PATCH returns, so a second Save re-sends nothing
 * the first one already wrote.
 */
export function ProfileForm({ profile }: { readonly profile: ProfileBody }) {
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
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
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
