import type { PlayerFactsFixture } from "@/capsules/facts/types";
import type { TeamRecord } from "../contract";

/** A 0..1 share as a whole percentage, "27%". */
export function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** A signed figure with one decimal, "+2.4" or "-3.0", for a rate over expectation. */
export function formatSigned(value: number): string {
  const rounded = value.toFixed(1);
  return value > 0 ? `+${rounded}` : rounded;
}

/** "15-2", or "14-2-1" when there was a tie. */
export function formatTeamRecord({ wins, losses, ties }: TeamRecord): string {
  return ties === 0 ? `${wins}-${losses}` : `${wins}-${losses}-${ties}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A yyyy-mm-dd stamp as "Aug 15, 2026"; an unreadable one as nothing, never a crash. */
export function formatStampedDate(isoDate: string): string {
  const at = new Date(`${isoDate}T00:00:00.000Z`);
  return Number.isNaN(at.getTime()) ? "" : DATE_FORMAT.format(at);
}

/** "vs NO" at home, "@ NO" on the road: the sport's own grammar, as the lineup rows say it. */
export function formatFixture(fixture: PlayerFactsFixture): string {
  return `${fixture.home ? "vs" : "@"} ${fixture.opponent}`;
}
