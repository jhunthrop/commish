package app.trycommish.core.record

import app.trycommish.api.models.RunRecordLine
import app.trycommish.api.models.RunScore
import app.trycommish.core.Format
import app.trycommish.design.Words
import java.math.BigDecimal
import kotlin.math.abs

/** Who leads a pair (record-pair.ts PairLeader), by the parity file's names. */
enum class PairLeader(
    val word: String,
) {
    Ours("ours"),
    Theirs("theirs"),
    Level("level"),
}

/** One figure for ours and a yardstick at one size, the leader named under them (record-pair.ts
 * FigurePair): "level", "ours by 0.2", "ADP by 3". Ours is accented only where it leads. */
data class FigurePair(
    val ours: String,
    val theirs: String,
    /** The yardstick's name over its figure: "ADP", "ESPN". */
    val name: String,
    val leader: PairLeader?,
    val lead: String?,
) {
    /** record-pair.ts oursAccented. */
    val accented: Boolean get() = leader == PairLeader.Ours

    internal companion object {
        /** record-pair.ts figurePair: both printed as their cells print them, the leader by the figure's
         * own direction (places off lower), the margin at the figure's places. */
        fun of(
            ours: RunScore?,
            theirs: RunScore?,
            figure: RecordFigure,
            name: String,
        ): FigurePair {
            val printed = RecordWords.figure(ours, figure) to RecordWords.figure(theirs, figure)
            val mine = ours?.let { units(it, figure) }
            val other = theirs?.let { units(it, figure) }
            if (mine == null || other == null) return FigurePair(printed.first, printed.second, name, null, null)
            if (mine == other) return FigurePair(printed.first, printed.second, name, PairLeader.Level, Words.Pair.level)
            val oursAhead = if (figure == RecordFigure.PlacesOff) mine < other else mine > other
            val places = places(figure)
            val margin = Format.fixed(abs(mine - other) / Math.pow(TEN, places.toDouble()), places)
            return FigurePair(
                printed.first,
                printed.second,
                name,
                if (oursAhead) PairLeader.Ours else PairLeader.Theirs,
                "${if (oursAhead) Words.Pair.oursBy else name} by $margin",
            )
        }

        private fun places(figure: RecordFigure): Int =
            when (figure) {
                RecordFigure.Agreement -> RecordWords.RATE_PLACES
                RecordFigure.PlacesOff -> 1
                RecordFigure.Starters -> 0
            }

        /** record-pair.ts units: the printed figure's digits as a whole count. */
        private fun units(
            score: RunScore,
            figure: RecordFigure,
        ): Int? {
            val value: BigDecimal =
                when (figure) {
                    RecordFigure.Agreement -> score.agreement
                    RecordFigure.PlacesOff -> score.placesOff
                    RecordFigure.Starters -> if (score.startersOf == 0) null else BigDecimal(score.starters)
                } ?: return null
            val places = places(figure)
            if (places == 0) return value.toInt()
            return RecordWords.printPlaces(value, places).replace(".", "").toIntOrNull()
        }

        private const val TEN = 10.0
    }
}

/** The record's orders and pairs (record.ts sourceDrawn, records.ts weeklySources and weeklyPairs). */
internal object RecordPairs {
    /** record.ts sourceDrawn: ours always, a yardstick once the season to date carries it. */
    fun drawn(
        book: RecordBook,
        source: RecordSource,
    ): Boolean = source == RecordSource.Ours || book.toDate.any { RecordWords.score(it, source) != null }

    /** The orders the run's own record draws (record.ts recordSources). */
    fun sources(book: RecordBook): List<RecordSource> = RecordSource.entries.filter { drawn(book, it) }

    /** records.ts weeklySources: ours, ESPN from its first week, the published projection once graded. */
    fun weeklySources(book: RecordBook): List<RecordSource> =
        listOf(RecordSource.Ours, RecordSource.Espn) + listOfNotNull(RecordSource.Published.takeIf { drawn(book, it) })

    /** records.ts weeklyPairs: ours beside each yardstick drawn, ours pooled again over the weeks that
     * graded it. */
    fun weekly(
        line: RunRecordLine?,
        figure: RecordFigure,
        sources: List<RecordSource>,
    ): List<FigurePair> =
        sources.filter { it == RecordSource.Espn || it == RecordSource.Published }.map { source ->
            FigurePair.of(RecordWords.oursOn(line, source) ?: line?.ours, RecordWords.score(line, source), figure, RecordWords.head(source))
        }

    /** records.ts oursLeadsAll: ours accented only where it leads every yardstick graded there. */
    fun oursLeadsAll(pairs: List<FigurePair>): Boolean {
        val graded = pairs.filter { it.leader != null }
        return graded.isNotEmpty() && graded.all { it.leader == PairLeader.Ours }
    }
}
