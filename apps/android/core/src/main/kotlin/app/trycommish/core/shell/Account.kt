package app.trycommish.core.shell

import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.ContextLeague
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeaguePhase
import app.trycommish.api.models.LeagueStanding
import app.trycommish.api.models.ScoringPreset
import app.trycommish.api.models.SiteSeason
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.format.DateTimeParseException

/**
 * A followed league as the shell needs it: which league, what the league switch calls it (its name, its
 * platform and scoring for the line under it, its draft time for the phase word), and where it is in
 * its season, which sets the bottom bar as it sets the web's.
 */
data class FollowedLeague(
    val id: String,
    val name: String,
    val host: LeagueHost,
    /** The preset the league scores as; null for one this build does not know. */
    val scoring: ScoringPreset?,
    /** The board the league reads on; null for one this build does not know. */
    val format: BoardFormat?,
    val phase: LeaguePhase,
    val draftAt: Instant?,
    val waiversOpen: Boolean,
    /** The member's team at the last read, empty when unread (the Trades' own side). */
    val teamName: String = "",
    /** Where the member's team stands, null when unread. */
    val standing: LeagueStanding? = null,
)

/**
 * The account as the shell reads it from GET /me: every followed league newest first (the web's
 * switcher list), the site's selected league (Account.league, chosen on the web or in the app), and
 * the site's season, which sets the bar with no league followed.
 */
data class AccountContext(
    val leagues: List<FollowedLeague>,
    /** The selected league's id; null with none followed or a format chosen alone. */
    val selected: String?,
    /** The site's season phase; null when absent or a phase this build does not know (read as in season). */
    val season: SiteSeason.Phase?,
)

/** The part of GET /me the shell reads. Every field may be absent, so an older API's answer still
 * reads: no season is read as in season, no leagues as none followed. */
@Serializable
private data class ShellAccount(
    val league: ContextLeague? = null,
    val leagues: List<ContextLeague> = emptyList(),
    val season: SiteSeason? = null,
)

/** The account's context from GET /me's body; throws on an error envelope or a body that is not one. */
fun accountContext(body: String): AccountContext {
    val account = decodeEnvelope<ShellAccount>(body)
    return AccountContext(
        leagues = account.leagues.map(::followed),
        selected = account.league?.id?.toString(),
        season = account.season?.phase?.takeUnless { it == SiteSeason.Phase.unknown_default_open_api },
    )
}

private fun followed(league: ContextLeague): FollowedLeague =
    FollowedLeague(
        id = league.id.toString(),
        name = league.name,
        host = league.host,
        scoring = league.scoring.takeUnless { it == ScoringPreset.unknown_default_open_api },
        format = league.format.takeUnless { it == BoardFormat.unknown_default_open_api },
        phase = league.phase,
        draftAt = league.draftAt?.let(::instantOrNull),
        waiversOpen = league.waiversOpen,
        teamName = league.teamName,
        standing = league.standing,
    )

private fun instantOrNull(text: String): Instant? =
    try {
        Instant.parse(text)
    } catch (e: DateTimeParseException) {
        null
    }
