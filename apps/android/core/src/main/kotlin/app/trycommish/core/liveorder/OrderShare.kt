package app.trycommish.core.liveorder

import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.OrderAdvice
import app.trycommish.api.models.OrderRow
import app.trycommish.core.Clock
import app.trycommish.core.board.CaptureStamp
import app.trycommish.core.instantOrNull
import app.trycommish.core.rankings.OrderQuery
import app.trycommish.core.rankings.RankingsReads
import app.trycommish.core.rankings.RankingsUi
import app.trycommish.core.rankings.WeekPosition
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/** The order as a screen read it: the API's answer whole (the Rankings' cache keeps it), decoded, and
 * when it landed, the clock its lead says. */
class OrderAtClock(
    val body: String,
    val answer: OrderAdvice,
    val landed: Instant,
) {
    /** Each player it places with both figures, by board id. */
    val places: Map<String, LivePlace> by lazy { LiveOrder.places(answer) }

    /** Every row it returns by board id, placed or not. */
    val rows: Map<String, OrderRow> by lazy { LiveOrder.rows(answer) }

    /** When it was read (live-board.ts answerReadAt): the league's read when it says one, else the
     * screen's clock as it landed. */
    val readAt: Instant get() = instantOrNull(answer.readAt) ?: landed

    /** The capture its rows' statuses come from (live-order.ts liveCapture), null when the answer names
     * none or is older than the field (Lane 280, B257). */
    val capture: CaptureStamp?
        get() =
            answer.statusRead?.let { read ->
                instantOrNull(read.asOf)?.let { CaptureStamp(it, instantOrNull(read.checkedAt)) }
            }

    /** The lead a screen's basis says in place of the run's board sentence, for a board of `teams`. */
    fun lead(
        teams: Int,
        zone: ZoneId,
    ): String = LiveOrderWords.lead(answer, teams, readAt, zone)

    companion object {
        /** Several reads as one answer, the last one's with every read's rows (each player once): a pair
         * read by its two names; null for none. */
        fun merged(reads: List<OrderAtClock>): OrderAtClock? {
            val last = reads.lastOrNull() ?: return null
            val rows = reads.flatMap { it.answer.rows }.distinctBy { it.line.player.boardId ?: it.line.player.name }
            return OrderAtClock(last.body, last.answer.copy(rows = rows), last.landed)
        }
    }
}

/** A read in flight whose reader was cancelled before it answered: a screen waiting on it reads again. */
private class ReadAbandoned : Exception("The read was cancelled before it answered.")

/**
 * The orders the app's screens share, by read (Lane 226, the iOS OrderMemo's twin): each one's answer
 * last read and its read in flight, so the Rankings, the Board, the clubs index and a club or a pair
 * opened together ask the API once for each. A read is keyed by its route in any case ("CHI" and "chi"
 * are one read). The route answers with no ETag, so an answer is reused for [WINDOW] and never kept past
 * it (one past its window is dropped when the next answer is kept): a saved order would be a third clock,
 * so a screen with no answer keeps the run's figures with the run's stamp. The Rankings read through it
 * too (it is their [RankingsReads]), but on their own route: their page numbers the byes last
 * (`byes=last`, the week's byes section, Lane 163 D06) and reads a hundred rows at a time, while the
 * screens read the byes in their places and the API's most rows ([OrderReader.query]). Neither query is
 * a superset of the other, so the Rankings and the screens never share one answer; each keeps its own
 * clock within the window (Lane 243, B251, the Lane 226 review's L1).
 */
class OrderShare(
    private val reads: RankingsReads,
    private val clock: Clock,
) : RankingsReads {
    private val lock = Mutex()
    private val last = mutableMapOf<String, OrderAtClock>()
    private val flights = mutableMapOf<String, CompletableDeferred<OrderAtClock>>()

    /** The answers kept, for the tests of the window. */
    internal suspend fun kept(): Int = lock.withLock { last.size }

    override suspend fun order(query: OrderQuery): String = read(query).body

    override suspend fun weekOrder(position: WeekPosition): String = reads.weekOrder(position)

    /** The read's answer read within the window of now, else its read in flight, else a read made now. */
    suspend fun read(query: OrderQuery): OrderAtClock {
        val key = query.route.lowercase()
        while (true) {
            val (flight, mine) =
                lock.withLock {
                    last[key]?.takeIf { fresh(it, clock.now()) }?.let { return it }
                    flights[key]?.let { it to false } ?: (CompletableDeferred<OrderAtClock>().also { flights[key] = it } to true)
                }
            if (mine) return fly(key, query, flight)
            try {
                return flight.await()
            } catch (e: ReadAbandoned) {
                // Its reader left before it answered: read again.
            }
        }
    }

    private suspend fun fly(
        key: String,
        query: OrderQuery,
        flight: CompletableDeferred<OrderAtClock>,
    ): OrderAtClock {
        try {
            val body = reads.order(query)
            val answer = OrderAtClock(body, decodeEnvelope(body), clock.now())
            lock.withLock {
                flights.remove(key)
                val now = clock.now()
                last.entries.removeAll { !fresh(it.value, now) }
                last[key] = answer
            }
            flight.complete(answer)
            return answer
        } catch (e: CancellationException) {
            withContext(NonCancellable) { lock.withLock { flights.remove(key) } }
            flight.completeExceptionally(ReadAbandoned())
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            lock.withLock { flights.remove(key) }
            flight.completeExceptionally(e)
            throw e
        }
    }

    private fun fresh(
        answer: OrderAtClock,
        now: Instant,
    ): Boolean = Duration.between(answer.landed, now) < WINDOW

    companion object {
        /** How long an answer stands for another screen opened after it. */
        val WINDOW: Duration = Duration.ofSeconds(60)
    }
}

/**
 * Our order read at a screen's clock (Lane 226, the iOS OrderReader's), through the share: the in-season
 * pages' read with no league (GET /order, the API's most rows, the byes in their places as the web's
 * live-order-read.ts reads it, so a bye club's players are within the rows). The order ranks more
 * players than one read gives, so a screen that draws a club's or a pair's players reads them by their
 * club or name (`search`), as the web's club page and Compare do; the API numbers every row before the
 * search, so a match keeps his place.
 */
class OrderReader(
    private val share: OrderShare,
    /** The rows one page asks for, the API's most ([RankingsUi.MAX_ROWS]); a test pages smaller. */
    private val pageSize: Int = RankingsUi.MAX_ROWS,
) {
    /** The whole order (Lane 280): its first page, then the next from where the last ended until the
     * answer holds every row its total counts, merged to one answer, so an uncut answer is the normal
     * state and a player the order omits is drawn from the run. A later page that fails, or adds no row,
     * stops the reading: the answer stays cut and the screen says its reach, as before. */
    suspend fun read(search: String? = null): OrderAtClock {
        val first = share.read(query(search, pageSize))
        val pages = mutableListOf(first)
        var read = first.answer.rows.size
        while (read < first.answer.total) {
            val next = laterPage(search, read) ?: break
            if (next.answer.rows.isEmpty()) break
            pages += next
            read += next.answer.rows.size
        }
        return OrderAtClock.merged(pages) ?: first
    }

    /** A page after the first, or null where it fails (a cancelled read is still cancelled). */
    private suspend fun laterPage(
        search: String?,
        offset: Int,
    ): OrderAtClock? =
        try {
            share.read(query(search, pageSize, offset))
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            null
        }

    /** The read, or null where it fails: a screen with no answer keeps the run's (a cancelled read is
     * still cancelled). */
    suspend fun readOrNull(search: String? = null): OrderAtClock? =
        try {
            read(search)
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            null
        }

    companion object {
        /** The in-season pages' read for `search` (letters of a name or a club), every player with none. */
        fun query(
            search: String?,
            limit: Int = RankingsUi.MAX_ROWS,
            offset: Int = 0,
        ): OrderQuery = OrderQuery(null, search, limit, byesLast = false, offset = offset)
    }
}
