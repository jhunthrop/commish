package app.trycommish.core.rankings

import app.trycommish.design.Words

/** The pills a Rankings row can print, for the slot that lines them up as a column (iOS's
 * RankingsColumn.pill, Lane 215 review H1): the slot is as wide as the widest of these, so no pill is
 * ever cut and the club column starts at one x on every row. */
object RankingsPills {
    /** box.ts POSITIONS: the positions a pill names; a defense has none. */
    val positions: Set<String> = setOf("QB", "RB", "WR", "TE", "K")

    /** The most digits a rank at a position prints: a position holds fewer than a thousand players. */
    const val MOST_DIGITS = 3

    /** The list words a pill prints in place of a rank (designation.ts RANK_WORDS). */
    val listWords: List<String> =
        listOf(
            Words.DesignationRank.questionable,
            Words.DesignationRank.doubtful,
            Words.DesignationRank.out,
            Words.DesignationRank.injured_reserve,
            Words.DesignationRank.suspended,
            Words.DesignationRank.pup,
            Words.DesignationRank.nfi,
        )

    /** Every position with every rank shape a pill bounds: each digit three times over (a rank's digits
     * are no wider together than its widest digit three times), and each list word. The widest of these
     * measured is at least as wide as any pill the order prints. */
    val widestCandidates: List<String> =
        positions.flatMap { position ->
            ('0'..'9').map { "$position ${it.toString().repeat(MOST_DIGITS)}" } + listWords.map { "$position $it" }
        }
}
