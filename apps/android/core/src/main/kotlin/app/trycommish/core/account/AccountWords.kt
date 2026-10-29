package app.trycommish.core.account

import app.trycommish.api.models.LeaguePhase
import app.trycommish.api.models.LeagueStanding
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.core.matchup.MatchupWords
import app.trycommish.core.push.PushPermission
import app.trycommish.core.shell.followedName
import app.trycommish.core.shell.phaseWord
import app.trycommish.design.Words
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * The Account's words as the web builds them, each held to shared/fixtures/parity/account.json (the iOS
 * AccountWords): account/words.ts displayName and whoLine, league/attached-rows.ts attachedRow and
 * attachedCount, hosts/platform-rows.ts readWords, hosts/device-words.ts deviceLine and deviceCount. A
 * day is said on the site's clock, US Eastern (format/date.ts dayLabel), as the web says it.
 */
object AccountWords {
    /** format/date.ts ZONE: the clock the site's days are said on. */
    val siteZone: ZoneId = ZoneId.of("America/New_York")
    private val day: Duration = Duration.ofDays(1)

    /** The name the account is greeted by: its name, else its handle, else its email. */
    fun displayName(account: AccountRead): String {
        val full =
            listOfNotNull(account.firstName, account.lastName)
                .filter { it.isNotEmpty() }
                .joinToString(" ")
                .trim()
        return full.ifEmpty { account.handle ?: account.email }
    }

    /** "m@example.com, with us since Oct 12". */
    fun whoLine(account: AccountRead): String {
        val since = instantOrNull(account.createdAt)?.let { ", ${Words.Account.withUsSince} ${dayLabel(it)}" }.orEmpty()
        return "${account.email}$since"
    }

    /** "Oct 12": a day on the site's clock. */
    fun dayLabel(instant: Instant): String = Format.shortDay(instant, siteZone)

    /** The leagues table's head: "3, newest first". */
    fun attachedCount(count: Int): String = "$count, ${Words.Attached.newestFirst}"

    /** The paired devices' head: "2 devices". */
    fun deviceCount(count: Int): String = Format.plural(count, "device", "devices")

    /** A read's age: "4 minutes ago" within a day, its date after, "--" never read. */
    fun readWords(
        readAt: Instant?,
        now: Instant,
    ): String {
        readAt ?: return Words.Box.none
        val age = Duration.between(readAt, now).coerceAtLeast(Duration.ZERO)
        return if (age < day) MatchupWords.agoWords(age.seconds) else dayLabel(readAt)
    }

    /** "Paired Oct 12, last used Oct 17", "Paired Oct 12, not used yet". */
    fun deviceLine(device: DeviceRead): String {
        val used = instantOrNull(device.lastUsedAt)?.let { "${Words.Devices.lastUsed} ${dayLabel(it)}" } ?: Words.Devices.notUsed
        val paired = instantOrNull(device.createdAt)?.let(::dayLabel) ?: Words.Box.none
        return "${Words.Devices.paired} $paired, $used"
    }

    /** attached-rows.ts attachedRow: the league's name, "McConkey Kong Country, on Sleeper", its record
     * and place ("--" and nothing before a read), where it is in its season, and its last read. */
    fun leagueRow(
        league: AttachedRead,
        now: Instant,
        zone: ZoneId,
        detached: Boolean,
    ): AccountLeagueRow {
        val standing = league.standing
        val team = listOf(league.teamName, "on ${ValueWords.platform(league.host)}").filter { it.isNotEmpty() }
        return AccountLeagueRow(
            id = league.id,
            name = followedName(league.name, league.host),
            team = team.joinToString(", "),
            record = standing?.let(::record) ?: Words.Box.none,
            place = standing?.let { "${Format.ordinal(it.place)} of ${it.teams}" }.orEmpty(),
            season = season(league, now, zone),
            read = readWords(instantOrNull(league.lastReadAt), now),
            detached = detached,
        )
    }

    /** model.ts recordWords: "5-1", "5-1-1". */
    fun record(standing: LeagueStanding): String {
        val base = "${standing.wins}-${standing.losses}"
        return if (standing.ties > 0) "$base-${standing.ties}" else base
    }

    /** "In season, playoffs from week 15", "In season", else the phase word ("Draft Wed 12:00 pm"). A
     * phase this build does not know reads as in season, the app's hub. */
    fun season(
        league: AttachedRead,
        now: Instant,
        zone: ZoneId,
    ): String {
        val phase = league.phase
        if (phase != LeaguePhase.in_season && phase != LeaguePhase.unknown_default_open_api) {
            return phaseWord(phase, instantOrNull(league.draftAt), now, zone)
        }
        return league.playoffStartWeek?.let { "${Words.Attached.inSeason}, playoffs from week $it" } ?: Words.Attached.inSeason
    }

    /** Under the switches: where they are kept, then, while the phone may not show a push, what turning one
     * on does (not asked yet) or where to allow it (refused). */
    fun pushFoot(permission: PushPermission): String =
        when (permission) {
            PushPermission.Allowed -> Words.Push.kept
            PushPermission.NotAsked -> "${Words.Push.kept} ${Words.Push.ask}"
            PushPermission.Refused -> "${Words.Push.kept} ${Words.Push.blocked}"
        }

    /** A time of day from minutes after midnight: "11:00 pm". */
    fun clockTime(minutes: Int): String = Format.timeOfDay(Instant.ofEpochSecond(minutes * SECONDS_IN_A_MINUTE), ZoneOffset.UTC)

    private const val SECONDS_IN_A_MINUTE = 60L
}
