package app.trycommish.core.account

import app.trycommish.api.models.NotificationKindsUpdate
import app.trycommish.api.models.NotificationSettings
import app.trycommish.api.models.NotificationSettingsUpdate
import java.time.ZoneId
import java.util.Locale

/** A kind of push the account can turn on or off (spec 2026-10-24-native-mobile-apps-design §5.3): the
 * Thursday read, a starter's status change, waivers clearing. */
enum class PushKind { Thursday, Status, Waivers }

/** Which end of quiet hours is being set. */
enum class QuietEnd { From, To }

/** The push switches and quiet hours, minutes after midnight on the phone's clock, as the account holds
 * them (GET and PATCH /me `notifications`, Lane 262). Every kind is on and quiet hours run 23:00 to 08:00
 * until the member changes them (§5.3's defaults, and an API that sends none). */
data class PushSettings(
    val off: Set<PushKind> = emptySet(),
    val quietFrom: Int = DEFAULT_FROM,
    val quietTo: Int = DEFAULT_TO,
) {
    fun on(kind: PushKind): Boolean = kind !in off

    /** Whether any kind is on: with none, the phone takes its token off. */
    val anyOn: Boolean get() = off.size < PushKind.entries.size

    /** These settings with every kind off, as the switches draw while the phone may not show a push. */
    val allOff: PushSettings get() = copy(off = PushKind.entries.toSet())

    /** These settings with one kind turned on or off. */
    fun with(
        kind: PushKind,
        isOn: Boolean,
    ): PushSettings = copy(off = if (isOn) off - kind else off + kind)

    /** These settings with one end of quiet hours moved, kept within a day. */
    fun with(
        end: QuietEnd,
        minutes: Int,
    ): PushSettings {
        val kept = Math.floorMod(minutes, MINUTES_IN_A_DAY)
        return if (end == QuietEnd.From) copy(quietFrom = kept) else copy(quietTo = kept)
    }

    fun minutes(end: QuietEnd): Int = if (end == QuietEnd.From) quietFrom else quietTo

    /** The whole of these settings as PATCH /me writes them, quiet hours in `zone`, the phone's own. */
    fun change(zone: ZoneId): NotificationSettingsUpdate =
        NotificationSettingsUpdate(
            timeZone = zone.id,
            quietStart = clock(quietFrom),
            quietEnd = clock(quietTo),
            kinds =
                NotificationKindsUpdate(
                    starterStatus = on(PushKind.Status),
                    weekReads = on(PushKind.Thursday),
                    waiverClaims = on(PushKind.Waivers),
                ),
        )

    companion object {
        const val MINUTES_IN_A_DAY = 24 * 60
        private const val MINUTES_IN_AN_HOUR = 60
        private const val HOURS_IN_A_DAY = 24
        private const val DEFAULT_FROM = 23 * 60
        private const val DEFAULT_TO = 8 * 60
        val standard = PushSettings()

        /** The account's settings; an API that sends none is the standard settings. */
        fun of(answer: NotificationSettings?): PushSettings {
            answer ?: return standard
            val on =
                mapOf(
                    PushKind.Thursday to answer.kinds.weekReads,
                    PushKind.Status to answer.kinds.starterStatus,
                    PushKind.Waivers to answer.kinds.waiverClaims,
                )
            return PushSettings(
                off = PushKind.entries.filter { on[it] == false }.toSet(),
                quietFrom = minutes(answer.quietStart) ?: DEFAULT_FROM,
                quietTo = minutes(answer.quietEnd) ?: DEFAULT_TO,
            )
        }

        /** "HH:MM" from minutes after midnight. */
        fun clock(minutes: Int): String =
            String.format(Locale.ROOT, "%02d:%02d", minutes / MINUTES_IN_AN_HOUR, minutes % MINUTES_IN_AN_HOUR)

        /** Minutes after midnight from "HH:MM"; null for anything else. */
        fun minutes(clock: String): Int? {
            val parts = clock.split(":")
            if (parts.size != 2) return null
            val hour = parts[0].toIntOrNull()?.takeIf { it in 0 until HOURS_IN_A_DAY } ?: return null
            val minute = parts[1].toIntOrNull()?.takeIf { it in 0 until MINUTES_IN_AN_HOUR } ?: return null
            return hour * MINUTES_IN_AN_HOUR + minute
        }
    }
}
