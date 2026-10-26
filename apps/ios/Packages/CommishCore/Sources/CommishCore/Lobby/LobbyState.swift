import CommishAPI
import CommishDesign
import Foundation

/// Who holds a seat (web/src/lib/room/lobby.ts SeatKind): a drafter, a bot, a drafter who left and
/// whose stand-in drafts, or a seat nobody holds yet.
public enum LobbySeatKind: String, Equatable, Sendable {
    case drafter, bot, left, open
}

/// A seat as the log's replay names it: the drafter's handle (kept after he leaves) and who holds it.
public struct LobbySeatState: Equatable, Sendable {
    public let handle: String?
    public let kind: LobbySeatKind

    public init(handle: String?, kind: LobbySeatKind) {
        self.handle = handle
        self.kind = kind
    }
}

/// Who made a pick: a drafter's own hand, a bot, a stand-in for a drafter who left, an expired clock.
public enum LobbyPickBy: String, Equatable, Sendable {
    case drafter, bot, queue, clock
}

/// A pick in the lobby's log (lobby.ts LobbyPick): the pick, its round and seat, whom it took, who
/// made it.
public struct LobbyPick: Equatable, Sendable {
    public let pick: Int
    public let round: Int
    public let seat: Int
    public let playerID: String
    public let madeBy: LobbyPickBy

    public var placed: PlacedPick {
        PlacedPick(pick: pick, round: round, seat: seat, playerID: playerID)
    }
}

/// A lobby as its log replays on the phone (lobby.ts LobbyState): who sits where, every pick with who
/// made it, the pick on the clock and when its clock runs out on the room's clock, your queue. Built
/// from the room's own rows, so a reconnect that sends the rows since the last seq brings the screen to
/// exactly where the room is; never from a local guess.
public struct LobbyState: Equatable, Sendable {
    public let seq: Int64
    public let seats: [Int: LobbySeatState]
    public let picks: [LobbyPick]
    /// The pick on the clock, 1 until the draft starts.
    public let pickNumber: Int
    /// When the turn on the clock runs out, on the room's clock.
    public let deadline: Date?
    public let drafting: Bool
    public let complete: Bool
    /// The room closed before it drafted: nobody was here when it filled.
    public let abandoned: Bool
    public let soloPace: Bool
    /// Your queue, best first, as the room last stored it.
    public let queue: [String]

    /// lobby.ts initialLobby: the room before its first row, its status from the room's read.
    public init(room: LobbyRoom) {
        self.init(
            seq: 0, seats: [:], picks: [], pickNumber: 1, deadline: nil, drafting: false,
            complete: room.status.value1 == .complete, abandoned: room.status.value1 == .abandoned,
            soloPace: room.soloPace, queue: []
        )
    }

    init(
        seq: Int64, seats: [Int: LobbySeatState], picks: [LobbyPick], pickNumber: Int, deadline: Date?,
        drafting: Bool, complete: Bool, abandoned: Bool, soloPace: Bool, queue: [String]
    ) {
        self.seq = seq
        self.seats = seats
        self.picks = picks
        self.pickNumber = pickNumber
        self.deadline = deadline
        self.drafting = drafting
        self.complete = complete
        self.abandoned = abandoned
        self.soloPace = soloPace
        self.queue = queue
    }

    /// lobby.ts applyActions: the log's rows applied in seq order; a row already applied is passed over.
    public func applying(_ rows: [RoomRow], you: Int) -> LobbyState {
        rows.sorted { $0.seq < $1.seq }.reduce(self) { state, row in
            row.seq <= state.seq ? state : state.with(seq: row.seq).applyingOne(row, you: you)
        }
    }

    /// The players the log's picks took.
    public var drafted: Set<String> {
        Set(picks.map(\.playerID))
    }
}

extension LobbyState {
    private func with(
        seq: Int64? = nil, seats: [Int: LobbySeatState]? = nil, picks: [LobbyPick]? = nil, pickNumber: Int? = nil,
        deadline: Date?? = nil, drafting: Bool? = nil, complete: Bool? = nil, abandoned: Bool? = nil,
        soloPace: Bool? = nil, queue: [String]? = nil
    ) -> LobbyState {
        LobbyState(
            seq: seq ?? self.seq, seats: seats ?? self.seats, picks: picks ?? self.picks,
            pickNumber: pickNumber ?? self.pickNumber, deadline: deadline ?? self.deadline,
            drafting: drafting ?? self.drafting, complete: complete ?? self.complete,
            abandoned: abandoned ?? self.abandoned, soloPace: soloPace ?? self.soloPace, queue: queue ?? self.queue
        )
    }

    private func withSeat(_ seat: Int, handle: String?? = nil, kind: LobbySeatKind) -> LobbyState {
        let current = seats[seat] ?? LobbySeatState(handle: nil, kind: .open)
        var next = seats
        next[seat] = LobbySeatState(handle: handle ?? current.handle, kind: kind)
        return with(seats: next)
    }

    /// A seat's row: joined, left (freed while the room fills), returned; nil for any other row.
    private func seated(_ row: RoomRow) -> LobbyState? {
        let payload = row.payload
        switch row.kind {
        case "SEAT_JOINED":
            return row.seat.map { withSeat($0, handle: .some(payload["handle"]?.text), kind: .drafter) } ?? self
        case "SEAT_LEFT":
            return row.seat.map { withSeat($0, kind: payload["freed"]?.flag == true ? .open : .left) } ?? self
        case "SEAT_RETURNED":
            return row.seat.map { withSeat($0, kind: .drafter) } ?? self
        default:
            return nil
        }
    }

    private func applyingOne(_ row: RoomRow, you: Int) -> LobbyState {
        if let seated = seated(row) {
            return seated
        }
        let payload = row.payload
        switch row.kind {
        case "ROOM_STARTED":
            let bots = payload["bots"]?.numbers ?? []
            return bots.reduce(with(soloPace: payload["solo_pace"]?.flag ?? false)) { state, bot in
                state.withSeat(bot, handle: .some(nil), kind: .bot)
            }
        case "START_DRAFT":
            return with(pickNumber: 1, deadline: .some(Self.deadline(payload)), drafting: true)
        case "SET_QUEUE":
            let mine = row.seat == you || payload["action"]?["teamId"]?.text == Self.team(you)
            return mine ? with(queue: payload["action"]?["playerIds"]?.texts ?? []) : self
        case "MAKE_PICK", "TIMER_EXPIRE":
            guard let pick = Self.pick(payload["pick"]) else {
                return self
            }
            return with(picks: picks + [pick], pickNumber: pick.pick + 1, deadline: .some(Self.deadline(payload)))
        case "ROOM_ABANDONED":
            return with(deadline: .some(nil), drafting: false, abandoned: true)
        case "ROOM_COMPLETE":
            return with(deadline: .some(nil), drafting: false, complete: true)
        default:
            return self
        }
    }

    /// lobby.ts teamOf: the engine's team id for a seat, "seat04".
    static func team(_ seat: Int) -> String {
        "seat" + (seat < 10 ? "0\(seat)" : String(seat))
    }

    static func deadline(_ payload: RoomValue) -> Date? {
        payload["deadline"]?.text.flatMap(RoomClockReading.parse)
    }

    static func pick(_ value: RoomValue?) -> LobbyPick? {
        guard let value, let pick = value["pick"]?.int, let round = value["round"]?.int,
              let seat = value["seat"]?.int, let player = value["player_id"]?.text
        else {
            return nil
        }
        let madeBy = value["by"]?.text.flatMap(LobbyPickBy.init(rawValue:)) ?? .bot
        return LobbyPick(pick: pick, round: round, seat: seat, playerID: player, madeBy: madeBy)
    }
}

extension RoomValue {
    var text: String? {
        if case let .string(value) = self {
            return value
        }
        return nil
    }

    var flag: Bool? {
        if case let .bool(value) = self {
            return value
        }
        return nil
    }

    var int: Int? {
        if case let .number(value) = self {
            return Int(value)
        }
        return nil
    }

    var numbers: [Int]? {
        guard case let .array(values) = self else {
            return nil
        }
        return values.compactMap(\.int)
    }

    var texts: [String]? {
        guard case let .array(values) = self else {
            return nil
        }
        return values.compactMap(\.text)
    }
}

/// The lobby's readers over its seats (lobby.ts): a seat's name, the people in it, who made a pick.
public enum LobbySeats {
    /// lobby.ts seatName: You, a drafter's handle (kept after he leaves), Seat N while nobody holds it,
    /// or Bot N.
    public static func name(_ seat: Int, state: LobbySeatState?, you: Int) -> String {
        if seat == you {
            return "You"
        }
        let state = state ?? LobbySeatState(handle: nil, kind: .open)
        if state.kind == .open {
            return "Seat \(seat)"
        }
        guard state.kind != .bot, let handle = state.handle else {
            return "Bot \(seat)"
        }
        return handle
    }

    /// The API's seat list in the same words (the report's names).
    public static func name(_ view: LobbySeatView, you: Int) -> String {
        name(view.seat, state: LobbySeatState(handle: view.handle, kind: kind(view)), you: you)
    }

    public static func kind(_ view: LobbySeatView) -> LobbySeatKind {
        (view.kind.value1?.rawValue ?? view.kind.value2).flatMap(LobbySeatKind.init(rawValue:)) ?? .open
    }

    /// lobby.ts seatedPeople: everyone who held a seat when it started, here or gone with a stand-in.
    public static func people(_ kinds: [LobbySeatKind]) -> Int {
        kinds.count { $0 == .drafter || $0 == .left }
    }

    /// lobby.ts pickCredit: who made a pick in the strip's words, a stand-in's credit on two lines.
    public static func credit(_ pick: LobbyPick, seats: [Int: LobbySeatState], you: Int) -> [String] {
        let owner = pick.seat == you ? "you" : (seats[pick.seat]?.handle ?? "Bot \(pick.seat)")
        switch pick.madeBy {
        case .drafter: return [owner]
        case .queue: return ["bot for", owner]
        case .clock: return ["clock for", owner]
        case .bot: return ["Bot \(pick.seat)"]
        }
    }
}
