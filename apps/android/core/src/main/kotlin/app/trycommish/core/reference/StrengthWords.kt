package app.trycommish.core.reference

import app.trycommish.api.models.RunSlate
import app.trycommish.api.models.RunWindow
import app.trycommish.core.Format
import app.trycommish.core.board.RunWords
import app.trycommish.design.Words

/** Which strength a page shows (strength-words.ts StrengthKind): the rest of the season's in season, the
 * preseason figure before the first kickoff. */
enum class StrengthKind {
    Rest,
    Preseason,
    ;

    /** STRENGTH_HEADS, generated: "Rest of season strength". */
    val head: String get() = if (this == Rest) Words.Strength.rest else Words.Strength.preseason

    /** STRENGTH_COLUMNS, generated: the grid's narrow head, "Rest of season". */
    val column: String get() = if (this == Rest) Words.StrengthColumn.rest else Words.StrengthColumn.preseason
}

/** The strength a page shows for a slate (strength-words.ts StrengthView): its kind, the run's tenth, its
 * rank, the run's method and when it was read. */
data class StrengthView(
    val kind: StrengthKind,
    val strength: Double,
    val rank: Int,
    val method: String,
    val window: RunWindow,
)

/** A slate's strength as a page draws its figure: the run's tenth and its head with its rank. */
data class StrengthFigure(
    val value: String,
    val caption: String,
)

/** Schedule strength in words (web/src/lib/run/strength-words.ts), ported and held to
 * shared/fixtures/parity/reference.json. The method and the opponents' basis are the run's own words,
 * printed as given. */
object StrengthWords {
    /** strengthView: the preseason figure before the first kickoff, the rest of the season's after it, null
     * in season with none. */
    fun view(
        slate: RunSlate,
        underway: Boolean,
    ): StrengthView? {
        if (!underway) return StrengthView(StrengthKind.Preseason, slate.strength.toDouble(), slate.rank, slate.method, slate.window)
        val rest = slate.rest ?: return null
        return StrengthView(StrengthKind.Rest, rest.strength.toDouble(), rest.rank, rest.method, slate.window)
    }

    /** winsBasis: "Opponents show expected wins, set before the season." */
    fun winsBasis(opponentBasis: String): String = "Opponents show ${opponentBasis.take(1).lowercase()}${opponentBasis.drop(1)}."

    /** "Rest of season strength is the average of ..., read Sep 7." */
    fun strength(view: StrengthView): String = "${view.kind.head} is ${view.method}, read ${RunWords.window(view.window)}."

    /** playedWords: "weeks 1 to 5 and week 6's Thursday game are played, so faded", "" before any. */
    fun played(reach: Reach): String {
        val played = SeasonReach.playedThrough(reach)
        return if (played.isEmpty()) "" else "$played, so faded"
    }

    /** scheduleLead: what strength is and when it was read, then how the grid is ordered, shaded and faded;
     * with no strength to show, only what is shaded and faded. */
    fun scheduleLead(
        view: StrengthView?,
        strongCount: Int,
        atLeast: String,
        reach: Reach,
    ): String {
        val played = played(reach)
        val faded = if (played.isEmpty()) "" else ", $played"
        val shaded = "the $strongCount highest opponents shaded ($atLeast or more)$faded."
        if (view == null) return shaded.replaceFirstChar { it.uppercase() }
        return "${strength(view)} Hardest first, $shaded"
    }

    /** clubsLead: "Every club's players on our PPR board. Rest of season strength is ...". */
    fun clubsLead(
        formatLabel: String,
        first: StrengthView?,
    ): String = "Every club's players on our $formatLabel board.${first?.let { " ${strength(it)}" }.orEmpty()}"

    /** strengthFigure: the tenth the run writes. */
    fun figure(strength: Double): String = Format.fixed(strength)

    /** readWords: "Read Sep 7". */
    fun read(view: StrengthView): String = "Read ${RunWords.window(view.window)}"

    /** hardestFigure: "10th" and "hardest of 32", the last club the easiest. */
    fun hardestFigure(
        rank: Int,
        count: Int,
    ): Pair<String, String> = if (rank == count) "1st" to "easiest of $count" else Format.ordinal(rank) to "hardest of $count"

    /** hardestWords: "the hardest of 32", "3rd hardest of 32", "the easiest of 32". */
    fun hardestWords(
        rank: Int,
        count: Int,
    ): String =
        when {
            rank == count -> "the easiest of $count"
            rank == 1 -> "the hardest of $count"
            else -> "${Format.ordinal(rank)} hardest of $count"
        }
}
