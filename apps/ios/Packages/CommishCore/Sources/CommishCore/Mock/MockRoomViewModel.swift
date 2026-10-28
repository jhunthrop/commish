import CommishAPI
import CommishDesign
import Foundation
import Observation

/// What the room keeps of a mock: the latest answer, the board read with the first and the turn's
/// card, saved with its stamp so the room opens with no signal.
public struct MockSaved: Codable, Sendable, Equatable {
    public let room: MockRoom
    public let board: RoomBoard
    public let card: RoomCard?
}

/// The solo room's view model (web/src/routes/mock/[id]/+page.svelte): the API, the cache, the clock
/// and the timer injected. The room is rebuilt from each answer the API gives, never from a guess: a
/// pick, an undo, Pick for me, Finish and the queue each answer the room as it stands. One write at a
/// time; the turn's call comes with its answer or from the card route. A read that fails shows the
/// saved room, stale, with its verbs held until a read succeeds; a refused write says the API's
/// sentence and leaves the room as it was; a refused token signs out. The finished draft reads its
/// report.
@MainActor
@Observable
public final class MockRoomViewModel {
    public enum State: Equatable, Sendable {
        case loading
        /// The room at its latest answer; stale while the last read failed and a saved one shows.
        case room(MockRoomModel, stale: Bool)
        /// The draft is over and its report is read.
        case report(DraftReportModel, shareCode: String?, settings: RoomSettings, slot: Int)
        case failed(String)
    }

    /// actions.ts COPIED_MS: how long "Link copied" stays.
    public static let copiedFor: Duration = .seconds(3)

    public private(set) var state: State = .loading
    /// A write the API refused, in its words, until the next write.
    public private(set) var refusal: String?
    /// "Link copied" shows in place of the share verb.
    public private(set) var copied = false
    /// When the room shown was read.
    public private(set) var stamp: Date?

    public let id: String
    private let api: any MockAPI
    private let cache: any AnswerCache
    private let clock: any Clock
    private let timer: any PollTimer
    private let zone: TimeZone
    private let onSignedOut: @MainActor () -> Void
    /// The room as last answered, with its board and the turn's card.
    private(set) var saved: MockSaved?
    private var ui = MockRoomUI()
    private var stale = false
    /// The queue as last set, shown at once until its writes land.
    private var queued: [String]?
    private var queueWrites = 0
    /// Every write runs after the one before it (the web's `write` chain).
    private let chain = WriteChain()

    public init(
        id: String, api: any MockAPI, cache: any AnswerCache, clock: any Clock,
        timer: any PollTimer = SystemPollTimer(), zone: TimeZone = .current,
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.id = id
        self.api = api
        self.cache = cache
        self.clock = clock
        self.timer = timer
        self.zone = zone
        self.onSignedOut = onSignedOut
    }

    /// The room's line while the room shown is a saved one: the room could not be reached, and when it
    /// was read.
    public var staleWords: String? {
        guard case .room(_, true) = state else {
            return nil
        }
        return [Words.Mock.unreachablePhone, stamp.map { AppWords.lastRead($0, zone: zone) }]
            .compactMap(\.self).joined(separator: " ")
    }

    /// Whether a write may go: a room read fresh, and nothing in flight.
    public var canWrite: Bool {
        guard case .room(_, false) = state else {
            return false
        }
        return !ui.busy
    }

    /// The saved room at once on the first open, then the API's.
    public func load() async {
        if state == .loading, let cached = await cache.read(MockSaved.self, route: Self.route(id)) {
            saved = cached.value
            stamp = cached.stamp
            stale = true
            show()
        }
        let generation = chain.generation
        do {
            let fresh = try await api.mock(id: id)
            guard let board = fresh.board?.value1 ?? saved?.board else {
                throw APIError.emptyEnvelope
            }
            guard generation == chain.generation else {
                return
            }
            stale = false
            try await settle(fresh, board: board)
        } catch {
            fail(error, reading: true)
        }
    }

    /// A pull to read the room again: only while nothing is being written, so a read never races a
    /// write (the web has no manual read; this is the way back from a stale room).
    public func refresh() async {
        guard !ui.busy, queueWrites == 0 else {
            return
        }
        await load()
    }

    /// The pool's chip.
    public func choose(filter: String) {
        ui.filter = filter
        show()
    }

    /// A row tapped: marked, its verbs shown; tapped again, let go.
    public func mark(_ player: String) {
        ui.marked = ui.marked == player ? nil : player
        show()
    }

    /// Draft him: the marked row, else our call, else with no call coming the pool's top row; the pick
    /// names the overall pick on the clock, so one made on a stale screen is refused, not misapplied.
    public func draft(_ player: String? = nil) async {
        guard let room = saved?.room, room.waiting, canWrite, let choice = player ?? choice() else {
            return
        }
        ui.marked = nil
        ui.draftedAt = room.pickNumber
        await write { [api, id] in try await api.pick(id: id, player: choice, at: room.pickNumber) }
    }

    /// Undo: your latest pick taken back with every pick after it; the line says where the room went back
    /// to and who is in the pool again.
    public func undo() async {
        guard let saved, let pick = saved.room.picks.last(where: { $0.seat == saved.room.slot })?.pick, canWrite
        else {
            return
        }
        let name = saved.room.picks.first { $0.pick == pick }
            .flatMap { RoomBoardView(saved.board, teams: saved.room.teams).byID[$0.playerId]?.name }
        ui.draftedAt = nil
        await write(after: MockWords.undone(pick, teams: saved.room.teams, name: name)) { [api, id] in
            try await api.undo(id: id, pick: pick)
        }
    }

    /// Pick for me through the bar's round.
    public func autopick() async {
        guard case let .room(model, false) = state, let round = model.bar?.autopickTo, canWrite else {
            return
        }
        ui.draftedAt = nil
        await write { [api, id] in try await api.autopick(id: id, toRound: round) }
    }

    /// Finish the draft: every remaining turn made for you, then the report.
    public func finish() async {
        guard canWrite else {
            return
        }
        ui.draftedAt = nil
        await write { [api, id] in try await api.finish(id: id) }
    }

    /// Queue or let go of a player: shown at once, sent as the whole queue in the write chain, so each
    /// lands in order; a queue write never holds the room busy, so Draft him right after still acts,
    /// after it.
    public func toggleQueue(_ player: String) async {
        guard let saved, case .room(_, false) = state else {
            return
        }
        let drafted = Set(saved.room.picks.map(\.playerId))
        let current = (queued ?? saved.room.queue).filter { !drafted.contains($0) }
        let sending = current.contains(player) ? current.filter { $0 != player } : current + [player]
        queued = sending
        queueWrites += 1
        show()
        await chain.run { [weak self] in
            guard let self else {
                return
            }
            do {
                let answer = try await api.queue(id: id, players: sending)
                try await settle(answer, board: saved.board)
            } catch {
                fail(error, reading: false)
            }
            queueWrites -= 1
            if queueWrites == 0 {
                queued = nil
                repaint()
            }
        }
    }

    /// The link was copied: "Link copied" for a moment.
    public func linkCopied() async {
        copied = true
        try? await timer.sleep(for: Self.copiedFor)
        copied = false
    }

    /// Run it again from the same slot, a new seed: the new room's id.
    public func runAgain() async -> String? {
        guard case let .report(_, _, settings, slot) = state else {
            return nil
        }
        var again = settings
        again.slot = slot
        do {
            return try await api.createMock(MockCreate(leagueId: nil, settings: .init(value1: again), seed: nil)).id
        } catch {
            fail(error, reading: false)
            return nil
        }
    }

    /// The marked row, else our call, else with no call coming the pool's top row.
    private func choice() -> String? {
        guard case let .room(model, _) = state else {
            return nil
        }
        if let marked = ui.marked {
            return marked
        }
        switch model.call {
        case let .call(_, player): return player
        case let .noCall(_, player): return player
        case .reading, nil: return nil
        }
    }

    /// One write: the room busy until its answer lands and the turn's call is read (the web's `act`),
    /// so a second tap can never send a pick for a turn already made.
    private func write(after notice: String? = nil, _ run: @escaping @Sendable () async throws -> MockRoom) async {
        guard let saved, !ui.busy else {
            return
        }
        ui.busy = true
        refusal = nil
        show()
        await chain.run { [weak self] in
            guard let self else {
                return
            }
            defer {
                ui.busy = false
                repaint()
            }
            do {
                let answer = try await run()
                ui.notice = notice
                try await settle(answer, board: saved.board)
            } catch {
                ui.draftedAt = nil
                fail(error, reading: false)
            }
        }
    }

    /// An answer onto the room: the board kept, the card kept for the same turn, else the answer's or
    /// the route's; the finished draft's report.
    private func settle(_ fresh: MockRoom, board: RoomBoard) async throws {
        let samePick = saved?.room.pickNumber == fresh.pickNumber
        var room = fresh
        room.board = nil
        var card = samePick ? saved?.card : nil
        if let answered = fresh.card?.value1, answered.pickNumber == fresh.pickNumber {
            card = answered
        }
        room.card = nil
        ui.callMissing = false
        if !samePick {
            ui.marked = nil
            ui.draftedAt = nil
        }
        if MockRoomModel.status(fresh) == "complete" {
            await keep(MockSaved(room: room, board: board, card: nil))
            try await report(room)
            return
        }
        if card == nil, fresh.waiting {
            card = await readCard(fresh.pickNumber)
        }
        await keep(MockSaved(room: room, board: board, card: card))
        show()
    }

    /// The turn's call from the card route; the room never waits on one that is not coming.
    private func readCard(_ pick: Int) async -> RoomCard? {
        guard let card = try? await api.card(id: id), card.pickNumber == pick else {
            ui.callMissing = true
            return nil
        }
        return card
    }

    private func report(_ room: MockRoom) async throws {
        let report = try await api.report(id: id)
        state = .report(
            DraftReportModel(
                report, names: MockWords.seatNames(teams: report.teams, slot: report.slot),
                seats: Words.Mock.botsByAdp, reshuffled: Words.Mock.reshuffled
            ),
            shareCode: report.shareCode ?? room.shareCode, settings: report.settings, slot: report.slot
        )
    }

    private func keep(_ next: MockSaved) async {
        saved = next
        let now = clock.now
        stamp = now
        await cache.write(next, route: Self.route(id), stamp: now)
    }

    /// The room drawn again, while the room is what shows (never over the report or a sign-out).
    private func repaint() {
        if case .room = state {
            show()
        }
    }

    private func show() {
        guard let saved else {
            return
        }
        var room = saved.room
        if let queued {
            room.queue = queued
        }
        let board = RoomBoardView(saved.board, teams: room.teams)
        let drafted = Set(room.picks.map(\.playerId))
        if room.waiting,
           let view = saved.card.flatMap({ CallView($0, board: board, drafted: drafted, teams: room.teams) }) {
            ui.lastCall = view
        }
        let model = MockRoomModel(room: room, board: board, card: saved.card, ui: ui)
        state = .room(model, stale: stale)
    }

    private func fail(_ error: any Error, reading: Bool) {
        if APIError.signsOut(error) {
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
            return
        }
        if error is CancellationError || Task.isCancelled {
            return
        }
        guard reading else {
            refusal = Self.sentence(for: error)
            show()
            return
        }
        if saved != nil {
            stale = true
            show()
        } else {
            state = .failed(Self.sentence(for: error))
        }
    }
}
