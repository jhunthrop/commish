import CommishAPI
import Foundation

/// The recorded lobby (shared/fixtures/lobby-room, api/tools/lobbyrecord): three drafters in a 12_ppr
/// lobby against a local API and room service, every answer the API's envelope as it answered, and
/// every frame the recorded drafter's socket sent and received.
public enum LobbyFixture {
    /// The recorded room's id, as every answer names it.
    public static let id = "02294fd3-7304-4129-9071-1e7d95b4a4d5"

    static let folder = RunFixture.fixtures.appendingPathComponent("lobby-room")

    public static func data(_ file: String) throws -> Data {
        try Data(contentsOf: folder.appendingPathComponent("\(file).json"))
    }

    /// The room while it fills, or once drafted.
    public static func room(complete: Bool = false) throws -> LobbyRoom {
        try APIDecoding.envelopeData(LobbyRoom.self, from: data(complete ? "room-complete" : "room-filling"))
    }

    public static func lobbies() throws -> [LobbyFilling] {
        try APIDecoding.envelopeData([LobbyFilling].self, from: data("lobbies"))
    }

    public static func seat() throws -> LobbySeat {
        try APIDecoding.envelopeData(LobbySeat.self, from: data("join"))
    }

    /// Our call on the recorded drafter's turn at that overall pick (9, 16, 33, 40), nil off them.
    public static func card(_ pick: Int) -> RoomCard? {
        try? APIDecoding.envelopeData(RoomCard.self, from: data("card-\(pick)"))
    }

    /// A seat's report: hunt (the recorded drafter, 7th of 12), jpk88 (1st), mara (9th).
    public static func report(_ handle: String = "hunt") throws -> MockReport {
        try APIDecoding.envelopeData(MockReport.self, from: data("report-\(handle)"))
    }

    /// One step of the recorded socket: a frame the drafter sent or one the room sent, as its JSON text.
    public enum Step: Equatable, Sendable {
        case client(String)
        case server(String)
    }

    /// The recorded socket's frames, in order.
    public static func steps() throws -> [Step] {
        let object = try JSONSerialization.jsonObject(with: data("exchange"))
        guard let root = object as? [String: Any], let steps = root["steps"] as? [[String: Any]] else {
            return []
        }
        return try steps.map { step in
            let (key, value) = step.first ?? ("", [:])
            let text = try String(
                bytes: JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8
            ) ?? ""
            return key == "client" ? .client(text) : .server(text)
        }
    }

    /// The parity file the web wrote over this lobby (shared/fixtures/parity/lobby.json).
    public static func parity() throws -> Data {
        try Data(contentsOf: RunFixture.fixtures.appendingPathComponent("parity/lobby.json"))
    }
}

/// The lobby's API over the recorded lobby: the list, a join answering the recorded seat (or asking for
/// a handle first), the room, its cards by pick and the reports; `refusal` refuses the room's read with
/// a status (403, 404) every time. Records what was asked.
public actor StubLobby: LobbyAPI {
    public private(set) var joins: [String] = []
    public private(set) var reads = 0
    public private(set) var leaves = 0
    public private(set) var cards = 0
    public private(set) var handles: [String] = []
    private var refusal: Int?
    private var refusalFrom = 1
    private var needsHandle: Bool
    private var complete = false
    private var cardPick = 9
    private var hangs = false

    public init(needsHandle: Bool = false) {
        self.needsHandle = needsHandle
    }

    /// From the `fromRead`th room read on (the first by default), the read is refused with `status`.
    public func setRefusal(_ status: Int?, fromRead: Int = 1) {
        refusal = status
        refusalFrom = fromRead
    }

    public func setComplete(_ complete: Bool) {
        self.complete = complete
    }

    /// The room's read waits until its task is cancelled (a screen that goes mid-read).
    public func setHangs(_ hangs: Bool) {
        self.hangs = hangs
    }

    /// The pick whose recorded card the card route answers.
    public func setCardPick(_ pick: Int) {
        cardPick = pick
    }

    public func lobbies() async throws -> [LobbyFilling] {
        try LobbyFixture.lobbies()
    }

    public func join(_ format: LobbyFormat) async throws -> LobbySeat {
        joins.append(format.value1?.rawValue ?? format.value2 ?? "")
        if needsHandle {
            throw LobbyHandleNeeded(message: "Pick a handle first")
        }
        return try LobbyFixture.seat()
    }

    public func lobby(id _: String) async throws -> LobbyRoom {
        reads += 1
        if hangs {
            try await Task.sleep(nanoseconds: UInt64.max)
        }
        if let refusal, reads >= refusalFrom {
            throw APIError.status(refusal)
        }
        return try LobbyFixture.room(complete: complete)
    }

    public func leave(id _: String) async throws {
        leaves += 1
        if let refusal {
            throw APIError.status(refusal)
        }
    }

    public func lobbyCard(id _: String) async throws -> RoomCard {
        cards += 1
        guard let card = LobbyFixture.card(cardPick) else {
            throw APIError.status(409)
        }
        return card
    }

    public func lobbyReport(id _: String) async throws -> MockReport {
        try LobbyFixture.report()
    }

    public func setHandle(_ handle: String) async throws {
        handles.append(handle)
        needsHandle = false
    }
}
