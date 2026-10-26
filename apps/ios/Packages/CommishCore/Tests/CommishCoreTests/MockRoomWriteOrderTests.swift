import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The room's writes run one after another as the web's do: a pick tapped while the queue's write is
/// on its way is sent after that answer lands, so the last answer painted is the pick's; a read begun
/// before a write never repaints over it; and the room stays busy until the next turn's call is read,
/// so a second Draft him in that moment sends nothing.
@MainActor
struct MockRoomWriteOrderTests {
    @Test func aPickWaitsForTheQueuesWriteAndItsAnswerIsTheLastPainted() async throws {
        let api = GatedMock(StubMock())
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        await api.hold("queue")
        let player = try #require(try MockFixture.room(.queue).queue.first)
        let queueing = Task { await viewModel.toggleQueue(player) }
        await api.reached("queue")
        let drafting = Task { await viewModel.draft() }
        await Task.yield()
        let whileHeld = await api.writes
        #expect(whileHeld == ["queue"])
        await api.release("queue")
        await queueing.value
        await drafting.value
        let after = await api.writes
        #expect(after == ["queue", "pick"])
        guard case let .room(model, _) = viewModel.state else {
            Issue.record("no room")
            return
        }
        #expect(try model.room.pickNumber == MockFixture.room(.pick1).pickNumber)
    }

    @Test func aReadBegunBeforeAWriteNeverRepaintsOverItsAnswer() async throws {
        let api = GatedMock(StubMock())
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        await api.hold("mock")
        let reading = Task { await viewModel.refresh() }
        await api.reached("mock")
        await viewModel.draft()
        await api.release("mock")
        await reading.value
        guard case let .room(model, _) = viewModel.state else {
            Issue.record("no room")
            return
        }
        #expect(try model.room.pickNumber == MockFixture.room(.pick1).pickNumber)
    }

    @Test func aSecondDraftWhileTheNextCallIsReadSendsNothing() async {
        let api = GatedMock(StubMock(), pickWithoutCard: true)
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        await api.hold("card")
        let first = Task { await viewModel.draft() }
        await api.reached("card")
        #expect(!viewModel.canWrite)
        await viewModel.draft()
        await api.release("card")
        await first.value
        #expect(await api.calls.filter { $0 == "pick" }.count == 1)
        #expect(viewModel.canWrite)
    }

    static func viewModel(_ api: GatedMock) -> MockRoomViewModel {
        MockRoomViewModel(
            id: MockFixture.id, api: api, cache: MockParityTests.cache(), clock: MockParityTests.clock,
            zone: TimeZone(identifier: "America/Chicago")!
        )
    }
}

/// The recorded mock's API with calls that can be held until released: `reached` returns once a held
/// call is waiting. Records the order calls arrived; `pickWithoutCard` answers picks without the next
/// turn's card, so the room reads it from the card route.
actor GatedMock: MockAPI {
    private let base: StubMock
    private let pickWithoutCard: Bool
    private var held: Set<String> = []
    private var parked: [String: CheckedContinuation<Void, Never>] = [:]
    private var arrivals: [String: CheckedContinuation<Void, Never>] = [:]
    private(set) var calls: [String] = []

    /// The writes, in the order they reached the API.
    var writes: [String] {
        calls.filter { $0 == "queue" || $0 == "pick" }
    }

    init(_ base: StubMock, pickWithoutCard: Bool = false) {
        self.base = base
        self.pickWithoutCard = pickWithoutCard
    }

    func hold(_ name: String) {
        held.insert(name)
    }

    func release(_ name: String) {
        held.remove(name)
        parked.removeValue(forKey: name)?.resume()
    }

    func reached(_ name: String) async {
        guard parked[name] == nil else {
            return
        }
        await withCheckedContinuation { arrivals[name] = $0 }
    }

    private func pass(_ name: String) async {
        calls.append(name)
        guard held.contains(name) else {
            return
        }
        await withCheckedContinuation { continuation in
            parked[name] = continuation
            arrivals.removeValue(forKey: name)?.resume()
        }
    }

    func createMock(_ body: MockCreate) async throws -> MockRoom {
        try await base.createMock(body)
    }

    func mock(id: String) async throws -> MockRoom {
        await pass("mock")
        return try await base.mock(id: id)
    }

    func pick(id: String, player: String, at pick: Int) async throws -> MockRoom {
        await pass("pick")
        var answer = try await base.pick(id: id, player: player, at: pick)
        if pickWithoutCard {
            answer.card = nil
        }
        return answer
    }

    func undo(id: String, pick: Int) async throws -> MockRoom {
        try await base.undo(id: id, pick: pick)
    }

    func autopick(id: String, toRound: Int) async throws -> MockRoom {
        try await base.autopick(id: id, toRound: toRound)
    }

    func finish(id: String) async throws -> MockRoom {
        try await base.finish(id: id)
    }

    func queue(id: String, players: [String]) async throws -> MockRoom {
        await pass("queue")
        return try await base.queue(id: id, players: players)
    }

    func card(id: String) async throws -> RoomCard {
        await pass("card")
        return try await base.card(id: id)
    }

    func report(id: String) async throws -> MockReport {
        try await base.report(id: id)
    }

    func sharedMock(code: String) async throws -> MockRoom {
        try await base.sharedMock(code: code)
    }

    func sharedReport(code: String) async throws -> MockReport {
        try await base.sharedReport(code: code)
    }

    func leagues() async throws -> [SavedLeague] {
        try await base.leagues()
    }
}

/// What the view model's `copied` read while the "Link copied" moment ran.
@MainActor
final class CopiedProbe {
    weak var viewModel: MockRoomViewModel?
    private(set) var during: [Bool] = []

    func look() {
        during.append(viewModel?.copied ?? false)
    }
}

/// A wait that looks at the view model while it waits, then returns at once.
struct ProbeTimer: PollTimer {
    let probe: @Sendable () async -> Void

    func sleep(for _: Duration) async throws {
        await probe()
    }
}
