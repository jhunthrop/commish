import CommishAPI
import CommishDesign
import Foundation

/// The room's parts, each drawn from the answer's facts as SoloRoom.svelte draws it.
extension MockRoomModel {
    /// The turn's call as the pool reads it: the card, our call from it, and whether none is coming.
    struct Turn {
        let card: RoomCard?
        let view: CallView?
        let noCall: Bool
    }

    static func bar(_ room: MockRoom, _ draft: Facts) -> MockBar? {
        guard !draft.readOnly, draft.active else {
            return nil
        }
        let autopickTo = min(room.rounds, draft.round + autopickRounds)
        return MockBar(
            head: MockWords.pickHead(room.pickNumber, teams: draft.teams),
            cells: MockWords.barCells(
                room.settings, slot: room.slot, now: room.pickNumber, round: draft.round, next: draft.next
            ),
            autopickTo: autopickTo, autopick: MockWords.autopick(autopickTo), undoPick: draft.lastMine
        )
    }

    static func sharedHead(_ room: MockRoom, active: Bool) -> MockSharedHead {
        MockSharedHead(
            title: MockWords.sharedTitle(sharedBy: room.sharedBy, slot: room.slot),
            line: "\(MockWords.formatLine(room.settings)) · "
                + MockWords.sharedAt(complete: !active, pick: room.pickNumber, teams: room.teams),
            verb: MockWords.runShared(room.slot), note: Words.Mock.sharedNote
        )
    }

    /// Our call; while the next is on its way the last frame with its words (the next turn when a pick
    /// is in flight, else this one); with no call coming the verb that drafts the marked or top row.
    static func call(
        view: CallView?, noCall: Bool, draft: Facts, board: RoomBoardView, ui: MockRoomUI
    ) -> MockCallState? {
        if noCall {
            let top = ui.marked.flatMap { draft.drafted.contains($0) ? nil : board.byID[$0] }
                ?? RoomDraft.pool(board, drafted: draft.drafted, filter: "All").first
            return .noCall(verb: top.map { MockWords.draftNamed($0.name) }, playerID: top?.id)
        }
        if let view {
            return .call(callModel(view), playerID: view.player.id)
        }
        guard !draft.readOnly, draft.active, draft.waiting else {
            return nil
        }
        let reading = draft.inFlight ? draft.next : draft.pick
        guard let reading, let frame = ui.lastCall ?? frame(
            board,
            drafted: draft.drafted,
            teams: draft.teams,
            pick: reading
        )
        else {
            return nil
        }
        return .reading(callModel(frame), words: MockWords.reading(reading, teams: draft.teams))
    }

    /// call.ts frameView: the best players left by points over replacement, no chances; drawn only as
    /// the reading skeleton.
    static func frame(_ board: RoomBoardView, drafted: Set<String>, teams: Int, pick: Int) -> CallView? {
        let left = board.players.enumerated()
            .filter { !drafted.contains($0.element.id) && $0.element.vor != nil }
            .sorted { ($0.element.vor ?? 0, -$0.offset) > ($1.element.vor ?? 0, -$1.offset) }
            .prefix(CallView.rowCount).map(\.element)
        guard let player = left.first else {
            return nil
        }
        return CallView(
            player: player, rows: left.map { CallRow(player: $0, chance: nil) },
            forLabel: DraftFormat.pickLabel(pick, teams: teams), nextLabel: nil, conditional: false
        )
    }

    static func callModel(_ view: CallView) -> CallModel {
        CallModel(
            tag: view.tag, chanceHead: view.chanceHead, verb: MockWords.draftWords(view.player.position),
            waiting: view.conditional,
            rows: view.rows.map { row in
                CallLine(
                    player: row.player, value: RoomWords.callValue(row),
                    chance: view.chanceHead == nil ? "" : row.chance.map(DraftFormat.chanceShort) ?? ""
                )
            }
        )
    }

    /// SinceStrip.svelte: every pick since your last, ringed when it was in your queue, and how many were.
    static func since(
        _ went: [(RoomPlayer, Int)], previous: Int?, queued: Set<String>, teams: Int, whose: Whose
    ) -> PickStripModel {
        let lead = MockWords.sinceLead(previous, teams: teams, whose: whose)
        let fromQueue = went.count { queued.contains($0.0.id) }
        return PickStripModel(
            lead: String(went.count),
            lines: queued.isEmpty ? [lead] : [lead, MockWords.sinceQueued(fromQueue, whose: whose)],
            picks: went.map { player, pick in
                let label = DraftFormat.pickLabel(pick, teams: teams)
                let isQueued = queued.contains(player.id)
                return StripFace(
                    id: pick, player: player, name: DraftFormat.lastName(player.name),
                    lines: isQueued ? [label, "queued"] : [label], newest: false, strong: isQueued
                )
            }
        )
    }

    /// Pool.svelte: the rows under the chip (the queue in its order under Queue), each with its value,
    /// tint and chance, and the verbs the turn allows.
    static func pool(_ room: MockRoom, board: RoomBoardView, draft: Facts, turn: Turn, ui: MockRoomUI) -> MockPool {
        let (card, view, noCall) = (turn.card, turn.view, turn.noCall)
        let readOnly = draft.readOnly
        let chances = card?.stillThere.additionalProperties ?? [:]
        let filters = readOnly ? RoomDraft.filters : Self.filters
        let filter = filters.contains(ui.filter) ? ui.filter : "All"
        let players = filter == Words.Mock.queue
            ? draft.queue.compactMap { board.byID[$0] }
            : RoomDraft.pool(board, drafted: draft.drafted, filter: filter)
        let lines = players.map { player in
            PoolLine(
                player: player, value: RoomWords.value(player),
                heat: player.vor.flatMap { vor in player.vorRound.map { Heat.of(vor: vor, round: $0) } },
                chance: readOnly ? nil : chances[player.id].map(DraftFormat.chanceShort),
                isCall: player.id == view?.player.id
            )
        }
        let model = PoolModel(
            line: RoomWords.poolLine(board.players.count - draft.drafted.count),
            basis: readOnly
                ? board.basis : MockWords.poolBasis(board, card: card, teams: draft.teams, callMissing: noCall),
            chanceHead: readOnly ? nil : Words.Mock.stillThere,
            chanceLabel: MockWords.chanceLabel(card?.nextPick, teams: draft.teams),
            missing: RoomWords.chanceMissing(gone: noCall, read: !chances.isEmpty), filter: filter, rows: lines
        )
        let queued = Set(draft.queue)
        return MockPool(
            model: model,
            rows: lines.map { MockPoolLine(line: $0, queued: queued.contains($0.id), marked: $0.id == ui.marked) },
            filters: filters, empty: lines.isEmpty ? MockWords.poolEmpty(filter: filter) : nil,
            draftShown: room.waiting && !readOnly, canDraft: !readOnly && room.waiting && !ui.busy, readOnly: readOnly
        )
    }

    /// model.ts wallRows: the rounds through `rounds`, seat by seat.
    static func wall(_ picks: [PlacedPick], board: RoomBoardView, teams: Int, rounds: Int) -> [[RoomPlayer?]] {
        let byPick = Dictionary(picks.map { ($0.pick, $0.playerID) }, uniquingKeysWith: { first, _ in first })
        return (0 ..< max(rounds, 0)).map { index in
            (1 ... teams).map { seat in
                let pick = index % 2 == 0 ? index * teams + seat : index * teams + (teams - seat + 1)
                return byPick[pick].flatMap { board.byID[$0] }
            }
        }
    }

    /// TeamPanel.svelte: your team by slot with the count and the pick that took each.
    static func team(_ room: MockRoom, mine: [PlacedPick], board: RoomBoardView) -> TeamModel {
        let slots = RoomDraft.team(room.settings, mine: mine, board: board)
        return TeamModel(
            count: RoomWords.teamCount(slots.count { $0.player != nil }, of: room.rounds),
            slots: slots.enumerated().map { index, slot in
                TeamLine(
                    id: index, slot: slot.slot, player: slot.player,
                    pick: slot.pick.map { DraftFormat.pickLabel($0, teams: room.teams) }
                )
            }
        )
    }
}
