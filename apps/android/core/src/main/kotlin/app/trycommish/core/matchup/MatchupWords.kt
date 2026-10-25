package app.trycommish.core.matchup

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeagueSync
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.core.leaguehome.teamFallback
import app.trycommish.design.Words
import java.time.Duration
import java.time.Instant

/** The words the Matchup builds from data, each the same-named function of the web's (matchup.ts,
 * model.ts, connection-words.ts), held to its output by shared/fixtures/parity/matchup.json. */
object MatchupWords {
    private const val MINUTE = 60L
    private const val HOUR = 3600L

    /** model.ts teamName: the platform's name for the team, "Team 7" where it has none. */
    fun teamName(
        sync: LeagueSync,
        rosterId: Int,
    ): String =
        sync.teams
            .firstOrNull { it.rosterId == rosterId }
            ?.name
            ?.ifEmpty { null } ?: teamFallback(rosterId)

    /** matchup.ts yoursOnlyWords: "FFPC shows us your lineup only." */
    fun yoursOnly(platform: String): String = "$platform ${Words.Matchup.yoursOnly}"

    /** matchup.ts allPlayWords. */
    fun allPlay(platform: String): String = "${Words.Matchup.allPlayOn} $platform: ${Words.Matchup.allPlaySet}"

    /** model.ts matchupGap: a league with no current week has no games; a week we hold no game for is a
     * read we could not make, never a claim about the team. */
    fun gap(
        sync: LeagueSync,
        now: Instant,
    ): String {
        if (sync.week == 0) return "Your league has no games this week."
        return "We could not read this week's game from ${ValueWords.platform(sync.host)}. ${readLine(sync, now)}"
    }

    /** model.ts scoreGap: the member's score for the week could not be read. */
    fun scoreGap(
        sync: LeagueSync,
        now: Instant,
    ): String = "We could not read your score for this week from ${ValueWords.platform(sync.host)}. ${readLine(sync, now)}"

    /** model.ts readLine: when the platform was last read, and when the last read failed, why. */
    fun readLine(
        sync: LeagueSync,
        now: Instant,
    ): String {
        val readAt = instantOrNull(sync.readAt) ?: now
        val age = Duration.between(readAt, now).seconds.coerceAtLeast(0)
        val platform = ValueWords.platform(sync.host)
        val last = "This is our last read, ${agoWords(age)}."
        return when {
            sync.hostSignedOut -> "${keepReadingVerb(sync.host)} to keep this league in sync. $last"
            sync.hostFailed -> "$platform is not answering. $last"
            sync.hostStaleSeconds > 0 -> "Read from $platform ${agoWords(age)}. Reading again."
            else -> "Read from $platform ${agoWords(age)}."
        }
    }

    /** model.ts agoWords: "just now", "4 minutes ago", "2 hours ago". */
    fun agoWords(seconds: Long): String =
        when {
            seconds < MINUTE -> "just now"
            seconds < HOUR -> "${Format.plural((seconds / MINUTE).toInt(), "minute", "minutes")} ago"
            else -> "${Format.plural((seconds / HOUR).toInt(), "hour", "hours")} ago"
        }

    /** connection-words.ts keepReadingVerb: "Sign in to FFPC", "Connect Yahoo". */
    fun keepReadingVerb(league: LeagueHost): String =
        if (league == LeagueHost.ffpc) "Sign in to FFPC" else "Connect ${ValueWords.platform(league)}"
}
