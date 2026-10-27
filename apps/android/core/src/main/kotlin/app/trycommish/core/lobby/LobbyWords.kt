package app.trycommish.core.lobby

import app.trycommish.api.models.Lineup
import app.trycommish.api.models.ScoringPreset
import app.trycommish.core.Format
import app.trycommish.core.companion.DraftFormat
import app.trycommish.core.companion.RoomWords
import app.trycommish.design.Words

/**
 * The lobby's words that carry a figure or a name (web/src/lib/room/lobby-words.ts, setup/setup.ts and
 * format/draft.ts clockLabel), the iOS LobbyWords', held to shared/fixtures/parity/lobby.json; the plain words
 * are the generated `Words.Lobby`.
 */
object LobbyWords {
    private const val MINUTE = 60
    private const val TEN = 10

    /** lobby.ts seatName and pickCredit: the member's own seat, and its credit in the strip. */
    const val YOU = "You"
    const val YOU_CREDIT = "you"

    /** lobby.ts pickCredit: a stand-in's credit, over the seat it drafted for. */
    const val BOT_FOR = "bot for"
    const val CLOCK_FOR = "clock for"

    /** "Bot 3": a bot's seat. */
    fun bot(seat: Int): String = "Bot $seat"

    /** "Seat 3": a seat nobody holds yet. */
    fun seat(seat: Int): String = "Seat $seat"

    /** draft.ts clockLabel: a clock in whole seconds as minutes and seconds, "0:27", "1:05". */
    fun clock(seconds: Int): String {
        val left = maxOf(0, seconds)
        val part = left % MINUTE
        return "${left / MINUTE}:${if (part < TEN) "0" else ""}$part"
    }

    /** lobby-words.ts pickClockWords: "30 s a pick". */
    fun pickClock(seconds: Int): String = "$seconds s a pick"

    /** lobby-words.ts byPeopleWords: "2 of the last 12 by people". */
    fun byPeople(
        people: Int,
        of: Int,
    ): String = "$people of the last $of by people"

    /** lobby-words.ts waitWords: the filling room's line after its count. */
    fun wait(
        teams: Int,
        secondsLeft: Int,
    ): String = "The draft starts when $teams are in, or in ${clock(secondsLeft)} with bots in the open seats."

    /** lobby-words.ts aboutHead: "12 PPR lobby". */
    fun aboutHead(
        teams: Int,
        preset: String,
    ): String = "$teams $preset lobby"

    /** lobby-words.ts aboutWords with the apps' last clause (a phone has no tab): who is in the room, then the
     * clock and what happens to a seat that steps away. */
    fun about(
        people: Int,
        teams: Int,
        started: Boolean,
        clockSeconds: Int,
        standIn: String = Words.Lobby.standInApp,
    ): String {
        val rest =
            if (started) {
                " and ${Format.plural(
                    teams - people,
                    "bot",
                    "bots",
                )}"
            } else {
                ", ${Format.plural(teams - people, "seat", "seats")} open"
            }
        return "${Format.plural(people, "drafter", "drafters")}$rest. $clockSeconds seconds a pick, your queue drafts " +
            "if you step away, $standIn."
    }

    /** lobby-words.ts seatsWords: "3 drafters, 9 bots". */
    fun seats(
        people: Int,
        teams: Int,
    ): String = "${Format.plural(people, "drafter", "drafters")}, ${Format.plural(teams - people, "bot", "bots")}"

    /** lobby-words.ts soloAgainWords: "Run it against bots from slot 5". */
    fun soloAgain(slot: Int): String = "Run it against bots from slot $slot"

    /** lobby-words.ts queueFirstWords over call.ts draftWords with Queue: "Queue him first". */
    fun queueFirst(position: String): String = "${Words.Mock.queue} ${if (position == "DST") "them" else "him"} first"

    /** lobby-words.ts roundWords and pickWords: "Round 3", "Pick 3.05". */
    fun round(round: Int): String = "Round $round"

    fun pick(
        pick: Int,
        teams: Int,
    ): String = "Pick ${DraftFormat.pickLabel(pick, teams)}"

    /** lobby-words.ts yourPickIn: "3.05, in 7". */
    fun yourPickIn(
        pick: Int,
        away: Int,
        teams: Int,
    ): String = "${DraftFormat.pickLabel(pick, teams)}, in $away"

    /** lobby-words.ts secondsLeftWords: "10 seconds left". */
    fun secondsLeft(mark: Int): String = "$mark seconds left"

    /** lobby-words.ts seatLabel: a compact seat as a screen reader names it, "Bot 3, open, on the clock". */
    fun seatLabel(
        name: String,
        open: Boolean,
        onClock: Boolean,
    ): String = name + (if (open) ", ${Words.Lobby.seatOpen}" else "") + (if (onClock) ", ${Words.Lobby.seatOnClock}" else "")

    /** setup.ts lobbyFillWords: the drafters in, never a score against the seats; "No one in yet". */
    fun fill(filling: Int): Pair<String, Boolean> = if (filling > 0) "$filling in" to false else "No one in yet" to true

    /** setup.ts lobbyListHead: "Lobbies filling now" from the first seat taken, else "Open lobbies". */
    fun listHead(fillings: List<Int>): String = if (fillings.any { it > 0 }) "Lobbies filling now" else "Open lobbies"

    /** setup.ts lobbyTitle: "12 teams, PPR", "12 teams, half PPR, superflex". */
    fun title(
        teams: Int,
        preset: ScoringPreset,
        lineup: Lineup,
    ): String = "$teams teams, ${RoomWords.preset(preset)}${if (lineup == Lineup.superflex) ", superflex" else ""}"

    /** LobbyRoomView.svelte chanceLabel: what the pool's chances are of; "" with no card. */
    fun chanceLabel(
        conditional: Boolean,
        forPick: Int,
        nextPick: Int?,
        teams: Int,
    ): String =
        if (conditional) {
            "reaches ${DraftFormat.pickLabel(forPick, teams)}"
        } else {
            nextPick?.let { "still there at ${DraftFormat.pickLabel(it, teams)}" } ?: Words.Mock.lastPick
        }
}
