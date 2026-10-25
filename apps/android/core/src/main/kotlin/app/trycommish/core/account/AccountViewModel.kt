package app.trycommish.core.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.CommishJson
import app.trycommish.api.Unauthorized
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.Format
import app.trycommish.core.SessionEnd
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

sealed interface AccountState {
    data object Loading : AccountState

    data class Loaded(
        val model: AccountModel,
        val stamp: Instant,
        val stale: Boolean,
    ) : AccountState

    data class Failed(
        val message: String,
    ) : AccountState

    data object SignedOut : AccountState
}

/** Which part of the screen an action's failure is said beside. */
enum class AccountSection { Leagues, Devices }

/** An action that did not go through: the API's own sentence, else the web's. */
data class AccountProblem(
    val section: AccountSection,
    val text: String,
)

/** The screen's state, the switches, the row an action is under way on (a league's or a device's id, or
 * Sign out's word) and the last action's failure. */
data class AccountUi(
    val state: AccountState = AccountState.Loading,
    val push: PushSettings = PushSettings.standard,
    val busy: String? = null,
    val problem: AccountProblem? = null,
)

/** What the Account asks of the app: sign this phone out through the session (it revokes the device and
 * returns to sign-in), end a session the API refused, and tell the league switch the leagues changed. */
class AccountHooks(
    val signOut: () -> Unit,
    val sessionEnd: SessionEnd,
    val leaguesChanged: () -> Unit,
)

/**
 * The Account screen's view model, the iOS one's (Lane 198 after its fix round): the account, the leagues
 * followed with detach and its undo, the paired devices with this phone marked and unpair, the plan in
 * the free season, the push switches kept on this phone, and sign out. The reads, the cache, the clock,
 * the switches' store, this phone's id and the app's hooks are injected; `wait` is the undo's window.
 * The saved account shows at once, then the API's; a failed read keeps it, stale with its stamp; a 401
 * signs out.
 */
class AccountViewModel(
    private val reads: AccountScreenReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
    private val store: PushStore,
    private val thisDevice: () -> String?,
    private val hooks: AccountHooks,
    private val wait: suspend (Duration) -> Unit = { delay(it.toMillis()) },
) : ViewModel() {
    private val mutableUi = MutableStateFlow(AccountUi(push = store.load()))
    private val mutableRefreshing = MutableStateFlow(false)
    private var loadJob: Job? = null
    private var answer: AccountScreenAnswer? = null
    private var stamp: Instant = Instant.EPOCH
    private var stale = false
    private var detached: Set<String> = emptySet()
    private var undoWindows: Map<String, Job> = emptyMap()

    val ui: StateFlow<AccountUi> = mutableUi.asStateFlow()

    /** A read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** "Last read Sat 12:00 pm" while the account shown is a saved one. */
    fun stampWords(ui: AccountUi = this.ui.value): String? {
        val loaded = ui.state as? AccountState.Loaded ?: return null
        return if (loaded.stale) "${AppWords.lastRead} ${Format.weekdayTime(loaded.stamp, zone)}" else null
    }

    /** The saved account at once on the first open, then the API's. Each call cancels the one before. */
    fun load(): Job {
        loadJob?.cancel()
        return viewModelScope
            .launch {
                mutableRefreshing.value = true
                try {
                    read()
                } finally {
                    mutableRefreshing.value = false
                }
            }.also { loadJob = it }
    }

    private suspend fun read() {
        if (answer == null) {
            cache.read(ROUTE)?.let { saved -> decodeOrNull(saved.body)?.let { show(it, saved.stamp, stale = true) } }
        }
        try {
            val fresh = readAll()
            val now = clock.now()
            cache.write(ROUTE, Cached(CommishJson.encodeToString(AccountScreenAnswer.serializer(), fresh), now))
            show(fresh, now, stale = false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            signedOut()
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            val shown = answer
            if (shown != null) {
                show(shown, stamp, stale = true)
            } else {
                val sentence = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: AppWords.cannotLoad
                mutableUi.update { it.copy(state = AccountState.Failed(sentence)) }
            }
        }
    }

    /** The account must read; the leagues may fail (the web's sentence says so), the devices then list
     * none, as the web's list does, and a failed plans read leaves the free season to the clock rule. */
    private suspend fun readAll(): AccountScreenAnswer =
        coroutineScope {
            val leagues = async { orNull { reads.attached() } }
            val devices = async { orNull { reads.devices() } }
            val flag = async { orNull { reads.freeSeasonFlag() } }
            val me = reads.me()
            AccountScreenAnswer(me, leagues.await(), devices.await().orEmpty(), flag.await())
        }

    /** Stops following a league: its row stays with its undo for the web's ten seconds, then leaves. The
     * league switch hears of it only then (or when the member leaves the Account first): a re-pick of
     * the shown league can change the bar, and the bar's change would take this screen and its Undo with
     * it (Lane 198 review M2). */
    fun detach(id: String): Job =
        viewModelScope.launch {
            if (!act(id, AccountSection.Leagues) { reads.detach(id) }) return@launch
            detached = detached + id
            redraw()
            undoWindows = undoWindows +
                (
                    id to
                        viewModelScope.launch {
                            wait(UNDO_WINDOW)
                            drop(id)
                            hooks.leaguesChanged()
                        }
                )
        }

    /** Takes a detach back within its window: the league is followed again with the seat it had, and the
     * switch, never told of the detach, has nothing to hear. */
    fun restore(id: String): Job =
        viewModelScope.launch {
            if (!act(id, AccountSection.Leagues) { reads.restore(id) }) return@launch
            undoWindows[id]?.cancel()
            undoWindows = undoWindows - id
            detached = detached - id
            redraw()
        }

    /** The member left the Account: each detach still in its undo window is final now, its row leaves and
     * the switch hears of it once. */
    fun leave() {
        val pending = detached
        if (pending.isEmpty()) return
        pending.forEach { id ->
            undoWindows[id]?.cancel()
            drop(id)
        }
        hooks.leaguesChanged()
    }

    /** Unpairs a device and takes it off the list. This phone's row says Sign out and signs out through
     * the session, which revokes it (Lane 198 review L1). */
    fun unpair(id: String): Job =
        viewModelScope.launch {
            if (id == thisDevice()) {
                signOut()
                return@launch
            }
            if (!act(id, AccountSection.Devices) { reads.revokeDevice(id) }) return@launch
            answer = answer?.withoutDevice(id)
            redraw()
            save()
        }

    /** Signs this phone out: the session revokes it and returns to sign-in. */
    fun signOut() {
        mutableUi.update { it.copy(busy = Words.Account.signOut) }
        hooks.signOut()
    }

    fun set(
        kind: PushKind,
        isOn: Boolean,
    ) = savePush(ui.value.push.with(kind, isOn))

    fun setQuiet(
        end: QuietEnd,
        minutes: Int,
    ) = savePush(ui.value.push.with(end, minutes))

    override fun onCleared() {
        leave()
    }

    private fun savePush(settings: PushSettings) {
        store.save(settings)
        mutableUi.update { it.copy(push = settings) }
    }

    /** Runs a row's action; false, with its sentence beside the section, when it did not go through. */
    private suspend fun act(
        id: String,
        section: AccountSection,
        step: suspend () -> Unit,
    ): Boolean {
        mutableUi.update { it.copy(busy = id, problem = null) }
        val problem =
            try {
                step()
                null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Unauthorized) {
                hooks.sessionEnd.signedOut()
                AppWords.signedOut
            } catch (e: ApiFailure) {
                e.message.ifEmpty { Words.Account.failed }
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                Words.Account.failed
            }
        mutableUi.update { it.copy(busy = null, problem = problem?.let { text -> AccountProblem(section, text) }) }
        return problem == null
    }

    private fun drop(id: String) {
        if (id !in detached) return
        detached = detached - id
        undoWindows = undoWindows - id
        answer = answer?.withoutLeague(id)
        redraw()
        save()
    }

    private fun save() {
        answer?.let { cache.write(ROUTE, Cached(CommishJson.encodeToString(AccountScreenAnswer.serializer(), it), stamp)) }
    }

    private fun signedOut() {
        hooks.sessionEnd.signedOut()
        mutableUi.update { it.copy(state = AccountState.SignedOut) }
    }

    private fun show(
        read: AccountScreenAnswer,
        stamp: Instant,
        stale: Boolean,
    ) {
        answer = read
        this.stamp = stamp
        this.stale = stale
        redraw()
    }

    private fun redraw() {
        val shown = answer ?: return
        val model = AccountModel.of(shown, detached, thisDevice(), clock.now(), zone)
        mutableUi.update { it.copy(state = AccountState.Loaded(model, stamp, stale)) }
    }

    private fun decodeOrNull(body: String): AccountScreenAnswer? =
        try {
            CommishJson.decodeFromString(AccountScreenAnswer.serializer(), body)
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            null
        }

    companion object {
        /** The cache key of the screen's answer. */
        const val ROUTE = "/account"

        /** How long a detached league stays on the list with its undo (AccountLeagues.svelte UNDO_MS). */
        val UNDO_WINDOW: Duration = Duration.ofSeconds(10)
    }
}

/** A read the screen can go without: its answer, or null when it failed for any reason but a cancel. */
private suspend fun <T> orNull(read: suspend () -> T): T? =
    try {
        read()
    } catch (e: CancellationException) {
        throw e
    } catch (
        @Suppress("TooGenericExceptionCaught") e: Exception,
    ) {
        null
    }
