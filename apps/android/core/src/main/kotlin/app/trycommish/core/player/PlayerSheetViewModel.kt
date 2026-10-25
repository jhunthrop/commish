package app.trycommish.core.player

import app.trycommish.api.Unauthorized
import app.trycommish.api.models.RunIndexEntry
import app.trycommish.api.models.RunManifestAnswer
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Clock
import app.trycommish.core.Format
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.RunReads
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.unreadBasis
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.ZoneId

/** What the sheet's body shows. */
sealed interface SheetState {
    data object Loading : SheetState

    /** His card, when its reads were made, and why they are saved ones. */
    data class Loaded(
        val card: PlayerCard,
        val freshness: Freshness,
    ) : SheetState

    /** The basis the shelf says when his week cannot be read, or the sign-in's end. */
    data class Failed(
        val words: String,
    ) : SheetState
}

/** The reads every player sheet and page is made over, built once by the app's graph. */
class PlayerReadsGraph(
    val run: RunReads,
    val pages: PlayerPageReads,
    val weeks: PlayerWeekReads,
    val cache: Cache,
    val clock: Clock,
    val zone: ZoneId,
    val sessionEnd: SessionEnd,
) {
    val files: RunFiles = RunFiles(cache, clock)
    val lookup: PlayerLookup = PlayerLookup(files, run, pages)
    val weekReader: WeekReader = WeekReader(weeks, AnswerFiles(cache, clock))
}

/**
 * The player sheet's view model (the web's shelf, PlayerShelf.svelte): the run's routes, the week's, the
 * cache and the clock injected. It holds the player it opened on, by his id, whatever the list under the
 * sheet does (plan Review Focus 3); finds his page in the run by his slug; reads the run's manifest and
 * capture and his week (the league's with one followed), each run file naming the ETag kept so an
 * unchanged run costs 304s; and shows the card, with the saved reads and their stamp when there is no
 * answer. The view decides nothing.
 */
class PlayerSheetViewModel(
    /** The player the sheet opened on: the sheet shows him until it closes. */
    val player: SheetPlayer,
    private val graph: PlayerReadsGraph,
    private val league: FollowedLeague?,
) {
    private val mutableState = MutableStateFlow<SheetState>(SheetState.Loading)
    val state: StateFlow<SheetState> = mutableState.asStateFlow()

    /** "Last read Sun 3:05 pm" over a card drawn from saved reads; null for this open's. */
    fun stampWords(state: SheetState = this.state.value): String? {
        val loaded = state as? SheetState.Loaded ?: return null
        if (loaded.freshness.saved == null) return null
        return "${AppWords.lastRead} ${Format.weekdayTime(loaded.freshness.stamp, graph.zone)}"
    }

    /** His card from the run and his week; a refused token signs out; with no week read and none saved,
     * the shelf's words for a week that could not be read. A slug the run's index does not name keeps his
     * week's card by the row's board id, with no read (his page cannot be found). */
    suspend fun load() {
        try {
            mutableState.value = loaded()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            graph.sessionEnd.signedOut()
            mutableState.value = SheetState.Failed(AppWords.signedOut)
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            mutableState.value = SheetState.Failed(unreadBasis(failed = true, weekTile = Words.Card.proj))
        }
    }

    private suspend fun loaded(): SheetState =
        coroutineScope {
            val looked = indexEntry()
            val id = looked?.second?.id ?: player.boardId ?: return@coroutineScope failed()
            val manifest = async { quietly { graph.lookup.manifest() } }
            val capture = async { quietly { graph.lookup.designations() } }
            val (week, inLeague) = graph.weekReader.read(id, league)
            val runManifest = manifest.await()
            val runCapture = capture.await()
            val (source, sourceReads) = source(looked?.second, runManifest?.value)
            val page = source?.page
            val format =
                page?.let {
                    runManifest
                        ?.value
                        ?.manifest
                        ?.formats
                        ?.firstOrNull { format -> page.formats[format.id] != null }
                }
            val clock = graph.clock
            val card =
                PlayerCards.card(
                    CardInput(week.value, page, format, runCapture?.value, inLeague, graph.zone, clock.now()),
                )
            val reads = listOf(week.at) + sourceReads + listOfNotNull(looked?.first?.at, runManifest?.at, runCapture?.at)
            SheetState.Loaded(card, Freshness.of(reads, clock.now()))
        }

    private fun failed(): SheetState = SheetState.Failed(unreadBasis(failed = true, weekTile = Words.Card.proj))

    /** The run's index entry for his slug; null where the index cannot be read, a refused token thrown. */
    private suspend fun indexEntry(): Pair<Read<List<RunIndexEntry>>, RunIndexEntry?>? = quietly { graph.lookup.entry(player.slug) }

    /** His page in the run, none where the index names none or it cannot be read. */
    private suspend fun source(
        entry: RunIndexEntry?,
        manifest: RunManifestAnswer?,
    ): Pair<PageSource?, List<ReadStamp>> {
        if (entry == null || manifest == null) return null to emptyList()
        return quietly { graph.lookup.source(entry, manifest) } ?: (null to emptyList())
    }
}

/** A read the sheet stands without: null where it fails, a refused token thrown so the app signs out. */
internal suspend fun <Value> quietly(read: suspend () -> Value): Value? =
    try {
        read()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Unauthorized) {
        throw e
    } catch (
        @Suppress("TooGenericExceptionCaught", "SwallowedException") e: Exception,
    ) {
        null
    }

/**
 * The sheet's view models, one per player (plan Review Focus 3): the sheet asks for the player the host
 * shows, and gets the view model it already made for him while it is his id, so the list under the sheet
 * reading again (his fresh facts, a new order) neither reads his week again nor changes the player it
 * shows; a sheet on another player makes his.
 */
class PlayerSheets(
    private val make: (SheetPlayer) -> PlayerSheetViewModel,
) {
    private var current: PlayerSheetViewModel? = null

    fun of(player: SheetPlayer): PlayerSheetViewModel = current?.takeIf { it.player.id == player.id } ?: make(player).also { current = it }
}
