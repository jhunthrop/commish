package app.trycommish.core.leaguehome

import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.AttachedLeague
import app.trycommish.api.models.LeaguePhase
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import kotlinx.coroutines.CancellationException

/** The phases a league's own page leads with its week: the season and its playoffs. */
private val PLAYING = setOf(LeaguePhase.in_season, LeaguePhase.playoffs)

/** The league the League tab opens: the first of the member's leagues (the API lists them newest
 * first) whose season is on, else the first. */
fun leagueToOpen(leagues: List<AttachedLeague>): AttachedLeague? = leagues.firstOrNull { it.phase in PLAYING } ?: leagues.firstOrNull()

/** What the League tab opens. */
sealed interface LeagueChoice {
    data class Chosen(
        val leagueId: String,
    ) : LeagueChoice

    /** The member has attached no league. */
    data object NoLeague : LeagueChoice

    /** No connection and nothing kept. */
    data object Unreachable : LeagueChoice

    /** The sentence the tab shows when there is no league to draw. */
    fun message(): String? =
        when (this) {
            is Chosen -> null
            NoLeague -> LeagueHomeWords.noLeague
            Unreachable -> LeagueHomeWords.cannotLoad
        }
}

/** Chooses the League tab's league from `/leagues/attached`, kept like every answer so the tab opens
 * with no connection. */
class LeagueChooser(
    private val reads: LeagueReads,
    private val cache: Cache,
    private val clock: Clock,
) {
    suspend fun choose(): LeagueChoice {
        val fresh =
            try {
                reads.attached()
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                null
            }
        val leagues = fresh?.let(::decode)
        if (fresh != null && leagues != null) {
            cache.write(LeagueHomeKeys.ATTACHED, Cached(fresh, clock.now()))
            return choiceOf(leagues)
        }
        val kept = cache.read(LeagueHomeKeys.ATTACHED)?.body?.let(::decode) ?: return LeagueChoice.Unreachable
        return choiceOf(kept)
    }

    private fun choiceOf(leagues: List<AttachedLeague>): LeagueChoice =
        leagueToOpen(leagues)?.let { LeagueChoice.Chosen(it.id.toString()) } ?: LeagueChoice.NoLeague

    private fun decode(body: String): List<AttachedLeague>? = runCatching { decodeEnvelope<List<AttachedLeague>>(body) }.getOrNull()
}
