package app.trycommish.core.leaguehome

import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.AttachedLeague
import app.trycommish.api.models.LeaguePhase
import app.trycommish.core.AppWords
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
    /** A league, with its phase and whether its waivers run, which choose the bottom bar. */
    data class Chosen(
        val leagueId: String,
        val phase: LeaguePhase,
        val waiversOpen: Boolean,
    ) : LeagueChoice

    /** The member has attached no league. */
    data object NoLeague : LeagueChoice

    /** No connection and nothing kept. */
    data object Unreachable : LeagueChoice

    /** The API no longer takes the device's token. */
    data object SignedOut : LeagueChoice

    /** The sentence the tab shows when there is no league to draw. */
    fun message(): String? =
        when (this) {
            is Chosen -> null
            NoLeague -> AppWords.noLeague
            Unreachable -> AppWords.cannotLoad
            SignedOut -> AppWords.signedOut
        }
}

/** Chooses the League tab's league from `/leagues/attached`, kept like every answer: [kept] reads the
 * kept list at once with no network, [choose] asks the API and keeps its answer. */
class LeagueChooser(
    private val reads: LeagueReads,
    private val cache: Cache,
    private val clock: Clock,
) {
    /** The choice from the kept list, null when nothing is kept. */
    fun kept(): LeagueChoice? =
        cache
            .read(LeagueHomeKeys.ATTACHED)
            ?.body
            ?.let(::decode)
            ?.let(::choiceOf)

    /** The choice from the API; with no connection the kept list's, else Unreachable. */
    suspend fun choose(): LeagueChoice {
        val fresh =
            try {
                reads.attached()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Unauthorized) {
                return LeagueChoice.SignedOut
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
        return kept() ?: LeagueChoice.Unreachable
    }

    private fun choiceOf(leagues: List<AttachedLeague>): LeagueChoice =
        leagueToOpen(leagues)?.let { LeagueChoice.Chosen(it.id.toString(), it.phase, it.waiversOpen) } ?: LeagueChoice.NoLeague

    private fun decode(body: String): List<AttachedLeague>? = runCatching { decodeEnvelope<List<AttachedLeague>>(body) }.getOrNull()
}
