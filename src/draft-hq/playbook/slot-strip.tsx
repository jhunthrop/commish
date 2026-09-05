"use client";

import { useRouter } from "next/navigation";
import { SegmentGroup } from "@/components/ui";

/**
 * THE SLOT ADVISOR'S OWN PICKER (spec §8: "every slot has a book. Pick yours; the whole playbook
 * recomputes.") — a real navigation, exactly like `LeaguePicker`, because a slot change recomputes
 * the canonical sim server-side (`playbook/service.ts`'s `canonicalSimFor`) rather than only
 * re-filtering rows already in hand.
 */
export function SlotStrip({ teamCount, slot, basePath, leagueQuery }: { readonly teamCount: number; readonly slot: number; readonly basePath: string; readonly leagueQuery: string | null }) {
  const router = useRouter();
  const options = Array.from({ length: teamCount }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
  return (
    <SegmentGroup
      label="Your slot"
      options={options}
      value={String(slot)}
      onChange={(next) => {
        const params = new URLSearchParams();
        if (leagueQuery !== null) params.set("league", leagueQuery);
        params.set("slot", next);
        router.push(`${basePath}?${params.toString()}`);
      }}
    />
  );
}
