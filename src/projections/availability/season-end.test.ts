import { describe, expect, it } from "vitest";
import { deriveSeasonEndingAbsence, type WeeklyInjuryReport } from "./season-end";

function row(week: number, reportStatus: string, primaryInjury = ""): WeeklyInjuryReport {
  return { week, reportStatus, primaryInjury };
}

describe("deriveSeasonEndingAbsence", () => {
  it("derives a clean season-ending case from an Out report covering the first missed week", () => {
    const rows = [row(5, "Out", "Knee"), row(6, "Out", "Knee")];
    const gamesPlayedWeeks = [1, 2, 3, 4];
    expect(deriveSeasonEndingAbsence(rows, gamesPlayedWeeks)).toEqual({
      lastPlayedWeek: 4,
      firstMissedWeek: 5,
      reportStatus: "Out",
      primaryInjury: "Knee",
    });
  });

  it("returns null for a mid-season absence the player came back from", () => {
    // Out weeks 5-6, then back on the field from week 7 on — the games-played record reaches past
    // the absence, so his LAST played week is the return, not week 4.
    const rows = [row(5, "Out", "Ankle"), row(6, "Out", "Ankle")];
    const gamesPlayedWeeks = [1, 2, 3, 4, 7, 8, 9, 10];
    expect(deriveSeasonEndingAbsence(rows, gamesPlayedWeeks)).toBeNull();
  });

  it("reports the LATER absence when a player returns and then truly ends his season", () => {
    // The comeback in week 7 resolves the first stretch; a fresh, real season-ender in week 11
    // should still be found, anchored on his actual last game.
    const rows = [row(5, "Out", "Ankle"), row(6, "Out", "Ankle"), row(11, "Out", "Shoulder")];
    const gamesPlayedWeeks = [1, 2, 3, 4, 7, 8, 9, 10];
    expect(deriveSeasonEndingAbsence(rows, gamesPlayedWeeks)).toEqual({
      lastPlayedWeek: 10,
      firstMissedWeek: 11,
      reportStatus: "Out",
      primaryInjury: "Shoulder",
    });
  });

  it("returns null for a player with no injury rows at all", () => {
    expect(deriveSeasonEndingAbsence([], [1, 2, 3, 4])).toBeNull();
  });

  it("returns null for a season ending on bye/rest weeks with no report coverage", () => {
    // Absence of a report row is not evidence of injury — a coach's decision, a bye, or a healthy
    // scratch look identical to this function, and none of them may be read as "hurt".
    const rows = [row(3, "Questionable", "Hamstring")];
    const gamesPlayedWeeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    expect(deriveSeasonEndingAbsence(rows, gamesPlayedWeeks)).toBeNull();
  });

  it("never upgrades specificity: the report's own injury text is passed through verbatim", () => {
    const rows = [row(9, "Out", "Knee")];
    expect(deriveSeasonEndingAbsence(rows, [1, 2, 3, 4, 5, 6, 7, 8])?.primaryInjury).toBe("Knee");
  });

  it("treats a weaker designation (Questionable, Doubtful) as insufficient to anchor a season-ender", () => {
    expect(deriveSeasonEndingAbsence([row(5, "Questionable", "Knee")], [1, 2, 3, 4])).toBeNull();
    expect(deriveSeasonEndingAbsence([row(5, "Doubtful", "Knee")], [1, 2, 3, 4])).toBeNull();
  });

  it("treats a blank designation (on the report, no game status yet) as insufficient", () => {
    expect(deriveSeasonEndingAbsence([row(5, "", "")], [1, 2, 3, 4])).toBeNull();
  });

  it("handles a player who never played at all: week 1 itself must carry the qualifying row", () => {
    expect(deriveSeasonEndingAbsence([row(1, "Out", "Achilles")], [])).toEqual({
      lastPlayedWeek: 0,
      firstMissedWeek: 1,
      reportStatus: "Out",
      primaryInjury: "Achilles",
    });
  });

  it("recognises Injured Reserve as a qualifying status, even though the real feed has never emitted it", () => {
    expect(deriveSeasonEndingAbsence([row(6, "Injured Reserve", "Pectoral")], [1, 2, 3, 4, 5])).toEqual({
      lastPlayedWeek: 5,
      firstMissedWeek: 6,
      reportStatus: "Injured Reserve",
      primaryInjury: "Pectoral",
    });
  });
});
