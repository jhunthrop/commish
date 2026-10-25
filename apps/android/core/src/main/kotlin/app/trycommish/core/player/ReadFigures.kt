package app.trycommish.core.player

import app.trycommish.api.models.RunPullFigure
import app.trycommish.core.Format
import app.trycommish.design.Words

/** A figure set beside the season read, with the word or two naming its basis where it has one
 * (web/src/lib/run/read-figures.ts ReadFigure). */
data class ReadFigure(
    val label: String?,
    val figure: String,
    val caption: String,
)

/** read-figures.ts readFigures before the run ranks the rest of the season, the page's only form of it
 * (the season read shows only then): the writer's pulls as written, the one that is his projection and a
 * tier gap each named preseason. */
object ReadFigures {
    /** A pull about a tier: the gap to the next one, from the preseason tiers. */
    private val tier = Regex("\\btiers?\\b", RegexOption.IGNORE_CASE)

    /** A number as prose writes it, thousands commas allowed: its decimals captured. */
    private val number = Regex("^[+-]?\\d[\\d,]*(?:\\.(\\d+))?$")

    fun preseason(
        pulls: List<RunPullFigure>,
        projection: Double,
    ): List<ReadFigure> =
        pulls.map { pull ->
            val label =
                when {
                    writes(pull.figure, projection) -> Words.ReadFigures.preseasonProjection
                    tier.containsMatchIn(pull.caption) -> Words.ReadFigures.preseasonTiers
                    else -> null
                }
            ReadFigure(label, pull.figure, pull.caption)
        }

    /** Whether a figure as the prose writes it is this value at the figure's own precision. */
    fun writes(
        figure: String,
        value: Double,
    ): Boolean {
        val match = number.matchEntire(figure) ?: return false
        val decimals = match.groupValues[1].length
        val written = figure.replace(",", "").toDoubleOrNull() ?: return false
        return written == Format.fixed(value, decimals).toDouble()
    }
}
