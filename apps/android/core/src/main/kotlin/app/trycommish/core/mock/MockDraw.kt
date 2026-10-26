package app.trycommish.core.mock

import app.trycommish.api.models.MockRoom
import app.trycommish.core.board.Heat
import app.trycommish.core.companion.CallLine
import app.trycommish.core.companion.CallModel
import app.trycommish.core.companion.CallRow
import app.trycommish.core.companion.CallView
import app.trycommish.core.companion.DraftFormat
import app.trycommish.core.companion.PickStripModel
import app.trycommish.core.companion.PlacedPick
import app.trycommish.core.companion.PoolLine
import app.trycommish.core.companion.PoolModel
import app.trycommish.core.companion.RoomBoardView
import app.trycommish.core.companion.RoomDraft
import app.trycommish.core.companion.RoomPlayer
import app.trycommish.core.companion.RoomWords
import app.trycommish.core.companion.StripFace
import app.trycommish.core.companion.TeamLine
import app.trycommish.core.companion.TeamModel
import app.trycommish.core.companion.WentPick
import app.trycommish.design.Words

/** The room's parts, each drawn from the answer's facts as SoloRoom.svelte draws it (the iOS MockRoomDraw). */
internal object MockDraw {
    /** call.ts CALL_ROWS: the frame's rows. */
    private const val FRAME_ROWS = 3

    fun bar(
        room: MockRoom,
        draft: MockFacts,
    ): MockBar? {
        if (draft.readOnly || !draft.active) return null
        val autopickTo = minOf(room.rounds, draft.round + MockRoomModel.AUTOPICK_ROUNDS)
        return MockBar(
            head = MockWords.pickHead(room.pickNumber, draft.teams),
            cells = MockWords.barCells(room.settings, room.slot, room.pickNumber, draft.round, draft.next),
            autopickTo = autopickTo,
            autopick = MockWords.autopick(autopickTo),
            undoPick = draft.lastMine,
        )
    }

    fun sharedHead(
        room: MockRoom,
        active: Boolean,
    ): MockSharedHead =
        MockSharedHead(
            title = MockWords.sharedTitle(room.sharedBy, room.slot),
            line = "${MockWords.formatLine(room.settings)} · ${MockWords.sharedAt(!active, room.pickNumber, room.teams)}",
            verb = MockWords.runShared(room.slot),
            note = Words.Mock.sharedNote,
        )

    /** Our call; while the next is on its way the last frame with its words (the next turn when a pick is in
     * flight, else this one); with no call coming the verb that drafts the marked or top row. */
    fun call(
        view: CallView?,
        noCall: Boolean,
        draft: MockFacts,
        board: RoomBoardView,
        ui: MockRoomUi,
    ): MockCallState? {
        if (noCall) {
            val top =
                ui.marked?.takeIf { it !in draft.drafted }?.let { board.byId[it] }
                    ?: RoomDraft.pool(board, draft.drafted, RoomDraft.ALL).firstOrNull()
            return MockCallState.NoCall(top?.let { MockWords.draftNamed(it.name) }, top?.id)
        }
        if (view != null) return MockCallState.Call(callModel(view), view.player.id)
        if (draft.readOnly || !draft.active || !draft.waiting) return null
        val reading = (if (draft.inFlight) draft.next else draft.pick) ?: return null
        val frame = ui.lastCall ?: frame(board, draft.drafted, draft.teams, reading) ?: return null
        return MockCallState.Reading(callModel(frame), MockWords.reading(reading, draft.teams))
    }

    /** call.ts frameView: the best players left by points over replacement, no chances; drawn only as the
     * reading skeleton. */
    fun frame(
        board: RoomBoardView,
        drafted: Set<String>,
        teams: Int,
        pick: Int,
    ): CallView? {
        val left =
            board.players
                .withIndex()
                .filter { it.value.id !in drafted && it.value.vor != null }
                .sortedWith(compareByDescending<IndexedValue<RoomPlayer>> { it.value.vor }.thenBy { it.index })
                .take(FRAME_ROWS)
                .map { it.value }
        val player = left.firstOrNull() ?: return null
        return CallView(player, left.map { CallRow(it, null) }, DraftFormat.pickLabel(pick, teams), nextLabel = null, conditional = false)
    }

    fun callModel(view: CallView): CallModel =
        CallModel(
            tag = view.tag,
            chanceHead = view.chanceHead,
            verb = MockWords.draftWords(view.player.position),
            waiting = view.conditional,
            rows =
                view.rows.map { row ->
                    val chance = if (view.chanceHead == null) "" else row.chance?.let(DraftFormat::chanceShort).orEmpty()
                    CallLine(row.player, RoomWords.callValue(row), chance)
                },
        )

    /** SinceStrip.svelte: every pick since your last, ringed when it was in your queue, and how many were. */
    fun since(
        went: List<WentPick>,
        previous: Int?,
        queued: Set<String>,
        teams: Int,
        whose: Whose,
    ): PickStripModel {
        val lead = MockWords.sinceLead(previous, teams, whose)
        val fromQueue = went.count { it.player.id in queued }
        return PickStripModel(
            lead = went.size.toString(),
            lines = if (queued.isEmpty()) listOf(lead) else listOf(lead, MockWords.sinceQueued(fromQueue, whose)),
            picks =
                went.map { (player, pick) ->
                    val label = DraftFormat.pickLabel(pick, teams)
                    val isQueued = player.id in queued
                    StripFace(
                        pick,
                        player,
                        DraftFormat.lastName(player.name),
                        if (isQueued) listOf(label, Words.Mock.queuedTag) else listOf(label),
                        newest = false,
                        strong = isQueued,
                    )
                },
        )
    }

    /** Pool.svelte: the rows under the chip (the queue in its order under Queue), each with its value, tint
     * and chance, and the verbs the turn allows. */
    fun pool(
        room: MockRoom,
        board: RoomBoardView,
        draft: MockFacts,
        turn: MockTurn,
        ui: MockRoomUi,
    ): MockPool {
        val readOnly = draft.readOnly
        val card = turn.card
        val chances = card?.stillThere.orEmpty()
        val filters = if (readOnly) RoomDraft.filters else MockRoomModel.filters
        val filter = ui.filter.takeIf { it in filters } ?: RoomDraft.ALL
        val players =
            if (filter == Words.Mock.queue) {
                draft.queue.mapNotNull { board.byId[it] }
            } else {
                RoomDraft.pool(board, draft.drafted, filter)
            }
        val lines =
            players.map { player ->
                val vor = player.vor
                val round = player.vorRound
                PoolLine(
                    player = player,
                    value = RoomWords.value(player),
                    heat = if (vor != null && round != null) Heat.of(vor, round) else null,
                    chance = if (readOnly) null else chances[player.id]?.let(DraftFormat::chanceShort),
                    isCall = player.id == turn.view?.player?.id,
                )
            }
        val model =
            PoolModel(
                line = RoomWords.poolLine(board.players.size - draft.drafted.size),
                basis = if (readOnly) board.basis else MockWords.poolBasis(board, card, draft.teams, turn.noCall),
                chanceHead = if (readOnly) null else Words.Mock.stillThere,
                chanceLabel = MockWords.chanceLabel(card?.nextPick, draft.teams),
                missing = RoomWords.chanceMissing(gone = turn.noCall, read = chances.isNotEmpty()),
                filter = filter,
                rows = lines,
            )
        val queued = draft.queue.toSet()
        return MockPool(
            model = model,
            rows = lines.map { MockPoolLine(it, it.player.id in queued, it.player.id == ui.marked) },
            filters = filters,
            empty = if (lines.isEmpty()) MockWords.poolEmpty(filter) else null,
            draftShown = room.waiting && !readOnly,
            canDraft = !readOnly && room.waiting && !ui.busy,
            readOnly = readOnly,
        )
    }

    /** TeamPanel.svelte: your team by slot with the count and the pick that took each. */
    fun team(
        room: MockRoom,
        mine: List<PlacedPick>,
        board: RoomBoardView,
    ): TeamModel {
        val slots = RoomDraft.team(room.settings.roster, room.settings.lineup, mine, board)
        return TeamModel(
            count = RoomWords.teamCount(slots.count { it.player != null }, room.rounds),
            slots = slots.map { TeamLine(it.slot, it.player, it.pick?.let { pick -> DraftFormat.pickLabel(pick, room.teams) }) },
        )
    }
}
