package app.trycommish.core.liveorder

import app.trycommish.api.Transport
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.SystemClock
import app.trycommish.core.board.ApiRunReads
import app.trycommish.core.board.BoardState
import app.trycommish.core.board.BoardViewModel
import app.trycommish.core.player.ApiPlayerReads
import app.trycommish.core.rankings.ApiRankingsReads
import app.trycommish.core.reference.ClubScreens
import app.trycommish.core.reference.CompareOutcome
import app.trycommish.core.reference.CompareReader
import app.trycommish.core.reference.ReferenceReads
import app.trycommish.core.reference.RunScreenState
import app.trycommish.core.reference.RunScreenViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.ZoneId

/** The in-season screens read once from a running API through the app's own client (COMMISH_LIVE_API, a
 * lane's dev API against its own database, never production): the Board, a club, the clubs index and
 * Compare, each on the order's clock where it answers, else on the run's with the run's stamp. Skipped
 * with no API named. Prints what it read for the lane's report. */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveOneValueTest {
    private val api: String? = System.getenv("COMMISH_LIVE_API")
    private val zone = ZoneId.of("America/Chicago")

    @BeforeEach
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun <Model> loaded(vm: RunScreenViewModel<Model>): Model {
        runBlocking { vm.load().join() }
        return (vm.state.value as RunScreenState.Loaded).model
    }

    @Test
    fun `the in-season screens read the live run and say their clock`() {
        assumeTrue(api != null, "no live API named")
        val transport = Transport(requireNotNull(api), token = { null })
        val orders = OrderReader(OrderShare(ApiRankingsReads(transport), SystemClock))
        val read = orders.let { runBlocking { it.readOrNull() } }
        println("order: ${if (read == null) "unread" else "${read.answer.rows.size} rows of ${read.answer.total}"}")
        val runs = ApiRunReads(transport)
        val board = BoardViewModel(runs, MemoryCache(), SystemClock, zone, true, false, SessionEnd {}, orders)
        runBlocking { board.load().join() }
        val model = (board.state.value as BoardState.Loaded).model
        println("board: ${model.rows.size} rows, at the clock ${model.atClock}, basis ${model.basis.joinToString(" | ")}")
        val references = ReferenceReads(runs, ApiPlayerReads(transport), MemoryCache(), SystemClock)
        val club = loaded(ClubScreens.club("det", references, zone, SessionEnd {}, orders))
        println("DET: ${club.rows.size} rows, ${club.boardHead}, at the clock ${club.atClock}, last ${club.basis.last()}")
        val clubs = loaded(ClubScreens.clubs(references, zone, SessionEnd {}, orders))
        println("clubs: at the clock ${clubs.atClock}, basis ${clubs.basis.joinToString(" | ")}")
        val pair = club.compare?.slugs.orEmpty()
        val compare = loaded(CompareReader.viewModel(pair, null, references, zone, SessionEnd {}, orders))
        val table = (compare.outcome as? CompareOutcome.Table)?.table
        println("compare ${pair.joinToString(" and ")}: at the clock ${compare.atClock}, last ${table?.basis?.lastOrNull()}")
    }
}
