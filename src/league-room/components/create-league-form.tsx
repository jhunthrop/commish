"use client";

import { useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { CreateLeagueBody } from "../contract";
import { Button, Input, Select } from "@/components/ui";
import { LEAGUE_EXPERIENCE_TIER_HINT, LEAGUE_EXPERIENCE_TIER_LABEL } from "@/identity/config";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { useLeagueRoomDeps } from "../hooks/deps";

const FORMATS = [
  { value: "snake", label: "Snake" },
  { value: "auction", label: "Auction" },
];
const TEAM_COUNTS = [8, 10, 12, 14, 16].map((n) => ({ value: String(n), label: `${n} teams` }));
const PRESETS = [
  { value: "ppr", label: "PPR (a point per catch)" },
  { value: "half_ppr", label: "Half PPR" },
  { value: "standard", label: "Standard" },
  { value: "te_premium", label: "TE premium" },
];
const VISIBILITIES = [
  { value: "invite_only", label: "Invite only" },
  { value: "public", label: "Anyone can find and join" },
];
/**
 * WHO THE LEAGUE IS FOR, and the control the final review's own battery proved was missing.
 *
 * `createLeague` refuses a veteran opening a PUBLIC league declared `beginner`
 * (`tierJoinPrecondition`, ruling 6) and tells them "Open it to everyone instead" — and this form
 * carried no control that could do that, so the remedy the refusal named was unreachable and a
 * veteran could not create a public league at all. `experienced` leads and is the default because
 * it is the choice that refuses nobody: the only way to reach that refusal now is to pick the
 * reserved option on purpose.
 *
 * Order and words both come from `LEAGUE_EXPERIENCE_TIER_LABEL` (`@/identity/config`) rather than
 * being typed here, the same "one map decides the words" discipline `EXPERIENCE_TIER_LABEL`
 * already holds the profile and browse surfaces to.
 */
const EXPERIENCE_TIERS = Object.entries(LEAGUE_EXPERIENCE_TIER_LABEL).map(([value, label]) => ({ value, label }));
const STAKE_TIERS = MATCHMAKING_CONFIG.stakeTiers.map((entry) => ({ value: String(entry.tier), label: entry.label }));

/**
 * One visible field. Everything else is behind a closed disclosure, because every advanced
 * setting already has a server-side default — a commissioner who types a name and presses
 * the button gets a complete, playable league. That is the spec's exit criterion, and the
 * interaction-count test in `create-league-interactions.test.tsx` makes it mechanical.
 *
 * The numeric fields are `<Select>`s of the values we actually support rather than free
 * number inputs: there is no such thing as a 13-team league here, and a select cannot
 * produce one.
 */
export function CreateLeagueForm({ onCreated }: { readonly onCreated: (created: CreateLeagueBody) => void }) {
  const { fetchJson } = useLeagueRoomDeps();
  const [name, setName] = useState("");
  const [format, setFormat] = useState("snake");
  const [teamCount, setTeamCount] = useState("12");
  const [scoringPreset, setScoringPreset] = useState("ppr");
  const [auctionBudget, setAuctionBudget] = useState("200");
  const [visibility, setVisibility] = useState("invite_only");
  // `experienced` — the choice that refuses nobody. See `EXPERIENCE_TIERS` above.
  const [experienceTier, setExperienceTier] = useState("experienced");
  const [stakeTier, setStakeTier] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson("/api/leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          format,
          teamCount: Number(teamCount),
          scoringPreset,
          auctionBudget: Number(auctionBudget),
          visibility,
          experienceTier,
          stakeTier: Number(stakeTier),
        }),
      });
      const body = (await response.json()) as ApiEnvelope<CreateLeagueBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      onCreated(body.data);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
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
      <Input label="League name" value={name} onChange={(event) => setName(event.target.value)} error={error ?? undefined} />

      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm text-text-muted">Advanced settings: draft format, team count, scoring</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Select label="Draft format" options={FORMATS} value={format} onChange={(event) => setFormat(event.target.value)} />
          <Select label="Teams" options={TEAM_COUNTS} value={teamCount} onChange={(event) => setTeamCount(event.target.value)} />
          <Select label="Scoring" options={PRESETS} value={scoringPreset} onChange={(event) => setScoringPreset(event.target.value)} />
          {format === "auction" ? (
            <Input
              label="Auction budget"
              type="number"
              value={auctionBudget}
              hint="Dollars each manager has to spend."
              onChange={(event) => setAuctionBudget(event.target.value)}
            />
          ) : null}
          <Select label="Who can join" options={VISIBILITIES} value={visibility} onChange={(event) => setVisibility(event.target.value)} />
          <Select
            label="Who it's for"
            options={EXPERIENCE_TIERS}
            value={experienceTier}
            hint={LEAGUE_EXPERIENCE_TIER_HINT}
            onChange={(event) => setExperienceTier(event.target.value)}
          />
          <Select label="Stake tier" options={STAKE_TIERS} value={stakeTier} onChange={(event) => setStakeTier(event.target.value)} />
          <p className="text-sm text-text-muted sm:col-span-2">{MATCHMAKING_CONFIG.stakeDisclosure}</p>
        </div>
      </details>

      <Button type="submit" loading={submitting} disabled={submitting}>
        Create league
      </Button>
    </form>
  );
}
