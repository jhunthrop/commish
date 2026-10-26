package app.trycommish.core.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.SiteSeason
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.SessionEnd
import app.trycommish.core.phoneBar
import app.trycommish.design.RailItem
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.ZoneId

/** What the shell knows of the account. */
sealed interface ShellState {
    /** Nothing read yet. */
    data object Restoring : ShellState

    /** The account's leagues, the one shown (null with none followed) and the site's season. */
    data class Ready(
        val leagues: List<FollowedLeague>,
        val selected: FollowedLeague?,
        val season: SiteSeason.Phase?,
        /** The account's chosen format with no league, and its features (a mock's setup starts from them). */
        val format: BoardFormat? = null,
        val features: Set<String> = emptySet(),
    ) : ShellState

    /** No connection and nothing kept. */
    data object Unreachable : ShellState

    /** The API no longer takes the device's token; the app has signed it out. */
    data object SignedOut : ShellState
}

/** The cache's keys: GET /me's answer, and the league this phone last showed. */
object ShellKeys {
    const val ACCOUNT = "/me"
    const val LAST_LEAGUE = "app/last-league"
}

/**
 * The shell: the account's followed leagues and which one the app shows, read from GET /me, kept like
 * every answer. Read fresh, the site's selection leads (a choice made on the web shows here); from the
 * kept copy, this phone's last choice does, being newer than the copy; else the newest followed. A
 * choice in the switch shows at once and is written to the site (PUT /me/league) without waiting: any
 * answer but a 401 leaves the choice as made, a 401 signs the device out.
 */
class ShellViewModel(
    private val reads: AccountReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    private val mutableState = MutableStateFlow<ShellState>(ShellState.Restoring)
    private var job: Job? = null

    /** The phone's last choice until the site takes it (its PUT lands) or a fresh read agrees. */
    private var pending: String? = null

    /** How many choices the member has made, so a read can tell one made while it was in flight. */
    private var choicesMade = 0

    val state: StateFlow<ShellState> = mutableState.asStateFlow()

    /** The last choice's write to the site, kept so a test can wait on it; the app never does. */
    var selectionWrite: Job? = null
        private set

    /** The kept account at once, then the API's. Each call cancels the one before. */
    fun open(): Job {
        job?.cancel()
        return viewModelScope.launch { restore() }.also { job = it }
    }

    /** The member chose a league in the switch: shown at once, kept as this phone's choice, and
     * selected on the site too. A league the account does not follow is no change. */
    fun choose(leagueId: String) {
        val ready = mutableState.value as? ShellState.Ready ?: return
        val league = ready.leagues.firstOrNull { it.id == leagueId } ?: return
        mutableState.value = ready.copy(selected = league)
        pending = leagueId
        choicesMade++
        cache.write(ShellKeys.LAST_LEAGUE, Cached(leagueId, clock.now()))
        selectionWrite = viewModelScope.launch { write(leagueId) }
    }

    /** The top bar's league switch at this moment. */
    fun leagueSwitch(): LeagueSwitchModel {
        val ready = mutableState.value as? ShellState.Ready
        return leagueSwitch(ready?.leagues.orEmpty(), ready?.selected?.id, clock.now(), zone)
    }

    /** The bottom bar: the shown league's phase, else the site's season. */
    fun bar(): List<RailItem> {
        val ready = mutableState.value as? ShellState.Ready
        return phoneBar(ready?.selected, ready?.season)
    }

    private suspend fun restore() {
        val kept = cache.read(ShellKeys.ACCOUNT)?.body?.let(::decodeOrNull)
        val last = cache.read(ShellKeys.LAST_LEAGUE)?.body
        kept?.let { show(it, listOf(pending, last, it.selected)) }
        val asked = choicesMade
        val body =
            try {
                reads.me()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Unauthorized) {
                return signOut()
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                null
            }
        val fresh = body?.let(::decodeOrNull)
        when {
            fresh != null -> {
                cache.write(ShellKeys.ACCOUNT, Cached(requireNotNull(body), clock.now()))
                show(fresh, listOf(held(fresh, chosenDuringRead = choicesMade != asked), fresh.selected, last))
            }
            kept == null -> mutableState.value = ShellState.Unreachable
        }
    }

    /** The phone's choice that a fresh read must not take back: one the site has not taken yet (its
     * PUT failed or is still on its way) until the site's selection agrees, or one made while this read
     * was in flight, whose answer predates it. Null when the site's selection leads. */
    private fun held(
        fresh: AccountContext,
        chosenDuringRead: Boolean,
    ): String? {
        if (fresh.selected != null && fresh.selected == pending) pending = null
        val shown = (mutableState.value as? ShellState.Ready)?.selected?.id
        return pending ?: shown.takeIf { chosenDuringRead }
    }

    /** The account shown with the first of `choices` it follows, else its newest league. */
    private fun show(
        account: AccountContext,
        choices: List<String?>,
    ) {
        val league =
            choices.firstNotNullOfOrNull { id -> account.leagues.firstOrNull { it.id == id } } ?: account.leagues.firstOrNull()
        mutableState.value = ShellState.Ready(account.leagues, league, account.season, account.format, account.features)
        league?.let { cache.write(ShellKeys.LAST_LEAGUE, Cached(it.id, clock.now())) }
    }

    private suspend fun write(leagueId: String) {
        try {
            // Taken by the site: the choice no longer needs holding against its reads.
            if (reads.selectLeague(leagueId) && pending == leagueId) pending = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            signOut()
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            // Not taken by the site (no signal, an older API): the phone keeps the choice.
        }
    }

    private fun signOut() {
        sessionEnd.signedOut()
        mutableState.value = ShellState.SignedOut
    }

    private fun decodeOrNull(body: String): AccountContext? =
        try {
            accountContext(body)
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            null
        }
}
