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

/**
 * The one place this product writes to who a signed-in user is. On success it calls
 * `router.refresh()` rather than a full reload, so `AppHeader` — a Server Component reading the
 * same `users` row — picks up the new name and face without losing client state elsewhere on
 * the page.
 */
export function ProfileForm({ profile }: { readonly profile: ProfileBody }) {
  const router = useRouter();
  const { fetchJson } = useAccountRoomDeps();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [experienceTier, setExperienceTier] = useState<ExperienceTier>(profile.experienceTier);
  const [avatarPreset, setAvatarPreset] = useState<AvatarPresetKey | null>(profile.avatarPreset);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetchJson("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName, experienceTier, avatarPreset }),
      });
      const body = (await response.json()) as ApiEnvelope<ProfileBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setSaved(true);
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
        <span role="status" className="text-sm text-positive">
          {saved ? "Saved." : ""}
        </span>
      </div>
    </form>
  );
}
