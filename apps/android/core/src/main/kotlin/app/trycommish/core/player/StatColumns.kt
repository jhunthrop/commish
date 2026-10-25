package app.trycommish.core.player

import app.trycommish.api.models.RunGameLogRow
import app.trycommish.api.models.RunStatLine
import app.trycommish.core.Format
import kotlin.math.floor

/** A stat line's figures as the game log reads them: a week's row and a season's totals carry the same. */
internal data class StatFigures(
    val passAttempts: Double?,
    val completions: Double?,
    val passingYards: Double?,
    val passingTouchdowns: Double?,
    val interceptions: Double?,
    val carries: Double?,
    val rushingYards: Double?,
    val rushingTouchdowns: Double?,
    val targets: Double?,
    val receptions: Double?,
    val receivingYards: Double?,
    val receivingTouchdowns: Double?,
    val fumblesLost: Double?,
    val fieldGoalsMade: Double?,
    val extraPointsMade: Double?,
    val sacks: Double?,
    val defensiveInterceptions: Double?,
    val defensiveTouchdowns: Double?,
    val snapShare: Double?,
) {
    companion object {
        fun of(line: RunStatLine): StatFigures =
            StatFigures(
                line.passAttempts?.toDouble(),
                line.completions?.toDouble(),
                line.passingYards?.toDouble(),
                line.passingTouchdowns?.toDouble(),
                line.interceptions?.toDouble(),
                line.carries?.toDouble(),
                line.rushingYards?.toDouble(),
                line.rushingTouchdowns?.toDouble(),
                line.targets?.toDouble(),
                line.receptions?.toDouble(),
                line.receivingYards?.toDouble(),
                line.receivingTouchdowns?.toDouble(),
                line.fumblesLost?.toDouble(),
                line.fieldGoalsMade?.toDouble(),
                line.extraPointsMade?.toDouble(),
                line.sacks?.toDouble(),
                line.defensiveInterceptions?.toDouble(),
                line.defensiveTouchdowns?.toDouble(),
                line.snapShare?.toDouble(),
            )

        fun of(row: RunGameLogRow): StatFigures =
            StatFigures(
                row.passAttempts?.toDouble(),
                row.completions?.toDouble(),
                row.passingYards?.toDouble(),
                row.passingTouchdowns?.toDouble(),
                row.interceptions?.toDouble(),
                row.carries?.toDouble(),
                row.rushingYards?.toDouble(),
                row.rushingTouchdowns?.toDouble(),
                row.targets?.toDouble(),
                row.receptions?.toDouble(),
                row.receivingYards?.toDouble(),
                row.receivingTouchdowns?.toDouble(),
                row.fumblesLost?.toDouble(),
                row.fieldGoalsMade?.toDouble(),
                row.extraPointsMade?.toDouble(),
                row.sacks?.toDouble(),
                row.defensiveInterceptions?.toDouble(),
                row.defensiveTouchdowns?.toDouble(),
                row.snapShare?.toDouble(),
            )
    }
}

/** A game log column (run/stat-columns.ts StatColumn): its short head, its full words, those words for a
 * total of exactly 1, and its figure from a line. */
internal class StatColumn(
    val short: String,
    val full: String,
    private val one: String,
    val value: (StatFigures) -> String,
) {
    /** stat-columns.ts captionFor: the singular for exactly 1. */
    fun caption(value: String): String = if (value == "1") one else full
}

/** stat-columns.ts STAT_COLUMNS by position, ported. */
internal object StatColumns {
    private const val PERCENT = 100.0
    private const val HALF = 0.5

    private fun figure(value: Double?): String = value?.let(Format::whole).orEmpty()

    private fun stat(
        short: String,
        full: String,
        one: String,
        field: (StatFigures) -> Double?,
    ): StatColumn = StatColumn(short, full, one) { figure(field(it)) }

    private val completions =
        StatColumn("Comp/att", "completions of attempts", "completions of attempts") { line ->
            val made = line.completions
            val tried = line.passAttempts
            if (made == null || tried == null) "" else "${Format.whole(made)}/${Format.whole(tried)}"
        }

    private val snaps =
        StatColumn("Snap %", "share of snaps", "share of snaps") { line ->
            line.snapShare?.let { "${floor(it * PERCENT + HALF).toInt()}%" }.orEmpty()
        }

    private val rushing =
        listOf(
            stat("Car", "carries", "carry") { it.carries },
            stat("Rush yds", "rushing yards", "rushing yard") { it.rushingYards },
            stat("Rush TD", "rushing touchdowns", "rushing touchdown") { it.rushingTouchdowns },
        )
    private val fumbles = stat("Fum", "fumbles lost", "fumble lost") { it.fumblesLost }
    private val catching =
        listOf(stat("Tgt", "targets", "target") { it.targets }, stat("Rec", "catches", "catch") { it.receptions })
    private val receiver =
        catching +
            listOf(
                stat("Yds", "receiving yards", "receiving yard") { it.receivingYards },
                stat("TD", "receiving touchdowns", "receiving touchdown") { it.receivingTouchdowns },
            ) + rushing + snaps

    fun of(position: String): List<StatColumn> =
        when (position) {
            "QB" ->
                listOf(
                    completions,
                    stat("Yds", "passing yards", "passing yard") { it.passingYards },
                    stat("TD", "passing touchdowns", "passing touchdown") { it.passingTouchdowns },
                    stat("INT", "interceptions", "interception") { it.interceptions },
                ) + rushing + fumbles
            "RB" ->
                listOf(
                    stat("Car", "carries", "carry") { it.carries },
                    stat("Yds", "rushing yards", "rushing yard") { it.rushingYards },
                    stat("TD", "rushing touchdowns", "rushing touchdown") { it.rushingTouchdowns },
                ) + catching +
                    listOf(
                        stat("Rec yds", "receiving yards", "receiving yard") { it.receivingYards },
                        stat("Rec TD", "receiving touchdowns", "receiving touchdown") { it.receivingTouchdowns },
                        fumbles,
                        snaps,
                    )
            "K" ->
                listOf(
                    stat("FG", "field goals made", "field goal made") { it.fieldGoalsMade },
                    stat("XP", "extra points made", "extra point made") { it.extraPointsMade },
                )
            "DST" ->
                listOf(
                    stat("Sacks", "sacks", "sack") { it.sacks },
                    stat("INT", "interceptions", "interception") { it.defensiveInterceptions },
                    stat("TD", "defensive touchdowns", "defensive touchdown") { it.defensiveTouchdowns },
                )
            else -> receiver
        }
}
