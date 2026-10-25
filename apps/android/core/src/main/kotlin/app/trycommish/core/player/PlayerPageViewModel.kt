package app.trycommish.core.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.RunAdpSource
import app.trycommish.api.models.RunBoardAnswer
import app.trycommish.api.models.RunClub
import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunSchedule
import app.trycommish.core.AppWords
import app.trycommish.core.Format
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the player page shows. */
sealed interface PageState {
    data object Loading : PageState

    data class Loaded(
        val model: PlayerPageModel,
        val freshness: Freshness,
    ) : PageState

    data class Failed(
        val words: String,
    ) : PageState
}

/**
 * The player page's view model (web/src/routes/(run)/players/[slug]): pushed from the sheet's Full page.
 * It finds his page in the run by his slug, as the site's page does; reads the run's manifest, ADP sources,
 * capture, clubs and schedule and the leading board (its size, his tier, and a held page's figures), each
 * naming the ETag kept; and his week, the league's with one followed, for the verb and the read's
 * projection. A held page shows its copy with that run's stamp, or the board's figures and the held words;
 * never the document the API holds back. With no answer the saved reads stand with their stamp. One read
 * at a time: a new one cancels the last. The view decides nothing.
 */
class PlayerPageViewModel(
    val slug: String,
    private val graph: PlayerReadsGraph,
    private val league: FollowedLeague?,
) : ViewModel() {
    private val mutableState = MutableStateFlow<PageState>(PageState.Loading)
    private val mutableRefreshing = MutableStateFlow(false)
    private var pull: Job? = null

    val state: StateFlow<PageState> = mutableState.asStateFlow()

    /** A pull's read is running: the pull-to-refresh spinner. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /** "Last read Sun 3:05 pm" over a page drawn from saved reads; null for this open's. */
    fun stampWords(state: PageState = this.state.value): String? {
        val loaded = state as? PageState.Loaded ?: return null
        if (loaded.freshness.saved == null) return null
        return "${AppWords.lastRead} ${Format.weekdayTime(loaded.freshness.stamp, graph.zone)}"
    }

    fun load(): Job {
        pull?.cancel()
        return viewModelScope
            .launch {
                mutableRefreshing.value = true
                try {
                    read()
                } finally {
                    mutableRefreshing.value = false
                }
            }.also { pull = it }
    }

    /** The page as read now, kept where a read fails and the page is shown. */
    suspend fun read() {
        try {
            mutableState.value = page()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            graph.sessionEnd.signedOut()
            mutableState.value = PageState.Failed(AppWords.signedOut)
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            if (mutableState.value !is PageState.Loaded) mutableState.value = PageState.Failed(failure(e))
        }
    }

    private suspend fun page(): PageState =
        coroutineScope {
            val lookup = graph.lookup
            val (index, entry) = lookup.entry(slug)
            entry ?: return@coroutineScope PageState.Failed(Words.InSeason.notFoundLine)
            val manifest = lookup.manifest()
            val source = async { lookup.source(entry, manifest.value) }
            val reads =
                async {
                    runReads(
                        manifest.value.manifest.formats
                            .firstOrNull()
                            ?.id,
                    )
                }
            val week = async { quietly { graph.weekReader.read(entry.id, league) } }
            val (found, sourceReads) = source.await()
            val files = reads.await()
            val answer = week.await()
            val clock = graph.clock
            val input =
                PageInput(
                    source = found ?: return@coroutineScope PageState.Failed(Words.InSeason.notFoundLine),
                    manifest = manifest.value.manifest,
                    sources = files.sources.value,
                    capture = files.capture?.value,
                    clubs = files.clubs.value,
                    schedule = files.schedule.value,
                    board = files.board?.value,
                    week = answer?.first?.value,
                    host = if (answer?.second == true) league?.host else null,
                    league = league,
                    zone = graph.zone,
                    now = clock.now(),
                )
            val model = PlayerPages.page(input) ?: return@coroutineScope PageState.Failed(Words.InSeason.notFoundLine)
            val stamps = listOf(index.at, manifest.at) + sourceReads + files.stamps + listOfNotNull(answer?.first?.at)
            PageState.Loaded(model, Freshness.of(stamps, clock.now()))
        }

    /** The run's files beside his page: the ADP's sources, the capture, the clubs, the schedule and the
     * leading board, the capture and the board standing without where they cannot be read. */
    private class Files(
        val sources: Read<List<RunAdpSource>>,
        val capture: Read<RunDesignations?>?,
        val clubs: Read<List<RunClub>>,
        val schedule: Read<RunSchedule>,
        val board: Read<RunBoardAnswer>?,
    ) {
        val stamps: List<ReadStamp>
            get() = listOf(sources.at, clubs.at, schedule.at) + listOfNotNull(capture?.at, board?.at)
    }

    private suspend fun runReads(format: String?): Files =
        coroutineScope {
            val lookup = graph.lookup
            val sources = async { lookup.sources() }
            val capture = async { quietly { lookup.designations() } }
            val clubs = async { lookup.clubs() }
            val schedule = async { lookup.schedule() }
            val board = async { format?.let { quietly { lookup.board(it) } } }
            Files(sources.await(), capture.await(), clubs.await(), schedule.await(), board.await())
        }

    /** With nothing shown: the API's own sentence where it answered one, else no connection. */
    private fun failure(e: Exception): String = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: AppWords.cannotLoad
}
