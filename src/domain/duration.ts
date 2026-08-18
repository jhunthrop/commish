export const MS_PER_SECOND = 1_000;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;

export function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * The plain-language length of a duration: "8 hours", "10 minutes", "45 seconds". Lives in
 * the domain because both the browser (the draft room's clock copy) and the server (the
 * moderator's nudge) say it, and two implementations would eventually disagree.
 */
export function formatClockLength(seconds: number): string {
  if (seconds >= SECONDS_PER_HOUR && seconds % SECONDS_PER_HOUR === 0) return plural(seconds / SECONDS_PER_HOUR, "hour");
  if (seconds >= SECONDS_PER_MINUTE && seconds % SECONDS_PER_MINUTE === 0) return plural(seconds / SECONDS_PER_MINUTE, "minute");
  return plural(seconds, "second");
}
