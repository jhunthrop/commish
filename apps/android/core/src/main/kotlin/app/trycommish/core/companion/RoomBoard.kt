package app.trycommish.core.companion

import app.trycommish.api.models.Lineup
import app.trycommish.api.models.PlayerPosition
import app.trycommish.api.models.RoomBoard
import app.trycommish.api.models.RosterCounts
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.headshotOf
import app.trycommish.core.shell.initialsOf
import java.text.Normalizer

/** A board player as the rooms draw him (web/src/lib/room/model.ts RoomPlayer): the engine's DEF as the
 * site's DST, his points over replacement and the round they rank in, for the value cell's tint. */
data class RoomPlayer(
    val id: String,
    val name: String,
    /** QB, RB, WR, TE, K or DST. */
    val position: String,
    val positionRank: Int,
    val team: String,
    val headshot: String,
    val adp: Double?,
    val points: Double?,
    val vor: Double?,
    val gap: Double?,
    /** The round his points over replacement rank in on this board, null with none. */
    val vorRound: Int?,
    val bye: Int?,
) {
    /** A kicker or a defense, ranked in draft order with no projection (run/market.ts isMarketPosition). */
    val isMarket: Boolean get() = position == "K" || position == "DST"

    /** A defense's club, whose chip is its face (B245); null for a player. */
    val clubMark: String? get() = team.takeIf { position == "DST" && it.isNotEmpty() }

    /** His pill: "WR 6". */
    val pill: String get() = "$position $positionRank"

    val initials: String get() = initialsOf(name)

    /** The player sheet's player: his page by the site's slug rule, his board id to read him by. */
    val sheetPlayer: SheetPlayer
        get() = SheetPlayer(id, PlayerSlug.of(name), name, position, positionRank.toString(), team, headshotOf(headshot), boardId = id)
}

/** The site's slug rule for a player's page (research/nightly/build/pages.py slug_of, the iOS PlayerSlug):
 * accents dropped, lower case, words joined by hyphens. */
object PlayerSlug {
    private val marks = Regex("\\p{M}+")
    private val joins = Regex("[^a-z0-9]+")
    private val ends = Regex("^-|-$")

    fun of(name: String): String {
        val plain = marks.replace(Normalizer.normalize(name, Normalizer.Form.NFD), "").lowercase()
        return ends.replace(joins.replace(plain, "-"), "")
    }
}

/** The board as the rooms read it (model.ts Board): players in the order drafters take them, by id. */
data class RoomBoardView(
    val players: List<RoomPlayer>,
    val byId: Map<String, RoomPlayer>,
    val basis: String,
) {
    companion object {
        /** model.ts boardOf: each player's value round counted over the players who carry a value, best
         * first, by the league's team count. */
        fun of(
            board: RoomBoard,
            teams: Int,
        ): RoomBoardView {
            val valued =
                board.players
                    .withIndex()
                    .mapNotNull { (index, player) -> player.vor?.let { Triple(index, player.id, it) } }
                    .sortedWith(compareByDescending<Triple<Int, String, Double>> { it.third }.thenBy { it.first })
            val valueRank = valued.withIndex().associate { (place, entry) -> entry.second to place + 1 }
            val players =
                board.players.map { player ->
                    RoomPlayer(
                        id = player.id,
                        name = player.name,
                        position = position(player.position),
                        positionRank = player.positionRank,
                        team = player.team,
                        headshot = player.headshot,
                        adp = player.adp,
                        points = player.points,
                        vor = player.vor,
                        gap = player.gap,
                        vorRound = valueRank[player.id]?.let { (it + teams - 1) / teams },
                        bye = player.bye,
                    )
                }
            val byId = players.groupBy { it.id }.mapValues { it.value.first() }
            return RoomBoardView(players, byId, board.basis)
        }

        /** The engine's DEF is the site's DST. */
        fun position(position: PlayerPosition): String = if (position == PlayerPosition.DEF) "DST" else position.value
    }
}

/** A pick placed on our board (room/api.ts RoomPick): who made it and whom it took. */
data class PlacedPick(
    val pick: Int,
    val round: Int,
    val seat: Int,
    val playerId: String,
)

/** A player taken since a pick, with the pick that took him. */
data class WentPick(
    val player: RoomPlayer,
    val pick: Int,
)

/** One line of your roster: a slot and who fills it, with the pick that took him. */
data class TeamSlot(
    val slot: String,
    val player: RoomPlayer?,
    val pick: Int?,
)

/** A roster slot in the order the engine fills them, with the positions it takes. */
data class RosterSlot(
    val slot: String,
    val takes: Set<String>,
)

/** The rooms' readers over a draft (web/src/lib/room/model.ts): whose turn, the pool, the strip since your
 * last pick and your team by slot. Pure. */
object RoomDraft {
    const val ALL = "All"

    /** The chips a pool is filtered by, All first. */
    val filters = listOf(ALL, "QB", "RB", "WR", "TE", "K", "DST")

    private val flex = setOf("RB", "WR", "TE")
    private val everyone = setOf("QB", "RB", "WR", "TE", "K", "DST")
    private const val BENCH = "BN"

    /** The seat on the clock at a pick. */
    fun seatAt(
        pick: Int,
        teams: Int,
    ): Int = DraftFormat.snakeSlot(pick, teams).seat

    /** The seat's last pick before a pick, or null before its first. */
    fun turnBefore(
        pick: Int,
        seat: Int,
        teams: Int,
    ): Int? = (pick - 1 downTo 1).firstOrNull { seatAt(it, teams) == seat }

    /** The players a pick list took. */
    fun drafted(picks: List<PlacedPick>): Set<String> = picks.map { it.playerId }.toSet()

    /** Every pick after `since`, each with the board's player. */
    fun wentSince(
        picks: List<PlacedPick>,
        since: Int,
        board: RoomBoardView,
    ): List<WentPick> = picks.filter { it.pick > since }.mapNotNull { pick -> board.byId[pick.playerId]?.let { WentPick(it, pick.pick) } }

    /** model.ts poolRows: the players left under a chip, by points over replacement, the players without
     * one after in the order drafters take them (a stable sort, as the web's). */
    fun pool(
        board: RoomBoardView,
        drafted: Set<String>,
        filter: String,
    ): List<RoomPlayer> =
        board.players
            .filter { it.id !in drafted && (filter == ALL || it.position == filter) }
            .sortedByDescending { it.vor ?: Double.NEGATIVE_INFINITY }

    /** model.ts rosterSlots: the roster as slots in the order the engine fills them. */
    fun rosterSlots(
        roster: RosterCounts,
        lineup: Lineup,
    ): List<RosterSlot> {
        fun repeated(
            slot: String,
            count: Int,
            takes: Set<String>,
        ) = List(maxOf(0, count)) { RosterSlot(slot, takes) }
        return repeated("QB", roster.qb, setOf("QB")) + repeated("RB", roster.rb, setOf("RB")) +
            repeated("WR", roster.wr, setOf("WR")) + repeated("TE", roster.te, setOf("TE")) +
            repeated("FLEX", if (lineup == Lineup.two_flex) 2 else 1, flex) +
            repeated("SFLX", if (lineup == Lineup.superflex) 1 else 0, flex + "QB") + repeated("K", roster.k, setOf("K")) +
            repeated("DST", roster.dst, setOf("DST")) + repeated(BENCH, roster.bench, everyone)
    }

    /** model.ts teamSlots: your team by slot, each pick in the first open slot that takes him; the bench
     * shows only who is on it. */
    fun team(
        roster: RosterCounts,
        lineup: Lineup,
        mine: List<PlacedPick>,
        board: RoomBoardView,
    ): List<TeamSlot> {
        val takes = rosterSlots(roster, lineup)
        val filled =
            mine.fold(takes.map { TeamSlot(it.slot, null, null) }) { slots, pick ->
                val player = board.byId[pick.playerId] ?: return@fold slots
                val open = slots.indices.firstOrNull { slots[it].player == null && player.position in takes[it].takes }
                if (open == null) slots else slots.toMutableList().also { it[open] = TeamSlot(slots[open].slot, player, pick.pick) }
            }
        return filled.filter { it.slot != BENCH || it.player != null }
    }
}
