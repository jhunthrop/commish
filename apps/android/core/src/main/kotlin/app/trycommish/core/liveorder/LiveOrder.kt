package app.trycommish.core.liveorder

import app.trycommish.api.models.OrderAdvice
import app.trycommish.api.models.OrderRow
import app.trycommish.api.models.RunBoardRow
import app.trycommish.api.models.RunFormat
import app.trycommish.core.player.CardTiles
import app.trycommish.core.rankings.RankingsRows
import kotlin.math.ceil

/** A player's place in the order at the read's clock (web/src/lib/run/live-order.ts LivePlace): his
 * number in the full order (overall.ts overallOf, Lane 234), his place at his position (null for a
 * player on a season-long list, whose run row says the list's word), his points and his value. */
data class LivePlace(
    val rank: Int,
    val positionRank: Int?,
    val projected: Double,
    val vor: Double,
) {
    /** His figures at the read's clock on a board of `teams` (live-order.ts placedAt): a listed player
     * keeps the run's place at his position, `runPositionRank`; the run's Gap (its ADP less its own rank)
     * is left unsaid. */
    fun figures(
        teams: Int,
        runPositionRank: Int,
    ): PlacedFigures =
        PlacedFigures(
            ourRank = rank,
            positionRank = positionRank ?: runPositionRank,
            projected = projected,
            vor = vor,
            vorRound = ceil(rank.toDouble() / teams).toInt(),
            gap = null,
        )
}

/** The figures a row ranks and scores a player by, on one clock: the run's, or the order's put on the
 * run's row (live-order.ts Placed). */
data class PlacedFigures(
    val ourRank: Int,
    val positionRank: Int,
    val projected: Double,
    val vor: Double,
    val vorRound: Int,
    val gap: Double?,
) {
    /** The order's figures for this row's player. */
    fun at(
        place: LivePlace,
        teams: Int,
    ): PlacedFigures = place.figures(teams, positionRank)

    companion object {
        /** A run row's own figures. */
        fun of(row: RunBoardRow): PlacedFigures =
            PlacedFigures(row.ourRank, row.positionRank, row.projected.toDouble(), row.vor.toDouble(), row.vorRound, row.gap?.toDouble())
    }
}

/** A row with its place in the order. */
data class PlacedRow<Row>(
    val row: Row,
    val place: LivePlace,
)

/**
 * The order at a screen's clock, as every in-season screen reads it (Lane 226, the iOS LiveOrder's twin,
 * from the web's Lane 220, B184): the run is our rest-of-season board at the nightly's instant and the
 * API's order the same board at the read's clock, a club's games kicked off since taken out. Once the
 * season is under way a screen that ranks or scores a player prints the order's figures, the ones the
 * Rankings read; a screen whose rows the answer does not all place keeps the run's, every row, so no
 * table mixes the two clocks. Pure, so the tests read every figure a screen prints.
 */
object LiveOrder {
    /** Each player the answer places with both figures, by board id (livePlaces). */
    fun places(answer: OrderAdvice): Map<String, LivePlace> =
        answer.rows
            .mapNotNull { row ->
                val id = row.line.player.boardId ?: return@mapNotNull null
                val projected = row.restOfSeasonPoints ?: return@mapNotNull null
                val vor = row.pointsOverReplacement ?: return@mapNotNull null
                id to LivePlace(RankingsRows.overall(row), row.line.positionRank, projected, vor)
            }.toMap()

    /** Every row the answer returns, by board id, with figures or without: a row with none (a player put
     * on a list after the nightly) is still the order's, drawn with its status's word (Lane 243, B251). A
     * board id the answer repeats keeps its first row, as on iOS. */
    fun rows(answer: OrderAdvice): Map<String, OrderRow> =
        buildMap {
            answer.rows.forEach { row ->
                row.line.player.boardId
                    ?.let { putIfAbsent(it, row) }
            }
        }

    /** Whether the answer is cut: the view holds more players than the rows it returned (its limit). */
    fun cut(answer: OrderAdvice): Boolean = answer.total > answer.rows.size

    /** Every row with its place, in the order's order, or null when the answer does not place one of
     * them: the screen then keeps the run's rows, never a table half one board and half the other
     * (placedRows). */
    fun <Row> placed(
        rows: List<Row>,
        id: (Row) -> String,
        places: Map<String, LivePlace>,
    ): List<PlacedRow<Row>>? {
        val out = rows.map { row -> PlacedRow(row, places[id(row)] ?: return null) }
        return out.sortedBy { it.place.rank }
    }

    /** Whether the order's answer is in the board format's scoring (inScoring): the public order is PPR,
     * so a screen whose board is in another scoring, or a format with no API name, never draws it. */
    fun inScoring(
        answer: OrderAdvice,
        format: RunFormat,
    ): Boolean = CardTiles.apiFormatOf(format)?.let { it == answer.projectionScoring.format.value } ?: false

    /** The places Compare draws its pair from (placedPair): the order's, only in the board's own format
     * (the one the order is read in) and only when it places both players; else none, and both sides keep
     * the run's, never one side of each. */
    fun pair(
        ids: List<String>,
        places: Map<String, LivePlace>?,
        format: String,
        boardFormat: String?,
    ): Map<String, LivePlace>? = places?.takeIf { format == boardFormat && ids.all { it in places } }

    /** A screen's basis on the clock its rows are on (basisAtClock): the order's lead in place of the
     * run's board sentence once the order's rows stand, led by it where the basis names no board; before
     * it answers, or when it fails, the run's basis with the run's stamp after it. */
    fun basis(
        run: List<String>,
        board: String?,
        lead: String?,
        stamp: String?,
    ): List<String> {
        if (lead == null) return run + listOfNotNull(stamp)
        val index = board?.let { run.indexOf(it) } ?: -1
        return if (index < 0) listOf(lead) + run else run.mapIndexed { i, part -> if (i == index) lead else part }
    }
}
