package app.trycommish.core.reference

import app.trycommish.api.models.RunGame
import app.trycommish.api.models.RunGameState
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.design.Words
import java.time.ZoneId

/** The week whose games the schedule says the state of, and when the run read them (its manifest's
 * runAt): the read every state is as of. */
data class CurrentWeek(
    val week: Int,
    val readAt: String,
)

/** The current week's states as one screen says them, in the member's zone: each game's word and the
 * line under the games naming the run's read. */
class StatedWeek(
    val current: CurrentWeek?,
    private val zone: ZoneId,
) {
    fun word(game: RunGame): String? = ScheduleState.word(game, current, zone)

    val asOf: String? get() = current?.let { ScheduleState.asOf(it, zone) }

    companion object {
        /** The run's current week from its schedule, reach and instant. */
        fun of(
            games: List<RunGame>,
            reach: Reach,
            underway: Boolean,
            readAt: String,
            zone: ZoneId,
        ): StatedWeek = StatedWeek(ScheduleState.currentWeek(games, reach, underway, readAt), zone)
    }
}

/**
 * The current week's games on the schedule grid and a club's schedule (web/src/lib/run/schedule-state.ts,
 * Lane 223, B187), ported: each game's state as the run read it (`RunGame.state`, the nightly's
 * snapshot) in the words the Rankings print (Final, Kicked off, or the kickoff with its day and zone),
 * under one line naming the run's read, so a state is never claimed live. Nothing here reads a clock.
 * Held to shared/fixtures/parity/reference.json's run `current`, `asOf` and `states`.
 */
object ScheduleState {
    /** currentWeek: the week after the last complete one, while the season is underway, the run carries
     * every one of that week's states and the schedule holds that week; null otherwise. */
    fun currentWeek(
        games: List<RunGame>,
        reach: Reach,
        underway: Boolean,
        readAt: String,
    ): CurrentWeek? {
        if (!underway) return null
        val week = reach.complete + 1
        val held = games.filter { it.week == week }
        if (held.isEmpty() || held.any { it.state == null }) return null
        return CurrentWeek(week, readAt)
    }

    /** statedGame with stateWord: the game's word on the current week alone, null on any other. */
    fun word(
        game: RunGame,
        current: CurrentWeek?,
        zone: ZoneId,
    ): String? {
        val state = game.state
        if (state == null || current?.week != game.week) return null
        return when (state) {
            RunGameState.`final` -> Words.Kickoff.final
            RunGameState.kicked_off -> Words.Kickoff.kickedOff
            RunGameState.upcoming -> instantOrNull(game.kickoff)?.let { Format.kickoffAt(it, zone) }
            // A state this build does not know says nothing rather than a guess.
            RunGameState.unknown_default_open_api -> null
        }
    }

    /** asOfLine: "Week 6's games as of Wed Oct 21, 7:00 am Central." (SCHEDULE_STATE_WORDS.asOf over
     * day-time.ts dayTimeStamp). */
    fun asOf(
        current: CurrentWeek,
        zone: ZoneId,
    ): String? {
        val at = instantOrNull(current.readAt) ?: return null
        val stamp = "${Format.weekdayDay(at, zone)}, ${Format.timeOfDay(at, zone)} ${Format.zoneWord(zone)}"
        return "Week ${current.week}'s games as of $stamp."
    }
}
