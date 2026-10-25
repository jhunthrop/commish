package app.trycommish.core.record

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
import app.trycommish.core.board.RunBoardReader
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId

sealed interface RecordState {
    data object Loading : RecordState

    data class Loaded(
        val model: RecordModel,
        val stamp: Instant,
        val stale: Boolean,
    ) : RecordState

    data class Failed(
        val message: String,
    ) : RecordState

    data object SignedOut : RecordState
}

/** The screen's state and what its chips have chosen: the figure the weeks' table shows (a phone draws one
 * at a time) and the position it is for, and the figure the draft record's table shows. */
data class RecordUi(
    val state: RecordState = RecordState.Loading,
    val figure: RecordFigure = RecordFigure.Agreement,
    val position: String = Words.Records.all,
    val draftFigure: RecordFigure = RecordFigure.Agreement,
)

/**
 * The Our record screen's view model, the iOS one's: the record's routes, the cache and the clock
 * injected; the saved read at once, dated, then the record and the schedule read again together naming
 * the ETags kept, so an unchanged run costs two 304s and refreshes only the stamp. A failed read keeps the
 * record shown, stale with its stamp; each call cancels the one before, so only the newest load is
 * shown. The screen decides nothing. A 401 signs the device out.
 */
class RecordViewModel(
    private val reads: RecordReads,
    private val cache: Cache,
    private val clock: Clock,
    private val zone: ZoneId,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    private val mutableUi = MutableStateFlow(RecordUi())
    private val mutableRefreshing = MutableStateFlow(false)
    private var loadJob: Job? = null
    private var shown: Pair<RecordBodies, Instant>? = null

    val ui: StateFlow<RecordUi> = mutableUi.asStateFlow()

    /** A read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** "Last read Sat 12:00 pm" while the record shown is a saved one. */
    fun stampWords(ui: RecordUi = this.ui.value): String? {
        val loaded = ui.state as? RecordState.Loaded ?: return null
        return if (loaded.stale) "${AppWords.lastRead} ${Format.weekdayTime(loaded.stamp, zone)}" else null
    }

    /** The saved read at once when nothing is shown, then the record and the schedule naming their kept
     * ETags; a failed read keeps what is shown, stale; a refused token signs out. */
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
        val saved = cache.read(ROUTE)?.let { cached -> bodies(cached.body)?.let { it to cached.stamp } }
        if (shown == null && saved != null) show(saved.first, saved.second, stale = true)
        val kept = shown?.first ?: saved?.first
        try {
            val fresh =
                coroutineScope {
                    val record = async { reads.record(kept?.record?.tag) }
                    val schedule = async { reads.schedule(kept?.schedule?.tag) }
                    RecordBodies(
                        RunBoardReader.resolve(record.await(), kept?.record),
                        RunBoardReader.resolve(schedule.await(), kept?.schedule),
                    )
                }
            val stamp = clock.now()
            cache.write(ROUTE, Cached(CommishJson.encodeToString(RecordBodies.serializer(), fresh), stamp))
            show(fresh, stamp, stale = false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            sessionEnd.signedOut()
            mutableUi.update { it.copy(state = RecordState.SignedOut) }
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            val current = shown
            if (current != null) {
                show(current.first, current.second, stale = true)
            } else {
                val sentence = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: AppWords.cannotLoad
                mutableUi.update { it.copy(state = RecordState.Failed(sentence)) }
            }
        }
    }

    /** A figure chip over the weeks' table. */
    fun chooseFigure(figure: RecordFigure) = mutableUi.update { it.copy(figure = figure) }

    /** A position chip over the weeks' table. */
    fun choosePosition(position: String) = mutableUi.update { it.copy(position = position) }

    /** A figure chip over the draft record's table. */
    fun chooseDraftFigure(figure: RecordFigure) = mutableUi.update { it.copy(draftFigure = figure) }

    private fun show(
        bodies: RecordBodies,
        stamp: Instant,
        stale: Boolean,
    ) {
        val read = RecordRead.of(bodies)
        shown = bodies to stamp
        val model = recordModel(read.record, read.schedule, scoring(read.record.format), clock.now())
        mutableUi.update { it.copy(state = RecordState.Loaded(model, stamp, stale)) }
    }

    /** A saved read whose bodies still decode, or none (a miss, never a crash). */
    private fun bodies(text: String): RecordBodies? =
        try {
            CommishJson.decodeFromString(RecordBodies.serializer(), text).also { RecordRead.of(it) }
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            null
        }

    companion object {
        /** The cache key of the read. */
        const val ROUTE = "/run/record"

        /** The scoring a run's format is graded in, as the manifest labels it ("ppr-12" is "PPR"). */
        fun scoring(format: String): String =
            when {
                format.startsWith("half") -> Words.BoardFormat.half
                format.startsWith("standard") -> Words.BoardFormat.std
                else -> Words.BoardFormat.ppr
            }
    }
}
