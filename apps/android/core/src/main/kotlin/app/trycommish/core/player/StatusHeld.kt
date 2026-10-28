package app.trycommish.core.player

import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunPlayerStatus
import app.trycommish.api.models.RunWeekRead
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/** A week read written before his designation changed (web/src/lib/player/status-held.ts, Lane 162):
 * shown under the run's words for it, the status caption over the kept read, never in place of it
 * (Lane 274), judged against the injury capture read beside the run at the screen's clock. A read an
 * older run nulled keeps its caption alone. */
object StatusHeld {
    /** The zone the read's captions are said in, as the run says them (caption.py CENTRAL). */
    private val captionZone: ZoneId = ZoneId.of("America/Chicago")

    /** The writer's hourly passes, Eastern hours (caption.py HOURLY_PASS_HOURS_ET): midnight, 2 am, then 6
     * am through 11 pm. */
    private val passHours: Set<Int> = setOf(0, 2) + (6..23)
    private val passZone: ZoneId = ZoneId.of("America/New_York")
    private val hour: Duration = Duration.ofHours(1)

    /** A day of hours and one more: every day holds a pass, so the search ends within it. */
    private const val HOURS_SEARCHED = 48L

    /** How the run's status-changed caption opens, whatever due time it names (caption.py). */
    private const val CHANGED_LEAD = "His status changed since this read was written."

    /** STATUS_HELD_WORDS.changed: the run's caption for a read his status moved past. */
    private fun changed(due: String): String = "$CHANGED_LEAD A new read is due by $due."

    /** runSaysStatusChanged: the run sent its own status caption, whose due time knows a capped rewrite
     * (Lane 275); it is said as sent. */
    internal fun runSaysChanged(read: RunWeekRead): Boolean = read.caption.startsWith(CHANGED_LEAD)

    /** nextHourlyPass: the first hourly pass strictly after `after`, on the hour. */
    fun nextHourlyPass(after: Instant): Instant {
        val first = Instant.ofEpochSecond(Math.floorDiv(after.epochSecond, hour.seconds) * hour.seconds).plus(hour)
        return (0 until HOURS_SEARCHED)
            .map { first.plus(hour.multipliedBy(it)) }
            .first { it.atZone(passZone).hour in passHours }
    }

    /** statusChangedSince: only a capture read after the write can say so; then another status than the
     * one the read was written against, or the same status in a run that began after the read, is a change. */
    internal fun changedSince(
        read: RunWeekRead,
        capture: RunDesignations,
        listed: RunPlayerStatus?,
    ): Boolean {
        val written = instantOrNull(read.writtenAt) ?: return false
        val lastRead = instantOrNull(capture.checkedAt ?: capture.readAt) ?: return false
        if (!lastRead.isAfter(written)) return false
        if (read.status != listed?.status?.value) return true
        return instantOrNull(listed?.since)?.isAfter(written) ?: false
    }

    /** readAtStatus: his read under the status caption when his designation changed since it was written
     * (the run's own when it sent one, our next hourly pass only when it did not), its body and call kept;
     * as the run served it otherwise, and with no capture. */
    fun read(
        read: RunWeekRead,
        capture: RunDesignations?,
        player: String,
        now: Instant,
    ): RunWeekRead {
        if (capture == null || !changedSince(read, capture, capture.players[player])) return read
        if (runSaysChanged(read)) return read
        val due = Format.stampAt(nextHourlyPass(now), captionZone)
        return read.copy(caption = changed(due))
    }
}
