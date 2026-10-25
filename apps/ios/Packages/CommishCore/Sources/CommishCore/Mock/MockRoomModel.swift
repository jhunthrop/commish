import CommishAPI
import CommishDesign
import Foundation

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

    /// `sharedBy` is set for someone else's draft read through its link (its drafter's handle, or nil
    /// with none): read, never drafted in.
    public init(room: MockRoom, board: RoomBoardView, card: RoomCard?, ui: MockRoomUI, sharedBy: String?? = nil) {
        let draft = Facts(room, ui: ui, readOnly: sharedBy != nil)
        self.room = room
        bar = Self.bar(room, draft)
        shared = draft.readOnly ? Self.sharedHead(room, active: draft.active) : nil
        notice = ui.notice
        let view = !draft.readOnly && room.waiting
            ? card.flatMap { CallView($0, board: board, drafted: draft.drafted, teams: draft.teams) } : nil
        let noCall = ui.callMissing && !draft.readOnly && draft.active && room.waiting && view == nil
            && !draft.inFlight
        call = Self.call(view: view, noCall: noCall, draft: draft, board: board, ui: ui)
        let went = RoomDraft.wentSince(draft.placed, since: draft.previous ?? 0, board: board)
        let showing = room.waiting && !draft.inFlight
        let cameBack = draft.previous != nil && went.isEmpty
        since = showing && (draft.lastMine != nil || !went.isEmpty) && !cameBack
            ? Self.since(
                went,
                previous: draft.previous,
                queued: Set(room.queue),
                teams: draft.teams,
                whose: draft.whose
            )
            : nil
        straight = showing && cameBack ? MockWords.straightBack(draft.whose) : nil
        pool = draft.active
            ? Self
            .pool(room, board: board, draft: draft, turn: Turn(card: card, view: view, noCall: noCall), ui: ui) :
            nil
        wall = MockWall(
            names: MockWords.seatNames(teams: draft.teams, slot: room.slot, sharedBy: sharedBy), you: room.slot,
            rows: Self.wall(draft.placed, board: board, teams: draft.teams, rounds: min(room.rounds, draft.round)),
            now: draft.active ? room.pickNumber : nil, teams: draft.teams
        )
        team = Self.team(room, mine: draft.mine, board: board)
        teamTitle = draft.readOnly ? Words.Mock.theirTeam : Words.Room.yourTeam
    }

    /// What the room reads off the answer before it draws (SoloRoom.svelte's derived values).
    struct Facts {
        let readOnly: Bool
        let whose: Whose
        let teams: Int
        let placed: [PlacedPick]
        let drafted: Set<String>
        let mine: [PlacedPick]
        let round: Int
        let next: Int?
        let previous: Int?
        let queue: [String]
        let active: Bool
        let lastMine: Int?
        let inFlight: Bool
        let waiting: Bool
        let pick: Int

        init(_ room: MockRoom, ui: MockRoomUI, readOnly: Bool) {
            self.readOnly = readOnly
            whose = readOnly ? .their : .your
            teams = room.teams
            let total = room.teams * room.rounds
            let placed = room.picks.map {
                PlacedPick(pick: $0.pick, round: $0.round, seat: $0.seat, playerID: $0.playerId)
            }
            let drafted = RoomDraft.drafted(placed)
            self.placed = placed
            self.drafted = drafted
            mine = placed.filter { $0.seat == room.slot }
            round = DraftFormat.snakeSlot(min(room.pickNumber, total), teams: room.teams).round
            next = MockRoomModel.turnAfter(room.pickNumber, seat: room.slot, teams: room.teams, total: total)
            previous = RoomDraft.turnBefore(room.pickNumber, seat: room.slot, teams: room.teams)
            queue = room.queue.filter { !drafted.contains($0) }
            active = MockRoomModel.status(room) == "active"
            lastMine = mine.last?.pick
            inFlight = ui.busy && ui.draftedAt == room.pickNumber
            waiting = room.waiting
            pick = room.pickNumber
        }
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
}
