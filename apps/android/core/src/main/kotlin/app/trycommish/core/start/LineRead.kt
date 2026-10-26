package app.trycommish.core.start

import app.trycommish.api.models.GameStateCell
import app.trycommish.api.models.PlayerLine
import app.trycommish.core.instantOrNull
import app.trycommish.core.leaguehome.GameState
import java.time.Instant

/**
 * A player's game this week as his line's `game_state` says it (Lane 176), read and never computed: the
 * field's state, a `not_started` read whose kickoff has passed at the screen's clock read as kicked off
 * (the one lag rule every client shares, kickoff.ts lineState with the field, so a saved answer still
 * turns at kickoff), a bye or no game as none.
 *
 * A line without the field, or with a state this build does not know, is [Unread]: it says the field's
 * word where it has one, and it never offers a move (the screen cannot vouch that its game is still to
 * come).
 */
sealed interface GameRead {
    data object Upcoming : GameRead

    data object KickedOff : GameRead

    data object Final : GameRead

    /** A bye, or no game held for him this week (a free agent, a club with none). */
    data object NoGame : GameRead

    /** No field, or a state this build does not know: its word, when it sent one. */
    data class Unread(
        val word: String?,
    ) : GameRead

    /** Past its kickoff, or not known to be still to come: no platform takes a move on him, and no
     * screen offers one (kickoff.ts pastKickoff; an unread game is held). */
    val locked: Boolean
        get() =
            when (this) {
                KickedOff, Final, is Unread -> true
                Upcoming, NoGame -> false
            }

    /** Still to be played at the screen's clock (kickoff.ts toPlay). */
    val toPlay: Boolean get() = this == Upcoming

    /** The state's name as the web's lineState returns it, null with no game or none read. */
    val stateName: String?
        get() =
            when (this) {
                Upcoming -> "upcoming"
                KickedOff -> "kicked_off"
                Final -> "final"
                NoGame, is Unread -> null
            }
}

/** The line's game by its field, the one place a screen reads it. */
object LineRead {
    /** The line's game at `now`, by its field. */
    fun game(
        line: PlayerLine,
        now: Instant,
    ): GameRead {
        val cell = line.gameState ?: return GameRead.Unread(null)
        return when (cell.state) {
            GameStateCell.State.final -> GameRead.Final
            GameStateCell.State.kicked_off -> GameRead.KickedOff
            // A saved read turns at kickoff: the field's not_started is read by the clock.
            GameStateCell.State.not_started -> {
                val kickoff = instantOrNull(line.facts.kickoff)
                if (kickoff != null && !kickoff.isAfter(now)) GameRead.KickedOff else GameRead.Upcoming
            }
            GameStateCell.State.bye, GameStateCell.State.no_game -> GameRead.NoGame
            GameStateCell.State.unknown_default_open_api -> GameRead.Unread(cell.word.ifEmpty { null })
        }
    }

    /** kickoff.ts stateWord: the field's word where the field holds the state shown, the web's own word
     * otherwise (a saved read the clock has moved past). */
    fun word(
        line: PlayerLine,
        read: GameRead,
        own: String,
    ): String {
        val cell = line.gameState
        val held =
            (read == GameRead.Final && cell?.state == GameStateCell.State.final) ||
                (read == GameRead.KickedOff && cell?.state == GameStateCell.State.kicked_off)
        return if (held) cell.word else own
    }

    /** Kicked off or final by its field. */
    fun started(
        line: PlayerLine,
        now: Instant,
    ): Boolean = game(line, now).let { it == GameRead.KickedOff || it == GameRead.Final }

    /** Any line's game past its kickoff (basis.ts anyKicked). */
    fun anyKicked(
        lines: List<PlayerLine>,
        now: Instant,
    ): Boolean = lines.any { started(it, now) }

    /** kickoff.ts linesRead's state over a set of lines: final once every one with a game is, playing
     * once any has kicked off, else upcoming. One rule with [linesRead]. */
    fun setState(
        lines: List<PlayerLine>,
        now: Instant,
    ): GameRead =
        when (linesRead(lines, now).state) {
            GameState.Final -> GameRead.Final
            GameState.KickedOff -> GameRead.KickedOff
            GameState.Upcoming -> GameRead.Upcoming
        }

    /** kickoff.ts linesRead: final once every game is, under way once any has kicked off, the earliest
     * kickoff still to come next; each line's game by its field. */
    fun linesRead(
        lines: List<PlayerLine>,
        now: Instant,
    ): GamesRead {
        val held = setOf(GameRead.Upcoming, GameRead.KickedOff, GameRead.Final)
        val states =
            lines.mapNotNull { line ->
                val kickoff = instantOrNull(line.facts.kickoff) ?: return@mapNotNull null
                game(line, now).takeIf { it in held }?.let { it to kickoff }
            }
        val ahead = states.filter { it.first == GameRead.Upcoming }.map { it.second }.sorted()
        val state =
            when {
                states.isNotEmpty() && states.all { it.first == GameRead.Final } -> GameState.Final
                ahead.size < states.size -> GameState.KickedOff
                else -> GameState.Upcoming
            }
        return GamesRead(state, ahead.firstOrNull())
    }
}

/** A set of games as one read (kickoff.ts GameRead): its state and the earliest kickoff still to come. */
data class GamesRead(
    val state: GameState,
    val next: Instant?,
)
