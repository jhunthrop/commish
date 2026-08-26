"use client";

import { useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { CreateMockRoomBody } from "@/app/api/mock-drafts/route";
import type { MockMode } from "@/mock-draft/config";
import { Button, Input, Select } from "@/components/ui";
import { formatOrdinal } from "@/draft-room/state/format";
import { ROSTER_SHAPE_LABEL } from "@/domain/roster";
import { useLeagueRoomDeps } from "../hooks/deps";
import { PRESETS } from "./create-league-form";

/** "" means random (the silent server-side draw, `createMockRoomSchema`'s own default). Any
 *  other value is a 1-based slot number, as a string, the same string-state idiom every other
 *  numeric `<Select>` in this form already keeps (`teamCount`, `pickSeconds`). */
const RANDOM_DRAFT_SLOT = "";

/** `["", "1", "2", ..., String(teamCount)]`'s options — "Random" first (the default, matching
 *  the schema's own silence), then one "Pick Nth" per slot the CURRENTLY chosen team count
 *  offers (founder directive 2026-08-26: "users should be able to select their draft
 *  position"). Recomputed from `teamCount` on every render rather than from
 *  `MOCK_CONFIG.teamCountOptions`'s widest room, so shrinking Teams shrinks this list too. */
function draftSlotOptions(teamCount: number): readonly { readonly value: string; readonly label: string }[] {
  return [
    { value: RANDOM_DRAFT_SLOT, label: "Random" },
    ...Array.from({ length: teamCount }, (_, i) => i + 1).map((slot) => ({ value: String(slot), label: `Pick ${formatOrdinal(slot)}` })),
  ];
}

/**
 * Words for the three modes — this component's own, not `MOCK_COPY` (`src/league-room/**` may
 * not value-import `@/mock-draft`, the client boundary): a mode NAME is not one of the pre-vetted
 * room-facing sentences that module exists to guard, the same reason `CreateLeagueForm`'s own
 * `FORMATS`/`VISIBILITIES` labels are typed fresh here rather than threaded from anywhere.
 */
const MODE_LABEL: Readonly<Record<MockMode, string>> = {
  solo: "Solo, play against bots",
  lobby: "Lobby, open for anyone to join",
  link: "Private link, invite by code",
};

/** The identical inline construction `CreateLeagueForm`'s own `ROSTER_SHAPE_OPTIONS` uses —
 *  `@/domain/roster` is the browser-safe half every client room may value-import. */
const ROSTER_SHAPE_OPTIONS = Object.entries(ROSTER_SHAPE_LABEL).map(([value, label]) => ({ value, label }));

export interface MockSetupFormProps {
  /** `MOCK_CONFIG.modes`, threaded from the server page (ruling 8) — `@/mock-draft` itself is
   *  blocked from this directory. */
  readonly modes: readonly MockMode[];
  /** `MOCK_CONFIG.teamCountOptions`. */
  readonly teamCountOptions: readonly number[];
  /** `MOCK_CONFIG.pickClockSecondsOptions`. */
  readonly pickSecondsOptions: readonly number[];
  readonly defaultTeamCount: number;
  readonly defaultPickSeconds: number;
  /** Called once with the created room's wire body — the caller (`MockLobby`) owns navigation,
   *  the identical split `CreateLeaguePanel`/`CreateLeagueForm` already keep. */
  readonly onCreated: (created: CreateMockRoomBody) => void;
}

/**
 * The practice lobby's own creation form (Task 9, Step 2): mode, team count and pick clock from
 * `MOCK_CONFIG`'s own options (never a parallel picker), scoring and roster shape reusing
 * `CreateLeagueForm`'s existing option vocabulary — the SAME `PRESETS` table and the SAME
 * `ROSTER_SHAPE_LABEL` map a real league's own create form reads, since a mock shares this whole
 * vocabulary with a real league (`createMockRoomSchema`'s `scoringPreset`/`rosterShape` are the
 * identical enums). One ink action: "Start mock draft" is this page's only primary button,
 * the same one-ink-per-view budget (rule 5) the front door and browse both hold to.
 */
export function MockSetupForm({
  modes,
  teamCountOptions,
  pickSecondsOptions,
  defaultTeamCount,
  defaultPickSeconds,
  onCreated,
}: MockSetupFormProps) {
  const { fetchJson } = useLeagueRoomDeps();
  const [mode, setMode] = useState<MockMode>(modes[0] ?? "solo");
  const [teamCount, setTeamCount] = useState(String(defaultTeamCount));
  const [pickSeconds, setPickSeconds] = useState(String(defaultPickSeconds));
  // `half_ppr`/`standard` — the identical defaults `CreateLeagueForm`'s own local state opens
  // with (`LEAGUE_CONFIG.defaults`), which this client component may not value-import.
  const [scoringPreset, setScoringPreset] = useState("half_ppr");
  const [rosterShape, setRosterShape] = useState("standard");
  // "" (`RANDOM_DRAFT_SLOT`) is the default — the silent server-side draw
  // `createMockRoomSchema.draftSlot` already falls back to when omitted. Founder directive
  // 2026-08-26: "users should be able to select their draft position."
  const [draftSlot, setDraftSlot] = useState(RANDOM_DRAFT_SLOT);
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Shrinking Teams can strand a chosen slot above the new ceiling (picking 10th, then
   *  dropping to 8 teams) — reset to Random rather than clamp, so the reader never sees a
   *  silently renumbered choice they never made. */
  const changeTeamCount = (value: string): void => {
    setTeamCount(value);
    if (draftSlot !== RANDOM_DRAFT_SLOT && Number(draftSlot) > Number(value)) setDraftSlot(RANDOM_DRAFT_SLOT);
  };

  /** The founder's own follow-up: "we should also have a randomize button that randomizes for
   *  them." A plain `Math.random()` roll is fine here — this sets a value the person SEES and
   *  can still change before submitting, not a step in the seeded draw itself (the replay law
   *  binds the bot/draw streams `deps.random`/`deps.newSeed` feed, never a form control). */
  const randomize = (): void => {
    const max = Number(teamCount);
    setDraftSlot(String(Math.floor(Math.random() * max) + 1));
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson("/api/mock-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          teamCount: Number(teamCount),
          pickSeconds: Number(pickSeconds),
          scoringPreset,
          rosterShape,
          ...(teamName.trim().length > 0 ? { teamName: teamName.trim() } : {}),
          ...(draftSlot !== RANDOM_DRAFT_SLOT ? { draftSlot: Number(draftSlot) } : {}),
        }),
      });
      const body = (await response.json()) as ApiEnvelope<CreateMockRoomBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      onCreated(body.data);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Select
        label="Mode"
        options={modes.map((value) => ({ value, label: MODE_LABEL[value] }))}
        value={mode}
        onChange={(event) => setMode(event.target.value as MockMode)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Teams"
          options={teamCountOptions.map((n) => ({ value: String(n), label: `${n} teams` }))}
          value={teamCount}
          onChange={(event) => changeTeamCount(event.target.value)}
        />
        <Select
          label="Pick clock"
          options={pickSecondsOptions.map((n) => ({ value: String(n), label: `${n} seconds` }))}
          value={pickSeconds}
          onChange={(event) => setPickSeconds(event.target.value)}
        />
        <Select label="Scoring" options={PRESETS} value={scoringPreset} onChange={(event) => setScoringPreset(event.target.value)} />
        <Select
          label="Roster shape"
          options={ROSTER_SHAPE_OPTIONS}
          value={rosterShape}
          onChange={(event) => setRosterShape(event.target.value)}
        />
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Select
            label="Draft position"
            options={draftSlotOptions(Number(teamCount))}
            value={draftSlot}
            onChange={(event) => setDraftSlot(event.target.value)}
          />
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={randomize}>
          Randomize
        </Button>
      </div>
      <Input label="Team name (optional)" value={teamName} onChange={(event) => setTeamName(event.target.value)} />
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <Button type="submit" loading={submitting} disabled={submitting}>
        Start mock draft
      </Button>
    </form>
  );
}
