import CommishAPI
import Foundation

/// The recorded mock draft (shared/fixtures/mock-room, web/scripts/record-mock-room.ts): two solo mocks
/// on seed 213 against a local API, every answer the API's envelope as it answered.
public enum MockFixture {
    /// A room answer, in the order the draft was recorded.
    public enum Answer: String, CaseIterable, Sendable {
        /// Slot 5 at its first turn, 1.05, the board and our call with it.
        case create
        case pick1 = "pick-1"
        case pick2 = "pick-2"
        case pick3 = "pick-3"
        /// 4.08 drafted: the room at 5.05.
        case pick4 = "pick-4"
        /// The room at 5.05 read whole, the board with it.
        case round5
        /// Three players queued at 5.05.
        case queue
        /// 4.08 taken back.
        case undo
        /// 4.08 drafted again.
        case pickAgain = "pick-again"
        /// Pick for me through round 8.
        case autopick
        /// Finish the draft.
        case finish
        /// The draft at 5.05 read through its link.
        case sharedRound5 = "shared-round5"
        /// The finished draft read through its link.
        case sharedComplete = "shared-complete"
    }

    /// The first mock's id in every answer.
    public static let id = "fixture-mock"

    static let folder = RunFixture.fixtures.appendingPathComponent("mock-room")

    public static func data(_ file: String) throws -> Data {
        try Data(contentsOf: folder.appendingPathComponent("\(file).json"))
    }

    public static func room(_ answer: Answer) throws -> MockRoom {
        try APIDecoding.envelopeData(MockRoom.self, from: data(answer.rawValue))
    }

    public static func card() throws -> RoomCard {
        try APIDecoding.envelopeData(RoomCard.self, from: data("card-first"))
    }

    /// The report at 1st of 12, the one well down (12th of 12) and the shared one.
    public static func report(_ name: String = "report") throws -> MockReport {
        try APIDecoding.envelopeData(MockReport.self, from: data(name))
    }

    /// The parity file the web wrote over this draft (shared/fixtures/parity/mock.json).
    public static func parity() throws -> Data {
        try Data(contentsOf: RunFixture.fixtures.appendingPathComponent("parity/mock.json"))
    }
}

/// The mock's API over the recorded draft: the room read answers `opened`, each pick the next of the
/// recorded picks (after an undo, the pick drafted again), each write its recorded answer; with
/// `offline` every call fails with no connection; `refusal` refuses every write with the API's
/// sentence. Records what was sent.
public actor StubMock: MockAPI {
    public private(set) var picks: [(player: String, pick: Int)] = []
    public private(set) var queues: [[String]] = []
    public private(set) var undone: [Int] = []
    public private(set) var autopicks: [Int] = []
    public private(set) var cards = 0
    public private(set) var created: [MockCreate] = []
    private var opened: MockFixture.Answer
    private var next: [MockFixture.Answer] = [.pick1, .pick2, .pick3, .pick4]
    private var offline = false
    private var refusal: String?
    private var cardMissing = false
    private var saved: [SavedLeague] = []
    private let signedOut: Bool

    public init(opened: MockFixture.Answer = .create, signedOut: Bool = false) {
        self.opened = opened
        self.signedOut = signedOut
    }

    public func setOffline(_ offline: Bool) {
        self.offline = offline
    }

    public func setRefusal(_ sentence: String?) {
        refusal = sentence
    }

    /// From now on the card route fails: the turn's call cannot be made.
    public func setCardMissing(_ missing: Bool) {
        cardMissing = missing
    }

    /// The account's saved leagues, as GET /leagues answers them.
    public func setSaved(_ leagues: [SavedLeague]) {
        saved = leagues
    }

    public func leagues() async throws -> [SavedLeague] {
        try fail()
        return saved
    }

    public func setOpened(_ answer: MockFixture.Answer) {
        opened = answer
    }

    public func createMock(_ body: MockCreate) async throws -> MockRoom {
        try fail()
        created.append(body)
        return try MockFixture.room(.create)
    }

    public func mock(id _: String) async throws -> MockRoom {
        try fail()
        return try MockFixture.room(opened)
    }

    public func pick(id _: String, player: String, at pick: Int) async throws -> MockRoom {
        try write()
        picks.append((player, pick))
        let answer = next.isEmpty ? MockFixture.Answer.pickAgain : next.removeFirst()
        return try MockFixture.room(answer)
    }

    public func undo(id _: String, pick: Int) async throws -> MockRoom {
        try write()
        undone.append(pick)
        next = [.pickAgain]
        return try MockFixture.room(.undo)
    }

    public func autopick(id _: String, toRound: Int) async throws -> MockRoom {
        try write()
        autopicks.append(toRound)
        return try MockFixture.room(.autopick)
    }

    public func finish(id _: String) async throws -> MockRoom {
        try write()
        return try MockFixture.room(.finish)
    }

    public func queue(id _: String, players: [String]) async throws -> MockRoom {
        try write()
        queues.append(players)
        return try MockFixture.room(.queue)
    }

    public func card(id _: String) async throws -> RoomCard {
        try fail()
        cards += 1
        if cardMissing {
            throw APIError.status(503)
        }
        return try MockFixture.card()
    }

    public func report(id _: String) async throws -> MockReport {
        try fail()
        return try MockFixture.report()
    }

    public func sharedMock(code _: String) async throws -> MockRoom {
        try fail()
        return try MockFixture.room(opened)
    }

    public func sharedReport(code _: String) async throws -> MockReport {
        try fail()
        return try MockFixture.report("shared-report")
    }

    private func write() throws {
        try fail()
        if let refusal {
            throw APIError.envelope(code: "conflict", message: refusal)
        }
    }

    private func fail() throws {
        if signedOut {
            throw APIError.status(401)
        }
        if offline {
            throw URLError(.notConnectedToInternet)
        }
    }
}
