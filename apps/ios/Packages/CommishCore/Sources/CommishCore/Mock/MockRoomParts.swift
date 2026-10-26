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
