package app.trycommish.core.companion

import app.trycommish.design.Words

/** The wall's cell on the clock: "Your pick" or "On the clock", and "2.08". */
data class WallClock(
    val words: String,
    val pick: String,
)

/** One cell of the wall (Wall.svelte): the pick, who it took, or, on the clock, whose pick it is. */
data class WallCell(
    /** The overall pick. */
    val pick: Int,
    val seat: Int,
    val player: RoomPlayer?,
    /** His last name, as the cell prints it. */
    val name: String?,
    /** "WR · DAL" over the name. */
    val line: String?,
    /** A pick the drafter made, on the accent's wash. */
    val mine: Boolean,
    /** On the clock: whose pick it is, with the pick under it. */
    val now: WallClock?,
)

/** The wall (Wall.svelte): each seat's name across the top, the drafter's in the accent, then each round
 * through the one on the clock, seat by seat. */
data class RoomWall(
    val title: String,
    /** "rounds 1 to 3 of 20". */
    val label: String,
    val names: List<String>,
    /** The drafter's seat, 1-based. */
    val you: Int,
    val rows: List<List<WallCell>>,
) {
    companion object {
        /** model.ts wallRows through `shown` rounds of `rounds`; `now` is the pick on the clock, null once
         * the draft is over. */
        @Suppress("LongParameterList") // The web's wallRows takes the same seven.
        fun of(
            picks: List<PlacedPick>,
            board: RoomBoardView,
            names: List<String>,
            you: Int,
            teams: Int,
            rounds: Int,
            shown: Int,
            now: Int?,
        ): RoomWall {
            val byPick = picks.groupBy { it.pick }.mapValues { it.value.first().playerId }
            val rows =
                (0 until maxOf(shown, 0)).map { index ->
                    (1..maxOf(teams, 1)).map { seat ->
                        val pick = if (index % 2 == 0) index * teams + seat else index * teams + (teams - seat + 1)
                        val player = byPick[pick]?.let { board.byId[it] }
                        val onClock = player == null && pick == now
                        WallCell(
                            pick = pick,
                            seat = seat,
                            player = player,
                            name = player?.let { DraftFormat.lastName(it.name) },
                            line = player?.let { "${it.position} · ${it.team}" },
                            mine = player != null && seat == you,
                            now = if (onClock) clock(seat == you, pick, teams) else null,
                        )
                    }
                }
            return RoomWall(Words.Room.wall, RoomWords.wallRounds(rows.size, rounds), names, you, rows)
        }

        /** The cell on the clock: "Your pick" at the drafter's seat, else "On the clock", with the pick. */
        private fun clock(
            yours: Boolean,
            pick: Int,
            teams: Int,
        ): WallClock = WallClock(if (yours) Words.Room.yourPick else Words.Room.onTheClock, DraftFormat.pickLabel(pick, teams))
    }
}
