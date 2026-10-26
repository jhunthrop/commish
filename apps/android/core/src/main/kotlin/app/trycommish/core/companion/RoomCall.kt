package app.trycommish.core.companion

import app.trycommish.api.models.LeagueSettings
import app.trycommish.api.models.Lineup
import app.trycommish.api.models.RoomCard
import app.trycommish.api.models.ScoringPreset
import app.trycommish.core.Format
import app.trycommish.design.Words

/** One row of the call (types/room.ts CallRow): the player and his chance of lasting. */
data class CallRow(
    val player: RoomPlayer,
    val chance: Double?,
)

/** Our call as the rooms show it (web/src/lib/room/call.ts CallView): the call first, then the next two of
 * the shortlist still in the pool, each with the chance the card recorded for him. */
data class CallView(
    val player: RoomPlayer,
    val rows: List<CallRow>,
    /** The pick the call is for, "2.08". */
    val forLabel: String,
    /** The pick the chances look to, "3.05", null at your last pick. */
    val nextLabel: String?,
    val conditional: Boolean,
) {
    /** call.ts callTag: "Our call at 2.08", or off the clock "If the board holds to 2.08". */
    val tag: String get() = if (conditional) "If the board holds to $forLabel" else "Our call at $forLabel"

    /** call.ts chanceHead: "Still there 3.05" on your clock, "Reaches 2.08" on a call that waits on the
     * board, none at your last pick. */
    val chanceHead: String? get() = if (conditional) "Reaches $forLabel" else nextLabel?.let { "Still there $it" }

    companion object {
        /** call.ts CALL_ROWS. */
        private const val ROWS = 3

        /** call.ts callView: null when the board does not hold the card's call. */
        fun of(
            card: RoomCard,
            board: RoomBoardView,
            drafted: Set<String>,
            teams: Int,
        ): CallView? {
            val player = board.byId[card.call] ?: return null
            val rest =
                card.shortlist
                    .mapNotNull { board.byId[it.playerId] }
                    .filter { it.id != player.id && it.id !in drafted }
                    .take(ROWS - 1)
            return CallView(
                player = player,
                rows = (listOf(player) + rest).map { CallRow(it, card.stillThere[it.id]) },
                forLabel = DraftFormat.pickLabel(card.forPick, teams),
                nextLabel = card.nextPick?.let { DraftFormat.pickLabel(it, teams) },
                conditional = card.conditional,
            )
        }
    }
}

/** The rooms' words that carry a figure (web/src/lib/room/words.ts and call.ts), the iOS RoomWords'; the
 * plain words are the generated Words.Room. */
object RoomWords {
    /** words.ts presetWords: a scoring preset in a sentence, "PPR", "half PPR". */
    fun preset(preset: ScoringPreset): String =
        when (preset) {
            ScoringPreset.ppr -> Words.Scoring.ppr
            ScoringPreset.half_ppr -> Words.Scoring.half_ppr
            ScoringPreset.standard -> Words.Scoring.standard
            ScoringPreset.te_premium -> Words.Scoring.te_premium
            ScoringPreset.unknown_default_open_api -> preset.value
        }

    /** words.ts scoringWords: the preset, or "your scoring" for a league's own rules. */
    fun scoring(settings: LeagueSettings): String = settings.scoring.preset?.let(::preset) ?: "your scoring"

    /** words.ts lineupWords: "superflex", "two flex", null for the standard lineup. */
    fun lineup(settings: LeagueSettings): String? =
        when (settings.lineup) {
            Lineup.superflex -> "superflex"
            Lineup.two_flex -> "two flex"
            Lineup.standard, Lineup.unknown_default_open_api -> null
        }

    /** words.ts leagueLine: "12 teams · your scoring · two flex · slot 5". */
    fun leagueLine(
        settings: LeagueSettings,
        slot: Int,
    ): String = (listOf("${settings.teams} teams", scoring(settings)) + listOfNotNull(lineup(settings)) + "slot $slot").joinToString(" · ")

    /** call.ts poolBasis: the board's basis, then where the chances come from. */
    fun poolBasis(
        board: RoomBoardView,
        card: RoomCard?,
        teams: Int,
    ): String = "${board.basis} ${stillThereBasis(card, teams)}"

    private fun stillThereBasis(
        card: RoomCard?,
        teams: Int,
    ): String {
        if (card == null) return "Still there lands with our call."
        val target = card.nextPick?.let { DraftFormat.pickLabel(it, teams) } ?: "your last pick"
        if (card.source == RoomCard.Source.advisor) {
            return "Still there at $target: where drafters take each player and how far they stray from it."
        }
        return "Still there at $target: ${card.runs} runs of this room, each seat drafting as it has so far."
    }

    /** words.ts poolLine: "1,447 left to draft, ranked by points over replacement". */
    fun poolLine(left: Int): String = "${Format.count(left)} ${Words.Pool.room}, ranked by points over replacement"

    /** words.ts chanceMissing: under a row with no chance to show. */
    fun chanceMissing(
        gone: Boolean,
        read: Boolean,
    ): String =
        when {
            gone -> "no call"
            read -> "not read"
            else -> "with our call"
        }

    /** words.ts poolEmpty: the pool's line when no row is left under the chip. */
    fun poolEmpty(filter: String): String = "Nobody left${if (filter == RoomDraft.ALL) "" else " at $filter"}."

    /** words.ts showMore: "Show 25 more". */
    fun showMore(rows: Int): String = "Show $rows more"

    /** words.ts wallRounds: "rounds 1 to 3 of 20". */
    fun wallRounds(
        shown: Int,
        rounds: Int,
    ): String = "rounds 1 to $shown of $rounds"

    /** words.ts teamCount: "3 of 20". */
    fun teamCount(
        drafted: Int,
        rosterSize: Int,
    ): String = "$drafted of $rosterSize"

    /** words.ts sinceLead, for your own draft: "went since your pick at 1.05", "went before your first pick". */
    fun sinceLead(
        since: Int?,
        teams: Int,
    ): String = since?.let { "went since your pick at ${DraftFormat.pickLabel(it, teams)}" } ?: "went before your first pick"

    /** A value cell as the pool's row prints it (PoolRow.svelte): his points over replacement signed, or a
     * kicker's or a defense's place in draft order, else "no projection". */
    fun value(player: RoomPlayer): String {
        val vor = player.vor
        if (vor != null && player.vorRound != null) return DraftFormat.signed(vor)
        return if (player.isMarket) draftOrder(player) else "no projection"
    }

    /** A call row's value (CallPanel.svelte): a kicker's or a defense's place in draft order, his points over
     * replacement signed, or nothing. */
    fun callValue(row: CallRow): String =
        if (row.player.isMarket) {
            draftOrder(row.player)
        } else {
            row.player.vor
                ?.let { DraftFormat.signed(it) }
                .orEmpty()
        }

    /** "Draft order 4": a kicker's or a defense's place in the drafts' order. */
    fun draftOrder(player: RoomPlayer): String = "Draft order ${player.positionRank}"
}
