package app.trycommish.core.mock

import app.trycommish.api.models.MockRoom
import app.trycommish.api.models.MockStatus
import app.trycommish.api.models.RoomCard
import app.trycommish.core.companion.CallView
import app.trycommish.core.companion.DraftFormat
import app.trycommish.core.companion.Drafter
import app.trycommish.core.companion.PickStripModel
import app.trycommish.core.companion.PlacedPick
import app.trycommish.core.companion.RoomBoardView
import app.trycommish.core.companion.RoomDraft
import app.trycommish.core.companion.RoomWall
import app.trycommish.core.companion.TeamModel
import app.trycommish.design.Words

/**
 * The solo room as SoloRoom.svelte draws it at 390, from the API's answer, the board read with the first and
 * the turn's card, the iOS MockRoomModel's: pure, held to shared/fixtures/parity/mock.json.
 */
data class MockRoomModel(
    val room: MockRoom,
    val bar: MockBar?,
    val shared: MockSharedHead?,
    val notice: String?,
    val since: PickStripModel?,
    val straight: String?,
    val call: MockCallState?,
    val pool: MockPool?,
    val wall: RoomWall,
    val team: TeamModel,
    val teamTitle: String,
) {
    companion object {
        /** SoloRoom.svelte AUTOPICK_ROUNDS and FILTERS. */
        const val AUTOPICK_ROUNDS = 3
        val filters: List<String> = RoomDraft.filters + Words.Mock.queue

        /** The room at a moment. `drafter` is set for someone else's draft read through its link: read, never
         * drafted in. */
        fun of(
            room: MockRoom,
            board: RoomBoardView,
            card: RoomCard?,
            ui: MockRoomUi,
            drafter: Drafter? = null,
        ): MockRoomModel {
            val draft = MockFacts.of(room, ui, readOnly = drafter != null)
            val view =
                if (!draft.readOnly && room.waiting) card?.let { CallView.of(it, board, draft.drafted, draft.teams) } else null
            val noCall = ui.callMissing && !draft.readOnly && draft.active && room.waiting && view == null && !draft.inFlight
            val went = RoomDraft.wentSince(draft.placed, draft.previous ?: 0, board)
            val showing = room.waiting && !draft.inFlight
            val cameBack = draft.previous != null && went.isEmpty()
            return MockRoomModel(
                room = room,
                bar = MockDraw.bar(room, draft),
                shared = if (draft.readOnly) MockDraw.sharedHead(room, draft.active) else null,
                notice = ui.notice,
                since =
                    if (showing && (draft.lastMine != null || went.isNotEmpty()) && !cameBack) {
                        MockDraw.since(went, draft.previous, room.queue.toSet(), draft.teams, draft.whose)
                    } else {
                        null
                    },
                straight = if (showing && cameBack) MockWords.straightBack(draft.whose) else null,
                call = MockDraw.call(view, noCall, draft, board, ui),
                pool = if (draft.active) MockDraw.pool(room, board, draft, MockTurn(card, view, noCall), ui) else null,
                wall =
                    RoomWall.of(
                        draft.placed,
                        board,
                        MockWords.seatNames(draft.teams, room.slot, drafter),
                        room.slot,
                        draft.teams,
                        room.rounds,
                        shown = minOf(room.rounds, draft.round),
                        now = if (draft.active) room.pickNumber else null,
                        shared = draft.readOnly,
                    ),
                team = MockDraw.team(room, draft.mine, board),
                teamTitle = if (draft.readOnly) Words.Mock.theirTeam else Words.Room.yourTeam,
            )
        }

        /** model.ts turnAfter: the seat's first turn after a pick, null when the draft ends first. */
        fun turnAfter(
            pick: Int,
            seat: Int,
            teams: Int,
            total: Int,
        ): Int? = if (pick >= total) null else (pick + 1..total).firstOrNull { RoomDraft.seatAt(it, teams) == seat }
    }
}

/** The turn's call as the pool reads it: the card, our call from it, and whether none is coming. */
internal data class MockTurn(
    val card: RoomCard?,
    val view: CallView?,
    val noCall: Boolean,
)

/** What the room reads off the answer before it draws (SoloRoom.svelte's derived values). */
internal data class MockFacts(
    val readOnly: Boolean,
    val whose: Whose,
    val teams: Int,
    val placed: List<PlacedPick>,
    val drafted: Set<String>,
    val mine: List<PlacedPick>,
    val round: Int,
    val next: Int?,
    val previous: Int?,
    val queue: List<String>,
    val active: Boolean,
    val lastMine: Int?,
    val inFlight: Boolean,
    val waiting: Boolean,
    val pick: Int,
) {
    companion object {
        fun of(
            room: MockRoom,
            ui: MockRoomUi,
            readOnly: Boolean,
        ): MockFacts {
            val total = room.teams * room.rounds
            val placed = room.picks.map { PlacedPick(it.pick, it.round, it.seat, it.playerId) }
            val drafted = RoomDraft.drafted(placed)
            val mine = placed.filter { it.seat == room.slot }
            return MockFacts(
                readOnly = readOnly,
                whose = if (readOnly) Whose.Their else Whose.Your,
                teams = room.teams,
                placed = placed,
                drafted = drafted,
                mine = mine,
                round = DraftFormat.snakeSlot(minOf(room.pickNumber, total), room.teams).round,
                next = MockRoomModel.turnAfter(room.pickNumber, room.slot, room.teams, total),
                previous = RoomDraft.turnBefore(room.pickNumber, room.slot, room.teams),
                queue = room.queue.filter { it !in drafted },
                active = room.status == MockStatus.active,
                lastMine = mine.lastOrNull()?.pick,
                inFlight = ui.busy && ui.draftedAt == room.pickNumber,
                waiting = room.waiting,
                pick = room.pickNumber,
            )
        }
    }
}
