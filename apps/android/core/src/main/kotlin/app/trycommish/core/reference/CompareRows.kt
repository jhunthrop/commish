package app.trycommish.core.reference

import app.trycommish.api.models.DesignationStatus
import app.trycommish.api.models.RunBoardRow
import app.trycommish.api.models.RunPlayerFormat
import app.trycommish.api.models.RunPlayerStatus
import app.trycommish.api.models.RunPriorSeason
import app.trycommish.core.Format
import app.trycommish.core.board.BoardFigures
import app.trycommish.core.board.GapTone
import app.trycommish.core.start.RowStatuses
import app.trycommish.core.start.StartRows
import app.trycommish.design.Words

/** A side's floor, median and ceiling, and the scale the pair's bars share. */
data class CompareRange(
    val floor: Double,
    val median: Double,
    val ceiling: Double,
)

/** A side's numbers in the compared format (schema.ts PlayerFormat), from his page or, for a page the run
 * held with no copy, the leading board's row. */
data class CompareNumbers(
    val ourRank: Int,
    val positionRank: Int,
    val projected: Double,
    val vor: Double,
    val adp: Double?,
    val gap: Double?,
    val floor: Double?,
    val median: Double?,
    val ceiling: Double?,
) {
    /** compare-rows.ts sideRange: all three, or none. */
    val range: CompareRange?
        get() = if (floor != null && median != null && ceiling != null) CompareRange(floor, median, ceiling) else null

    companion object {
        fun of(format: RunPlayerFormat): CompareNumbers =
            CompareNumbers(
                format.ourRank,
                format.positionRank,
                format.projected.toDouble(),
                format.vor.toDouble(),
                format.adp?.toDouble(),
                format.gap?.toDouble(),
                format.floor?.toDouble(),
                format.median?.toDouble(),
                format.ceiling?.toDouble(),
            )

        fun of(row: RunBoardRow): CompareNumbers =
            CompareNumbers(
                row.ourRank,
                row.positionRank,
                row.projected.toDouble(),
                row.vor.toDouble(),
                row.adp?.toDouble(),
                row.gap?.toDouble(),
                row.floor?.toDouble(),
                row.median?.toDouble(),
                row.ceiling?.toDouble(),
            )
    }
}

/** His season so far: games and points a game. */
data class SeasonSoFar(
    val games: Int,
    val pointsPerGame: Double?,
)

/** One player as Compare reads him (site/player-data.ts PlayerData): who he is, his numbers in every format
 * the run gives him, his status on the capture, his season so far and last season's line. */
data class ComparePlayer(
    val id: String,
    val slug: String,
    val name: String,
    val position: String,
    val team: String,
    val headshot: String?,
    val formats: Map<String, CompareNumbers>,
    val status: RunPlayerStatus?,
    val seasonSoFar: SeasonSoFar?,
    val lastSeasonPerGame: Double?,
    val priorSeasons: List<RunPriorSeason>,
) {
    /** The word a season-long list gives his ranks ("IR"), null for anyone else. */
    val heldRank: String? get() = heldStatus?.let(RowStatuses::rankWord)

    /** His season-long designation, null when he is available. */
    val heldStatus: DesignationStatus?
        get() = status?.takeIf { it.seasonLong }?.status?.takeUnless { it == DesignationStatus.unknown_default_open_api }

    /** His status on the capture and last season's points a game, the run's season less one. */
    fun with(
        status: RunPlayerStatus?,
        season: Int,
    ): ComparePlayer =
        copy(
            status = status,
            lastSeasonPerGame = priorSeasons.firstOrNull { it.season == season - 1 }?.pointsPerGame?.toDouble(),
        )
}

/** One side of the table: the player, his numbers in the compared format, his club's bye. */
data class CompareSide(
    val player: ComparePlayer,
    val numbers: CompareNumbers,
    val bye: Int?,
)

/** A cell of the table: its words, whether it is the better of the two (null where the row has no better)
 * and a signed gap's tone. */
data class CompareCell(
    val text: String,
    val wins: Boolean?,
    val tone: GapTone?,
)

/** A row of the table: its label and the two cells, the leader's first; a range row draws bars. */
data class CompareRow(
    val label: String,
    val cells: List<CompareCell>,
    val range: Boolean,
)

/** Compare's table row by row (web/src/lib/site/compare-rows.ts), ported and held to
 * shared/fixtures/parity/reference.json. */
object CompareRows {
    /** The Gap row's label, which the basis reads to say the Gap's sentence only beside it. */
    const val GAP_LABEL = "Gap"

    /** Which figure is better: the higher or the lower. */
    enum class Better { Higher, Lower }

    fun figures(
        label: String,
        values: Pair<Double?, Double?>,
        text: (Double) -> String,
        better: Better?,
    ): CompareRow {
        val (lhs, rhs) = values
        val leftWins =
            if (better == null || lhs == null || rhs == null || lhs == rhs) {
                null
            } else {
                if (better == Better.Higher) lhs > rhs else lhs < rhs
            }
        val judged = leftWins != null

        fun cell(
            value: Double?,
            wins: Boolean,
        ) = CompareCell(value?.let(text) ?: Words.Box.none, if (judged) wins else null, null)
        return CompareRow(label, listOf(cell(lhs, leftWins == true), cell(rhs, leftWins == false)), range = false)
    }

    /** A rank row: the lower rank wins, unless a side is on a season-long list. */
    private fun rank(
        label: String,
        ranks: Pair<Int, Int>,
        words: Pair<String, String>,
        judged: Boolean,
    ): CompareRow {
        val row =
            figures(label, ranks.first.toDouble() to ranks.second.toDouble(), { it.toInt().toString() }, Better.Lower.takeIf { judged })
        return CompareRow(
            label,
            listOf(CompareCell(words.first, row.cells[0].wins, null), CompareCell(words.second, row.cells[1].wins, null)),
            range = false,
        )
    }

    fun rows(
        first: CompareSide,
        second: CompareSide,
        season: Int,
        underway: Boolean,
    ): List<CompareRow> {
        fun <T> pair(read: (CompareSide) -> T): Pair<T, T> = read(first) to read(second)
        val held = pair { it.player.heldRank }
        val judged = held.first == null && held.second == null
        val fixed = { value: Double -> Format.fixed(value) }
        val whole = { value: Double -> value.toInt().toString() }
        val rows = mutableListOf<CompareRow>()
        rows += rank("Our rank", pair { it.numbers.ourRank }, pair { it.player.heldRank ?: it.numbers.ourRank.toString() }, judged)
        rows +=
            rank(
                "Position rank",
                pair { it.numbers.positionRank },
                pair { "${it.player.position} ${it.player.heldRank ?: it.numbers.positionRank.toString()}" },
                judged,
            )
        rows += figures(Words.Figure.projected, pair { it.numbers.projected }, fixed, Better.Higher)
        rows += figures("Over replacement", pair { it.numbers.vor }, BoardFigures::signed, Better.Higher)
        rows += rangeRow(pair { it.numbers.range != null })
        rows += figures(Words.Board.adp, pair { it.numbers.adp }, fixed, null)
        rows += gapRow(pair { if (it.player.heldRank == null) it.numbers.gap else null })
        rows += figures(Words.Board.bye, pair { it.bye?.toDouble() }, whole, null)
        if (underway) {
            rows += figures(Words.Figure.avg, pair { it.player.seasonSoFar?.pointsPerGame }, fixed, Better.Higher)
            rows +=
                figures(
                    "GP",
                    pair {
                        it.player.seasonSoFar
                            ?.games
                            ?.toDouble()
                    },
                    whole,
                    null,
                )
        }
        rows += figures("${season - 1} ${Words.Figure.avg}", pair { it.player.lastSeasonPerGame }, fixed, Better.Higher)
        return rows
    }

    /** The Gap row, only when one of the pair carries the run's gap; none for a held side. */
    private fun gapRow(gaps: Pair<Double?, Double?>): List<CompareRow> {
        if (gaps.first == null && gaps.second == null) return emptyList()
        val cell = { value: Double? -> CompareCell(BoardFigures.gap(value), null, GapTone.of(value)) }
        return listOf(CompareRow(GAP_LABEL, listOf(cell(gaps.first), cell(gaps.second)), range = false))
    }

    /** The Floor to ceiling row, only when one of the pair carries a range: bars, or the empty mark. */
    private fun rangeRow(ranged: Pair<Boolean, Boolean>): List<CompareRow> {
        if (!ranged.first && !ranged.second) return emptyList()
        val cells = listOf(ranged.first, ranged.second).map { CompareCell(if (it) "" else Words.Box.none, null, null) }
        return listOf(CompareRow("Floor to ceiling", cells, range = true))
    }
}

/** Our call between two players (web/src/lib/site/verdict.ts), ported: the table's head cell and its one
 * evidence line. */
sealed interface Verdict {
    data object Same : Verdict

    data class Call(
        val leader: CompareSide,
        val other: CompareSide,
        val call: String,
        val evidence: String,
    ) : Verdict

    companion object {
        fun between(
            lhs: CompareSide,
            rhs: CompareSide,
            formatLabel: String,
        ): Verdict {
            if (lhs.player.id == rhs.player.id) return Same
            if (lhs.player.heldStatus != null || rhs.player.heldStatus != null) return heldCall(lhs, rhs, formatLabel)
            val (leader, other) = if (lhs.numbers.ourRank <= rhs.numbers.ourRank) lhs to rhs else rhs to lhs
            val (leaderName, otherName) = names(leader, other)
            return called(
                leader,
                other,
                leaderName,
                "$leaderName is ${Format.ordinal(leader.numbers.ourRank)} on our $formatLabel board and $otherName " +
                    "${Format.ordinal(other.numbers.ourRank)}, with ${BoardFigures.signed(leader.numbers.vor)} over " +
                    "replacement against ${BoardFigures.signed(other.numbers.vor)}.",
            )
        }

        private fun names(
            leader: CompareSide,
            other: CompareSide,
        ): Pair<String, String> {
            val shared = StartRows.lastName(leader.player.name) == StartRows.lastName(other.player.name)
            return if (shared) {
                leader.player.name to other.player.name
            } else {
                StartRows.lastName(leader.player.name) to StartRows.lastName(other.player.name)
            }
        }

        private fun called(
            leader: CompareSide,
            other: CompareSide,
            leaderName: String,
            evidence: String,
        ): Verdict = Call(leader, other, "We would take $leaderName", evidence)

        private fun heldCall(
            lhs: CompareSide,
            rhs: CompareSide,
            formatLabel: String,
        ): Verdict {
            val lhsHeld = lhs.player.heldStatus
            val rhsHeld = rhs.player.heldStatus
            if (lhsHeld != null && rhsHeld != null) {
                val (leader, other) = if (lhs.numbers.vor >= rhs.numbers.vor) lhs to rhs else rhs to lhs
                val (leaderName, _) = names(leader, other)
                return called(
                    leader,
                    other,
                    leaderName,
                    "Both are on season-long lists, so neither sits above the available players on our $formatLabel board. " +
                        "If both play, $leaderName has ${BoardFigures.signed(leader.numbers.vor)} over replacement against " +
                        "${BoardFigures.signed(other.numbers.vor)}.",
                )
            }
            val status = lhsHeld ?: rhsHeld
            val (leader, other) = if (lhsHeld != null) rhs to lhs else lhs to rhs
            val (leaderName, otherName) = names(leader, other)
            val word = status?.let(RowStatuses::word).orEmpty()
            return called(
                leader,
                other,
                leaderName,
                "$otherName is ${word.take(
                    1,
                ).lowercase()}${word.drop(1)}, so he sits below the available players on our $formatLabel board.",
            )
        }
    }
}
