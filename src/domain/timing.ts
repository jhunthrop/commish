/**
 * Every stateful action (draft picks, bids, timer expiry) carries an explicit
 * timestamp. No domain or reducer code may call Date.now() or `new Date()`
 * directly — tests inject a fake clock via this type instead.
 */
export interface Clock {
  now(): string;
}

export function isoTimestamp(date: Date): string {
  return date.toISOString();
}
