"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";
import { HELP_LEVEL_LABEL } from "@/identity/config";
import type { HelpLevel, PreferenceState } from "@/identity/preferences";
import type { ApiEnvelope } from "@/lib/api/respond";
import { useAccountRoomDeps } from "../hooks/deps";

const HELP_LEVEL_OPTIONS = (["guided", "standard"] as const).map((level) => ({
  value: level,
  label: HELP_LEVEL_LABEL[level] ?? level,
}));

function isHelpLevel(value: string): value is HelpLevel {
  return value === "guided" || value === "standard";
}

/**
 * The control that makes `helpLevel` reachable by the person it describes. Until this existed,
 * the column was written once at seed time from `experienceTier` and never again by any
 * production code path, so every account sat on the `beginner` default's `guided` forever and
 * `InfoTip`'s `standard` branch was dead in production.
 *
 * Saves on change rather than behind a Save button: one control, one decision, and the effect
 * (`InfoTip`s appearing or going quiet) shows up on the next page the user opens, which is what
 * `router.refresh()` is for. A failure is stated, never swallowed — the same rule
 * `ProfileForm` follows, and the opposite of `RoomTour`'s deliberately fire-and-forget dismissal.
 */
export function HelpLevelForm({ helpLevel }: { readonly helpLevel: HelpLevel }) {
  const router = useRouter();
  const { fetchJson } = useAccountRoomDeps();
  const [value, setValue] = useState<HelpLevel>(helpLevel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (next: HelpLevel): Promise<void> => {
    setValue(next);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetchJson("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ helpLevel: next }),
      });
      const body = (await response.json()) as ApiEnvelope<PreferenceState>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setValue(body.data.helpLevel);
      setSaved(true);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Select
        label="How much help"
        hint="More help explains fantasy terms as you go. The basics keeps the screens quiet."
        options={HELP_LEVEL_OPTIONS}
        value={value}
        disabled={saving}
        onChange={(event) => {
          if (isHelpLevel(event.target.value)) void save(event.target.value);
        }}
      />
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <span role="status" className="text-sm text-positive">
        {saved ? "Saved." : ""}
      </span>
    </div>
  );
}
