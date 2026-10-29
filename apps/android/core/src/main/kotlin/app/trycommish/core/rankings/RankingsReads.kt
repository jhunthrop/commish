package app.trycommish.core.rankings

import app.trycommish.api.Transport
import app.trycommish.api.bodyText

/** A position our order narrows to (the route's `position` query). */
enum class OrderPosition { QB, RB, WR, TE }

/** The kickers' or defenses' week (the route's `position` query on /order/week). */
enum class WeekPosition { K, DEF }

/** One read of the order (web/src/lib/order/path.ts OrderQuery): a position or every one, the letters a
 * search holds, how many rows, and the byes last, as the Rankings page asks. */
data class OrderQuery(
    val position: OrderPosition?,
    /** Sent only from the API's fewest letters (path.ts MIN_SEARCH), trimmed. */
    val search: String?,
    val limit: Int,
    val byesLast: Boolean = true,
    /** The view's rows skipped before this page's first (Lane 280), 0 for the top. */
    val offset: Int = 0,
) {
    /** The read's route with its query, the cache key of its answer (path.ts orderPath with no league). */
    val route: String
        get() {
            val parts =
                listOfNotNull(
                    "limit=$limit",
                    position?.let { "position=${it.name}" },
                    search?.let { "q=${encoded(it)}" },
                    "byes=last".takeIf { byesLast },
                    "offset=$offset".takeIf { offset > 0 },
                )
            return "/order?${parts.joinToString("&")}"
        }

    companion object {
        /** The fewest letters a search sends (the API's minimum). */
        const val MIN_SEARCH = 2

        /** The query for the letters as typed: a search only from the API's fewest letters. */
        fun of(
            position: OrderPosition?,
            letters: String,
            limit: Int,
        ): OrderQuery = OrderQuery(position, letters.trim().takeIf { it.length >= MIN_SEARCH }, limit)

        /** Every character but a letter or digit percent-encoded as UTF-8, as the iOS route writes it. */
        private fun encoded(text: String): String =
            text.toByteArray(Charsets.UTF_8).joinToString("") { byte ->
                val char = byte.toInt().toChar()
                if (byte >= 0 && char.isLetterOrDigit()) char.toString() else "%%%02X".format(byte.toInt() and BYTE)
            }

        private const val BYTE = 0xFF
    }
}

/** The Rankings screen's reads with no league (web/src/lib/order/api.ts), each the envelope's body whole
 * so the cache keeps exactly what the API sent: our rest-of-season order with each player's week, and the
 * kickers' or defenses' week in the published projection's order. A 401 throws
 * [app.trycommish.api.Unauthorized]. */
interface RankingsReads {
    suspend fun order(query: OrderQuery): String

    suspend fun weekOrder(position: WeekPosition): String
}

/** The order's routes through the generated client. */
class ApiRankingsReads(
    private val transport: Transport,
) : RankingsReads {
    override suspend fun order(query: OrderQuery): String =
        transport
            .leagueSync()
            .order(
                position = query.position?.name,
                q = query.search,
                limit = query.limit,
                byes = if (query.byesLast) BYES_LAST else null,
                offset = query.offset.takeIf { it > 0 },
            ).bodyText()

    override suspend fun weekOrder(position: WeekPosition): String = transport.leagueSync().weekOrder(position.name).bodyText()

    private companion object {
        const val BYES_LAST = "last"
    }
}
