package app.trycommish.core.leaguehome

import app.trycommish.api.models.LeaguePhase
import app.trycommish.core.Format
import app.trycommish.design.Words
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale

/**
 * The League home's word before and on draft day (SeasonPanel.svelte, phases pre_draft and draft_day), the iOS
 * DraftDayEntry's: when the draft is on the member's clock, that the site turns to the season after it with the
 * zone once, and the one verb: on draft day the Advisor, which opens the live-draft companion; before it Start
 * a mock draft, which opens the mock room's setup on the league (Lane 214). Held to the web by the companion's
 * parity (shared/fixtures/parity/companion.json draftDay). Every instant on the member's own clock.
 */
data class DraftDayEntry(
    val lead: String,
    val line: String,
    val verb: String,
    val opens: Opens = Opens.Advisor,
) {
    /** What the verb opens. */
    enum class Opens { Advisor, Mock }

    companion object {
        private const val EASTERN = "Eastern Time"

        /** The entry for a league before or on draft day; null in every other phase, where the web draws
         * another panel or none. */
        fun of(
            phase: LeaguePhase?,
            draftAt: Instant?,
            now: Instant,
            zone: ZoneId,
        ): DraftDayEntry? {
            if (phase != LeaguePhase.draft_day && phase != LeaguePhase.pre_draft) return null
            val opens = if (phase == LeaguePhase.draft_day) Opens.Advisor else Opens.Mock
            return DraftDayEntry(
                lead = draftLine(draftAt, now, zone),
                line = listOfNotNull(Words.DraftDay.turnsAfterDraft, zoneLine(zone)).joinToString(" "),
                verb = if (opens == Opens.Advisor) Words.DraftDay.advisorVerb else Words.PageVerb.mock,
                opens = opens,
            )
        }

        /** phase-words.ts draftLine: "Your draft is today at 7:00 pm.", "... tomorrow at ...", "Your draft is
         * Wednesday, September 9 at 7:00 pm.", "Your draft is on now.", or that it has no time. */
        fun draftLine(
            draftAt: Instant?,
            now: Instant,
            zone: ZoneId,
        ): String {
            if (draftAt == null) return "Your league has not set its draft time."
            if (!draftAt.isAfter(now)) return "Your draft is on now."
            val time = Format.timeOfDay(draftAt, zone)
            if (Format.sameDay(draftAt, now, zone)) return "Your draft is today at $time."
            if (Format.sameDay(draftAt, now.plus(Duration.ofDays(1)), zone)) return "Your draft is tomorrow at $time."
            return "Your draft is ${Format.weekdayName(draftAt, zone)}, ${Format.monthDay(draftAt, zone)} at $time."
        }

        /** clock.ts zoneLine: the member's zone said once, "Times are in Central Time.", null on the Eastern
         * clock. */
        fun zoneLine(zone: ZoneId): String? {
            val name = zone.getDisplayName(TextStyle.FULL, Locale.US)
            return if (name == EASTERN) null else "Times are in $name."
        }
    }
}
