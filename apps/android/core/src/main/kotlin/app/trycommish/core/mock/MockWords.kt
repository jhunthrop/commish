package app.trycommish.core.mock

import app.trycommish.api.models.LeagueSettings
import app.trycommish.api.models.RoomCard
import app.trycommish.core.companion.DraftFormat
import app.trycommish.core.companion.Drafter
import app.trycommish.core.companion.RoomBoardView
import app.trycommish.core.companion.RoomWords
import app.trycommish.design.Words

/** A cell of a fact strip (web/src/lib/ui/facts.ts FactCell): its label, its value, and whether the value is
 * a word, drawn in the words' face, rather than a figure. */
data class MockCell(
    val label: String,
    val value: String,
    val word: Boolean,
)

/** Whose draft the room is told for: the drafter's own, or one read through its link. */
enum class Whose(
    val word: String,
) {
    Your("your"),
    Their("their"),
}

/**
 * The solo mock's words that carry a figure or a name (web/src/lib/room/mock-words.ts, words.ts, call.ts and
 * setup/setup.ts), the iOS MockWords', held to shared/fixtures/parity/mock.json; the plain words are the
 * generated Words.Mock, Words.MockSetup and Words.MockClocks.
 */
object MockWords {
    /** setup.ts LOBBY_FILL_SECONDS: when a lobby starts after its first join. */
    private const val LOBBY_FILL_SECONDS = 90

    /** mock-words.ts pickHead: "Pick 5.08". */
    fun pickHead(
        pick: Int,
        teams: Int,
    ): String = "Pick ${DraftFormat.pickLabel(pick, teams)}"

    /** mock-words.ts autopickWords: "Pick for me to round 8". */
    fun autopick(round: Int): String = "Pick for me to round $round"

    /** mock-words.ts draftNamed: "Draft Williams". */
    fun draftNamed(name: String): String = "${Words.Mock.draft} ${DraftFormat.lastName(name)}"

    /** mock-words.ts readingWords: "Reading the room for 2.12". */
    fun reading(
        pick: Int,
        teams: Int,
    ): String = "Reading the room for ${DraftFormat.pickLabel(pick, teams)}"

    /** mock-words.ts chanceLabel: "still there at 6.05", or "your last pick". */
    fun chanceLabel(
        next: Int?,
        teams: Int,
    ): String = next?.let { "still there at ${DraftFormat.pickLabel(it, teams)}" } ?: Words.Mock.lastPick

    /** mock-words.ts undoneWords: the pick the undo went back to, who is back in the pool, and that the room
     * branched. */
    fun undone(
        pick: Int,
        teams: Int,
        name: String?,
    ): String {
        val back = name?.let { " $it is in the pool again." }.orEmpty()
        return "Back to ${DraftFormat.pickLabel(pick, teams)}.$back Same bots, same seed, so the room " +
            "drafts the same until your pick goes another way."
    }

    /** mock-words.ts runAgainWords: "Run it again from slot 5". */
    fun runAgain(slot: Int): String = "Run it again from slot $slot"

    /** mock-words.ts runSharedWords: "Run this draft from slot 5". */
    fun runShared(slot: Int): String = "Run this draft from slot $slot"

    /** mock-words.ts sharedTitle: "jh's mock from slot 5", "A shared mock from slot 5". */
    fun sharedTitle(
        sharedBy: String?,
        slot: Int,
    ): String = "${sharedBy?.let { "$it's mock" } ?: "A shared mock"} from slot $slot"

    /** mock-words.ts sharedAt: "finished", "at pick 5.08". */
    fun sharedAt(
        complete: Boolean,
        pick: Int,
        teams: Int,
    ): String = if (complete) "finished" else "at pick ${DraftFormat.pickLabel(pick, teams)}"

    /** call.ts draftWords: "Draft him", or "Draft them" for a defense. */
    fun draftWords(position: String): String = "${Words.Mock.draft} ${if (position == "DST") "them" else "him"}"

    /** words.ts formatLine: "12 teams · PPR · superflex". */
    fun formatLine(settings: LeagueSettings): String =
        (listOf("${settings.teams} teams", RoomWords.scoring(settings)) + listOfNotNull(RoomWords.lineup(settings))).joinToString(" · ")

    /** words.ts pickBarCells: the round, the league, your slot, and while you have one, your next pick and how
     * many picks away it is. */
    fun barCells(
        settings: LeagueSettings,
        slot: Int,
        now: Int,
        round: Int,
        next: Int?,
    ): List<MockCell> =
        listOfNotNull(
            MockCell("Round", round.toString(), word = false),
            MockCell("Teams", settings.teams.toString(), word = false),
            MockCell("Scoring", RoomWords.scoring(settings), word = true),
            RoomWords.lineup(settings)?.let { MockCell("Lineup", it, word = true) },
            MockCell("Slot", slot.toString(), word = false),
            next?.let { MockCell("Your next", DraftFormat.pickLabel(it, settings.teams), word = false) },
            next?.let { MockCell("Picks away", maxOf(0, it - now - 1).toString(), word = false) },
        )

    /** setup.ts setupCells without a lobby read: the clock against bots and when a lobby starts (the solo
     * setup reads no lobby). */
    fun setupCells(): List<MockCell> =
        listOf(
            MockCell(Words.MockClocks.botClock, Words.MockClocks.none, word = true),
            MockCell(Words.MockClocks.lobbyStarts, "Full, or $LOBBY_FILL_SECONDS s after the first join", word = true),
        )

    /** words.ts botNames: a solo room's seats, you and the bots by seat; a shared draft's drafter by handle in
     * his seat (`drafter` set for someone else's draft). */
    fun seatNames(
        teams: Int,
        slot: Int,
        drafter: Drafter? = null,
    ): List<String> =
        (1..maxOf(teams, 1)).map { seat ->
            when {
                seat != slot -> "Bot $seat"
                drafter != null -> drafter.handle ?: Words.Mock.drafter
                else -> "You"
            }
        }

    /** call.ts poolBasis: the board's basis, then where the chances come from, or that no call is coming. */
    fun poolBasis(
        board: RoomBoardView,
        card: RoomCard?,
        teams: Int,
        callMissing: Boolean,
    ): String = if (card == null && callMissing) "${board.basis} No call for this pick." else RoomWords.poolBasis(board, card, teams)

    /** words.ts sinceLead: "went since your pick at 2.08", "went before their first pick". */
    fun sinceLead(
        since: Int?,
        teams: Int,
        whose: Whose,
    ): String =
        since?.let { "went since ${whose.word} pick at ${DraftFormat.pickLabel(it, teams)}" } ?: "went before ${whose.word} first pick"

    /** words.ts sinceQueued: "none from your queue", "2 from your queue". */
    fun sinceQueued(
        fromQueue: Int,
        whose: Whose,
    ): String = "${if (fromQueue == 0) "none" else fromQueue.toString()} from ${whose.word} queue"

    /** words.ts straightBack: no pick landed between two turns. */
    fun straightBack(whose: Whose): String = "${if (whose == Whose.Your) "Your" else "Their"} turn came straight back"

    /** words.ts poolEmpty with no search: the pool's line when the chip leaves nobody. */
    fun poolEmpty(filter: String): String =
        if (filter == Words.Mock.queue) "Nobody in your queue. Mark a player and press Q to add him." else RoomWords.poolEmpty(filter)
}
