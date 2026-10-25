package app.trycommish.core

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The web's number and clock formats (web/src/lib/format/number.ts, clock.ts), so the app prints the
 * same cell the web does for the same figure. */
object Format {
    private val weekdayTime = DateTimeFormatter.ofPattern("EEE h:mm a", Locale.US)
    private val timeOfDay = DateTimeFormatter.ofPattern("h:mm a", Locale.US)
    private val shortDay = DateTimeFormatter.ofPattern("MMM d", Locale.US)

    /** "39.1": one decimal, as JavaScript's toFixed rounds it. */
    fun fixed(
        value: Double,
        decimals: Int = 1,
    ): String = String.format(Locale.US, "%.${decimals}f", value)

    /** "1,000": a whole number with thousands separators. */
    fun count(value: Int): String = String.format(Locale.US, "%,d", value)

    /** "1st", "2nd", "11th", "23rd". */
    fun ordinal(value: Int): String {
        val teen = value % HUNDRED in TEENS
        val suffix =
            when {
                teen -> "th"
                value % TEN == 1 -> "st"
                value % TEN == 2 -> "nd"
                value % TEN == 3 -> "rd"
                else -> "th"
            }
        return "$value$suffix"
    }

    /** "1 player", "10 players". */
    fun plural(
        value: Int,
        one: String,
        many: String,
    ): String = "$value ${if (value == 1) one else many}"

    /** "Sun 1:00 pm": an instant on the member's clock. */
    fun weekdayTime(
        instant: Instant,
        zone: ZoneId,
    ): String = lowerPeriod(weekdayTime.format(instant.atZone(zone)))

    /** "7:00 pm": a time of day on the member's clock (clock.ts timeOfDay). */
    fun timeOfDay(
        instant: Instant,
        zone: ZoneId,
    ): String = lowerPeriod(timeOfDay.format(instant.atZone(zone)))

    /** "Oct 21": a day on the member's clock (clock.ts shortDay). */
    fun shortDay(
        instant: Instant,
        zone: ZoneId,
    ): String = shortDay.format(instant.atZone(zone))

    /** Whether two instants fall on the same calendar day on the member's clock (clock.ts sameDay). */
    fun sameDay(
        a: Instant,
        b: Instant,
        zone: ZoneId,
    ): Boolean = a.atZone(zone).toLocalDate() == b.atZone(zone).toLocalDate()

    private fun lowerPeriod(text: String): String = text.replace("AM", "am").replace("PM", "pm")

    private const val TEN = 10
    private const val HUNDRED = 100
    private val TEENS = 11..13
}
