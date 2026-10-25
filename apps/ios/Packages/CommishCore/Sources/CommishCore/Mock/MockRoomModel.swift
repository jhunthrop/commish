import CommishAPI
import CommishDesign
import Foundation

/// The solo room's bar (SoloBar.svelte): the pick on the clock, the league's cells, and its verbs.
public struct MockBar: Equatable, Sendable {
    public let head: String
    public let cells: [MockCell]
    /// The round Pick for me drafts through, and its words.
    public let autopickTo: Int
    public let autopick: String
    /// Your latest pick, which Undo takes back; nil before your first.
    public let undoPick: Int?
}

/// A pool row as the room draws it (PoolRow.svelte at 390): the board's line, whether he is queued, and
/// whether he is the marked row, which shows his verbs.
public struct MockPoolLine: Equatable, Sendable, Identifiable {
    public let line: PoolLine
    public let queued: Bool
    public let marked: Bool

    public var id: String {
        line.id
    }
}

/// The pool (Pool.svelte): the board's pool model with the queue, the marked row and the verbs.
public struct MockPool: Equatable, Sendable {
    public let model: PoolModel
    public let rows: [MockPoolLine]
    /// The chips: the positions, and on your own draft Queue.
    public let filters: [String]
    public let empty: String?
    /// Draft is drawn only while the pick is yours, and pressable while nothing is in flight.
    public let draftShown: Bool
    public let canDraft: Bool
    /// A shared draft's pool: read, never drafted in.
    public let readOnly: Bool

    public var chips: [BoardChip<String>] {
        filters.map { BoardChip(label: $0, value: $0, pressed: $0 == model.filter) }
    }
}

/// The wall (Wall.svelte): each seat's name across the top, then each round's picks seat by seat.
public struct MockWall: Equatable, Sendable {
    public let names: [String]
    public let you: Int
    /// Rounds through the one on the clock, each cell the player taken there or nil.
    public let rows: [[RoomPlayer?]]
    /// The pick on the clock, marked on the wall; nil once the draft is over.
    public let now: Int?
    public let teams: Int
}

/// A shared draft's head (SharedHead.svelte): whose it is, where it stands, its one verb.
public struct MockSharedHead: Equatable, Sendable {
    public let title: String
    public let line: String
    public let verb: String
    public let note: String
}

/// What the room shows in the call's place: our call, its frame while the next one is on its way, or
/// the turn with no call coming, which drafts from the pool.
public enum MockCallState: Equatable, Sendable {
    case call(CallModel, playerID: String)
    case reading(CallModel, words: String)
    case noCall(verb: String?, playerID: String?)
}

/// The room's own state beside the API's answer: the chip, the marked row, the pick in flight, the line
/// after an undo and the call last shown.
public struct MockRoomUI: Equatable, Sendable {
    public var filter = "All"
    public var marked: String?
    /// The pick the drafter just drafted at, until the room moves past it.
    public var draftedAt: Int?
    public var busy = false
    public var notice: String?
    public var callMissing = false
    public var lastCall: CallView?

    public init() {}
}

/// The solo room as SoloRoom.svelte draws it at 390, from the API's answer, the board read with the
/// first and the turn's card: pure, held to shared/fixtures/parity/mock.json.
public struct MockRoomModel: Equatable, Sendable {
    public let room: MockRoom
    public let bar: MockBar?
    public let shared: MockSharedHead?
    public let notice: String?
    public let since: PickStripModel?
    public let straight: String?
    public let call: MockCallState?
    public let pool: MockPool?
    public let wall: MockWall
    public let team: TeamModel
    public let teamTitle: String

    /// SoloRoom.svelte AUTOPICK_ROUNDS and FILTERS.
    public static let autopickRounds = 3
    public static let filters = RoomDraft.filters + [Words.Mock.queue]

    public init(room: MockRoom, board: RoomBoardView, card: RoomCard?, ui: MockRoomUI, sharedBy: String?? = nil) {
        let readOnly = sharedBy != nil
        let whose: Whose = readOnly ? .their : .your
        let teams = room.teams
        let total = teams * room.rounds
        let placed = room.picks.map { PlacedPick(pick: $0.pick, round: $0.round, seat: $0.seat, playerID: $0.playerId) }
        let drafted = RoomDraft.drafted(placed)
        let mine = placed.filter { $0.seat == room.slot }
        let round = DraftFormat.snakeSlot(min(room.pickNumber, total), teams: teams).round
        let next = Self.turnAfter(room.pickNumber, seat: room.slot, teams: teams, total: total)
        let previous = RoomDraft.turnBefore(room.pickNumber, seat: room.slot, teams: teams)
        let queue = room.queue.filter { !drafted.contains($0) }
        let active = Self.status(room) == "active"
        let lastMine = mine.last?.pick
        let inFlight = ui.busy && ui.draftedAt == room.pickNumber
        self.room = room
        let autopickTo = min(room.rounds, round + Self.autopickRounds)
        bar = readOnly || !active ? nil : MockBar(
            head: MockWords.pickHead(room.pickNumber, teams: teams),
            cells: MockWords.barCells(room.settings, slot: room.slot, now: room.pickNumber, round: round, next: next),
            autopickTo: autopickTo, autopick: MockWords.autopick(autopickTo), undoPick: lastMine
        )
        shared = readOnly ? MockSharedHead(
            title: MockWords.sharedTitle(by: room.sharedBy, slot: room.slot),
            line: "\(MockWords.formatLine(room.settings)) · "
                + MockWords.sharedAt(complete: !active, pick: room.pickNumber, teams: teams),
            verb: MockWords.runShared(room.slot), note: Words.Mock.sharedNote
        ) : nil
        notice = ui.notice
        let view = !readOnly && room.waiting ? card.flatMap {
            CallView($0, board: board, drafted: drafted, teams: teams)
        } : nil
        let noCall = ui.callMissing && !readOnly && active && room.waiting && view == nil && !inFlight
        let pool = RoomDraft.pool(board, drafted: drafted, filter: "All")
        call = Self.call(
            view: view, frame: ui.lastCall ?? Self.frame(board, drafted: drafted, teams: teams, pick: room.pickNumber),
            reading: readOnly || !active || !room.waiting || noCall ? nil : inFlight ? next : view == nil ? room
                .pickNumber : nil,
            noCall: noCall, top: ui.marked.flatMap { drafted.contains($0) ? nil : board.byID[$0] } ?? pool.first,
            teams: teams
        )
        let went = RoomDraft.wentSince(placed, since: previous ?? 0, board: board)
        let queued = Set(room.queue)
        since = room.waiting && !inFlight && (lastMine != nil || !went.isEmpty) && !(previous != nil && went.isEmpty)
            ? Self.since(went, previous: previous, queued: queued, teams: teams, whose: whose) : nil
        straight = room.waiting && !inFlight && previous != nil && went.isEmpty ? MockWords.straightBack(whose) : nil
        self.pool = active ? Self.pool(
            room, board: board, drafted: drafted, queue: queue, card: card, view: view, ui: ui,
            noCall: noCall, readOnly: readOnly
        ) : nil
        wall = MockWall(
            names: MockWords.seatNames(teams: teams, slot: room.slot, sharedBy: sharedBy), you: room.slot,
            rows: Self.wall(placed, board: board, teams: teams, rounds: min(room.rounds, round)),
            now: active ? room.pickNumber : nil, teams: teams
        )
        let slots = RoomDraft.team(room.settings, mine: mine, board: board)
        team = TeamModel(
            count: RoomWords.teamCount(slots.count { $0.player != nil }, of: room.rounds),
            slots: slots.enumerated().map { index, slot in
                TeamLine(
                    id: index, slot: slot.slot, player: slot.player,
                    pick: slot.pick.map { DraftFormat.pickLabel($0, teams: teams) }
                )
            }
        )
        teamTitle = readOnly ? Words.Mock.theirTeam : Words.Room.yourTeam
    }

    /// The API's status word: active, complete.
    public static func status(_ room: MockRoom) -> String {
        room.status.value1?.rawValue ?? room.status.value2 ?? ""
    }

    /// model.ts turnAfter: the seat's first turn after a pick, nil when the draft ends first.
    public static func turnAfter(_ pick: Int, seat: Int, teams: Int, total: Int) -> Int? {
        guard pick < total else {
            return nil
        }
        return (pick + 1 ... total).first { RoomDraft.seatAt($0, teams: teams) == seat }
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

    static func call(
        view: CallView?, frame: CallView?, reading: Int?, noCall: Bool, top: RoomPlayer?, teams: Int
    ) -> MockCallState? {
        if noCall {
            return .noCall(verb: top.map { MockWords.draftNamed($0.name) }, playerID: top?.id)
        }
        if let view {
            return .call(callModel(view), playerID: view.player.id)
        }
        guard let reading, let frame else {
            return nil
        }
        return .reading(callModel(frame), words: MockWords.reading(reading, teams: teams))
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

    // swiftlint:disable:next function_parameter_count
    static func pool(
        _ room: MockRoom, board: RoomBoardView, drafted: Set<String>, queue: [String], card: RoomCard?,
        view: CallView?, ui: MockRoomUI, noCall: Bool, readOnly: Bool
    ) -> MockPool {
        let teams = room.teams
        let chances = card?.stillThere.additionalProperties ?? [:]
        let filters = readOnly ? RoomDraft.filters : Self.filters
        let filter = filters.contains(ui.filter) ? ui.filter : "All"
        let players = filter == Words.Mock.queue
            ? queue.compactMap { board.byID[$0] }
            : RoomDraft.pool(board, drafted: drafted, filter: filter)
        let lines = players.map { player in
            PoolLine(
                player: player, value: RoomWords.value(player),
                heat: player.vor.flatMap { vor in player.vorRound.map { Heat.of(vor: vor, round: $0) } },
                chance: readOnly ? nil : chances[player.id].map(DraftFormat.chanceShort),
                isCall: player.id == view?.player.id
            )
        }
        let model = PoolModel(
            line: RoomWords.poolLine(board.players.count - drafted.count),
            basis: readOnly ? board.basis : MockWords.poolBasis(board, card: card, teams: teams, callMissing: noCall),
            chanceHead: readOnly ? nil : Words.Mock.stillThere,
            chanceLabel: MockWords.chanceLabel(card?.nextPick, teams: teams),
            missing: RoomWords.chanceMissing(gone: noCall, read: !chances.isEmpty), filter: filter, rows: lines
        )
        let queued = Set(queue)
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
}

extension CallView {
    /// A call built from its rows: the frame the panel holds while the next call is on its way.
    init(player: RoomPlayer, rows: [CallRow], forLabel: String, nextLabel: String?, conditional: Bool) {
        self.player = player
        self.rows = rows
        self.forLabel = forLabel
        self.nextLabel = nextLabel
        self.conditional = conditional
    }
}
