package app.trycommish.core.player

import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunPlayerStatus
import app.trycommish.api.models.RunWeekRead
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.design.Words
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

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

    /** The months a stamp names, in order (Format.stampAt, en-US short). */
    private val months = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** Central's offsets from UTC in hours, daylight then standard. */
    private val centralOffsetsHours = listOf(5L, 6L)

    /** The parts of "Sun Oct 18, 1:00 am CT": weekday, month, day with its comma, clock, half, zone. */
    private const val STAMP_PARTS = 6

    /** STATUS_HELD_WORDS.changed: the caption over a read his status moved past, with the next write. */
    private fun changed(due: String): String = "${Words.StatusHeld.changedLead} ${Words.StatusHeld.dueBy} $due."

    /** stampInstant: the instant a caption-zone stamp names. The stamp carries no year, so the write's year
     * or the next, at Central's daylight or standard offset, whichever Format.stampAt says back as the
     * same stamp; null for a stamp that does not read back. */
    internal fun stampInstant(
        stamp: String,
        writtenAt: Instant,
    ): Instant? {
        val parts = stamp.split(" ")
        if (parts.size != STAMP_PARTS || !parts[2].endsWith(",")) return null
        val month = months.indexOf(parts[1]) + 1
        val day = parts[2].dropLast(1).toIntOrNull()
        val clock = parts[3].split(":").mapNotNull { it.toIntOrNull() }
        if (month == 0 || day == null || clock.size != 2) return null
        val hour24 = clock[0] % 12 + if (parts[4] == "pm") 12 else 0
        val year = writtenAt.atZone(ZoneOffset.UTC).year
        return listOf(year, year + 1)
            .flatMap { candidate -> centralOffsetsHours.map { candidate to it } }
            .mapNotNull { (candidate, offset) ->
                runCatching { LocalDate.of(candidate, month, day) }.getOrNull()?.let { date ->
                    date
                        .atStartOfDay()
                        .toInstant(ZoneOffset.UTC)
                        .plus(Duration.ofHours(hour24 + offset))
                        .plus(Duration.ofMinutes(clock[1].toLong()))
                }
            }.firstOrNull { Format.stampAt(it, captionZone) == stamp }
    }

    /** runCaptionDue: the due time the run's own status caption names, null when the caption is not one or
     * its time does not read. The run builds it at its nightly, so it is true only until then. */
    internal fun runCaptionDue(read: RunWeekRead): Instant? {
        val prefix = "${Words.StatusHeld.changedLead} ${Words.StatusHeld.dueBy} "
        val written = instantOrNull(read.writtenAt) ?: return null
        if (!read.caption.startsWith(prefix) || !read.caption.endsWith(".")) return null
        return stampInstant(read.caption.removePrefix(prefix).dropLast(1), written)
    }

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

    /** statusCaption: the caption his read is shown under at `now`, null when the capture says his
     * designation has not changed since it was written (the one arbiter), or with no capture. The run's own
     * caption while the time it names is still ahead (it knows a capped rewrite, Lane 275), else our next
     * hourly pass. */
    internal fun statusCaption(
        read: RunWeekRead,
        capture: RunDesignations?,
        player: String,
        now: Instant,
    ): String? {
        if (capture == null || !changedSince(read, capture, capture.players[player])) return null
        val runDue = runCaptionDue(read)
        if (runDue != null && runDue.isAfter(now)) return read.caption
        return changed(Format.stampAt(nextHourlyPass(now), captionZone))
    }

    /** readAtStatus: his read under the status caption (statusCaption) when his designation changed since it
     * was written, its body and call kept; as the run served it otherwise. */
    fun read(
        read: RunWeekRead,
        capture: RunDesignations?,
        player: String,
        now: Instant,
    ): RunWeekRead = statusCaption(read, capture, player, now)?.let { read.copy(caption = it) } ?: read
}
