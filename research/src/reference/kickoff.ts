/**
 * NFL kickoff instants from the schedule's own raw pair (founder roadmap item 2, 2026-08-30:
 * per-game lineup locks — ESPN's "Lock individually at Scheduled Gametime").
 *
 * `nfl_games` stores `gameDate` ("20261213") and `kickoffEt` ("4:05p") exactly as Tank01
 * publishes them, in Eastern time. Turning that pair into an instant needs the Eastern UTC
 * offset FOR THAT DATE — EDT (-4) into early November, EST (-5) after — and the one correct way
 * to get it without a timezone library is to ask Intl for America/New_York directly. Guessing a
 * fixed offset locks every lineup an hour early or late for half the season.
 */

const ET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  timeZoneName: "longOffset",
});

/** The Eastern UTC offset in minutes on the given UTC instant (e.g. -240 for EDT, -300 for EST). */
function easternOffsetMinutes(at: Date): number {
  const name = ET_FORMATTER.formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (match === null) return -300;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * The UTC instant of a kickoff, or `null` when either half of the pair is absent or unparsable
 * — an unknown kickoff must never lock anything (the caller treats `null` as "not lockable by
 * time"; the fixture's own status remains the second, independent lock signal).
 */
export function kickoffInstant(gameDate: string, kickoffEt: string): Date | null {
  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(gameDate);
  const timeMatch = /^(\d{1,2}):(\d{2})([ap])$/i.exec(kickoffEt.trim());
  if (dateMatch === null || timeMatch === null) return null;
  const [, year, month, day] = dateMatch;
  const [, rawHour, minute, half] = timeMatch;
  let hour = Number(rawHour) % 12;
  if (half!.toLowerCase() === "p") hour += 12;
  // First guess assumes EST, then correct by the offset Intl reports for that instant. A kickoff
  // can never sit inside the one ambiguous DST fall-back hour (no NFL game kicks at 1am ET), so
  // one correction round is exact.
  const guess = Date.UTC(Number(year), Number(month) - 1, Number(day), hour, Number(minute)) - -300 * 60_000;
  const offset = easternOffsetMinutes(new Date(guess));
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), hour, Number(minute)) - offset * 60_000);
}
