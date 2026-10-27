package app.trycommish.core.reference

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.RunManifest
import app.trycommish.core.AppWords
import app.trycommish.core.Format
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.BoardChip
import app.trycommish.core.board.RunWords
import app.trycommish.core.liveorder.OrderReader
import app.trycommish.core.player.Freshness
import app.trycommish.core.player.RunFiles
import app.trycommish.core.player.SavedReason
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.ZoneId

/** What a reference screen shows. */
sealed interface RunScreenState<out Model> {
    data object Loading : RunScreenState<Nothing>

    data class Loaded<Model>(
        val model: Model,
        val freshness: Freshness,
    ) : RunScreenState<Model>

    data class Failed(
        val words: String,
    ) : RunScreenState<Nothing>
}

/** What a screen's member last asked for while its read may still be in flight: ADP's format, or
 * Compare's sides and format. Each tap builds on it, never on the screen still shown, so a tap made
 * during a read is not lost (Lane 199 review M1). */
sealed interface ScreenAsk {
    data class Adp(
        val format: String,
    ) : ScreenAsk

    data class Compare(
        val ask: CompareAsk,
    ) : ScreenAsk
}

/** How a screen is built from the run's files. */
typealias ScreenBuild<Model> = suspend (ReferenceReads) -> Built<Model>

/**
 * A reference screen's view model (ADP, compare, the clubs, a club, the schedule; the Board's pattern and
 * the iOS RunScreenViewModel's twin): the run's routes, the cache and the clock injected; each file read
 * naming the ETag kept, a 304 keeping the copy; with no answer the saved files stand, the screen stale with
 * its stamp and reason; a refused token signs out. What the screen is built from is its build; a chip or a
 * pick builds anew from the newest ask, a build that lands after a newer one is dropped, and one that fails
 * over a shown screen leaves that screen and its build standing with a one-line notice (Lane 199 review M2).
 * In season a screen whose build says it at the order's clock is drawn on the run first, then on the order
 * the Rankings read once it answers (Lane 226, `orders`); a failed read leaves the run's. The view decides
 * nothing.
 */
class RunScreenViewModel<Model>(
    private val reads: ReferenceReads,
    val zone: ZoneId,
    private val sessionEnd: SessionEnd,
    /** The in-season screens' shared read of the order; null reads none. */
    private val orders: OrderReader?,
    private var build: ScreenBuild<Model>,
) : ViewModel() {
    private val mutableState = MutableStateFlow<RunScreenState<Model>>(RunScreenState.Loading)
    private val mutableNotice = MutableStateFlow<String?>(null)
    private val mutableAsk = MutableStateFlow<ScreenAsk?>(null)
    private val mutableRefreshing = MutableStateFlow(false)

    /** The manifest of the screen shown: its day for the offline words. */
    private var manifest: RunManifest? = null

    /** The newest build asked for; an older one's answer is not shown. */
    private var generation = 0

    val state: StateFlow<RunScreenState<Model>> = mutableState.asStateFlow()

    /** Said over a shown screen when a chip or a pick could not be built: the web's words for a format the
     * run lacks, or why the read failed. Cleared by the next screen built. */
    val notice: StateFlow<String?> = mutableNotice.asStateFlow()

    /** The member's newest ask, null once the screen shown is the one asked for. */
    val ask: StateFlow<ScreenAsk?> = mutableAsk.asStateFlow()

    /** A read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    val clock get() = reads.clock

    /** Said over a screen drawn from saved files: the offline lead with no connection, "Last read Sat
     * 12:00 pm" when a read failed another way; null for this open's read. */
    fun stampWords(state: RunScreenState<Model> = this.state.value): String? {
        val loaded = state as? RunScreenState.Loaded ?: return null
        val shown = manifest ?: return null
        return when (loaded.freshness.saved) {
            SavedReason.Offline -> RunWords.offline(shown)
            SavedReason.Failed -> "${AppWords.lastRead} ${Format.weekdayTime(loaded.freshness.stamp, zone)}"
            null -> null
        }
    }

    /** What the screen's head says over it: the notice of a chip that failed, else the saved read's reason. */
    fun staleWords(
        state: RunScreenState<Model> = this.state.value,
        notice: String? = this.notice.value,
    ): String? = notice ?: stampWords(state)

    /** The screen's files, read now or as last saved. */
    fun load(): Job = launch(build, replacing = false, absent = null)

    /** Another build for the same screen (a format chip, a player picked) for the newest ask: drawn once its
     * files are read; a failure over a shown screen keeps it, with `absent` said for a file the API refused
     * (a format the run lacks), else why the read failed. */
    fun rebuild(
        next: ScreenBuild<Model>,
        ask: ScreenAsk,
        absent: String? = null,
    ): Job {
        mutableAsk.value = ask
        return launch(next, replacing = true, absent = absent)
    }

    private fun launch(
        next: ScreenBuild<Model>,
        replacing: Boolean,
        absent: String?,
    ): Job {
        generation += 1
        val mine = generation
        return viewModelScope.launch {
            mutableRefreshing.value = true
            try {
                run(next, mine, replacing, absent)
            } finally {
                if (mine == generation) mutableRefreshing.value = false
            }
        }
    }

    private suspend fun run(
        next: ScreenBuild<Model>,
        mine: Int,
        replacing: Boolean,
        absent: String?,
    ) {
        try {
            val built = next(reads)
            if (mine != generation) return
            build = next
            mutableAsk.value = null
            mutableNotice.value = null
            manifest = built.manifest
            val freshness = Freshness.of(built.reads, reads.clock.now())
            mutableState.value = RunScreenState.Loaded(built.model, freshness)
            place(built, freshness, mine)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            sessionEnd.signedOut()
            mutableState.value = RunScreenState.Failed(AppWords.signedOut)
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            if (mine != generation) return
            mutableAsk.value = null
            if (mutableState.value is RunScreenState.Loaded) {
                // A chip, a pick or a pull that cannot be built leaves the screen shown and its build standing.
                mutableNotice.value = if (replacing && RunFiles.refused(e)) absent ?: failure(e) else failure(e)
            } else {
                build = next
                mutableState.value = RunScreenState.Failed(failure(e))
            }
        }
    }

    /** The screen at the order's clock once the order answers and places every row it draws; a failed
     * read, a newer build, or an answer that does not place them leaves the run's screen standing. */
    private suspend fun place(
        built: Built<Model>,
        freshness: Freshness,
        mine: Int,
    ) {
        val reader = orders ?: return
        val atClock = built.atClock ?: return
        val model = atClock(reader) ?: return
        if (mine == generation) mutableState.value = RunScreenState.Loaded(model, freshness)
    }

    companion object {
        /** With nothing shown: the API's own sentence where it answered one, else no connection. */
        fun failure(e: Exception): String = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: AppWords.cannotLoad
    }
}

/** The chips with `value` pressed: the format the member last tapped while its read is in flight. */
fun List<BoardChip<String>>.pressing(value: String?): List<BoardChip<String>> =
    if (value == null) this else map { it.copy(pressed = it.value == value) }
