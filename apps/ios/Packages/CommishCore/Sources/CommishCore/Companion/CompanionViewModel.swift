import CommishAPI
import CommishDesign
import Foundation
import Observation

/// What the companion keeps of a followed draft: the latest answer, the picks held across reads and the
/// board read with the first, and the report once the draft is over, saved with its stamp so the
/// screen opens with no signal.
public struct CompanionAnswer: Codable, Sendable, Equatable {
    public let companion: Companion
    public let picks: [CompanionPick]
    public let board: RoomBoard
    public let report: MockReport?
    /// How many name-matched picks the drafter was told of.
    public let seen: Int
}

/// The followed draft's view model (CompanionPage.svelte): the API, the cache, the clock and the
/// poll's timer injected. The first read asks from pick 0 and takes the board; every later one names
/// the pick count held and merges the picks after it (model.ts mergePicks). While the screen is visible
/// it reads on the web's cadence, every three seconds (model.ts POLL_MS, never faster), until the
/// platform says the draft is over (CompanionPage's loop stops at complete, lost or not), and then
/// reads the report once when the draft was not lost; a report read that fails keeps the room with the
/// reconnecting line and is not tried again, as the web's. A failed draft read keeps the last picks on
/// screen with their stamp and the web's reconnecting line and the poll goes on; a refused token signs
/// out; a draft the account does not hold says so and stops. Every read, the poll's or a pull's, is the
/// one in flight: a pull while one runs waits on it, and a pull within the interval of the last read
/// finds it fresh enough.
@MainActor
@Observable
public final class CompanionViewModel {
    public enum Failure: Equatable, Sendable {
        case signedOut
        /// Not on this account (a 404): follow it again.
        case missing
        /// Never read and nothing saved.
        case unreachable
    }

    public enum State: Equatable, Sendable {
        case loading
        /// The draft at its latest read; stale while the last read failed or the screen shows a saved one.
        case room(CompanionModel, stale: Bool)
        /// The draft is over and its report is read.
        case report(DraftReportModel, bar: CompanionBar)
        case failed(Failure)
    }

    /// model.ts POLL_MS: the API reads the platform at most once every two seconds per draft, so three
    /// is the web's cadence and the app's.
    public static let pollSeconds = 3
    public static let pollInterval: Duration = .seconds(pollSeconds)

    public private(set) var state: State = .loading
    /// The pool's chip.
    public private(set) var filter = "All"
    public private(set) var polling = false
    /// When the picks shown were read.
    public private(set) var stamp: Date?

    public let id: String
    private let api: any CompanionAPI
    private let cache: any AnswerCache
    private let clock: any Clock
    private let timer: any PollTimer
    private let zone: TimeZone
    private let onSignedOut: @MainActor () -> Void
    private var answer: CompanionAnswer?
    /// Whether this view model has read the API yet: the first read asks from pick 0, for the board.
    private var hasRead = false
    private var poll: Task<Void, Never>?
    /// The read in flight, which every caller waits on rather than starting another.
    private var inFlight: Task<Void, Never>?
    /// When the last read finished, on the injected clock.
    private var lastRead: Date?

    public init(
        id: String, api: any CompanionAPI, cache: any AnswerCache, clock: any Clock,
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

    /// The cache key of a followed draft.
    public static func route(_ id: String) -> String {
        "/companions/\(id)"
    }

    /// "Last read 2:14 pm" beside the reconnecting line while the picks shown are not the latest.
    public var stampWords: String? {
        guard case let .room(_, true) = state, let stamp else {
            return nil
        }
        return AppWords.lastRead(stamp, zone: zone)
    }

    /// Whether the poll has more to read: not once the platform says the draft is over (its report
    /// read, refused, or never built for a draft the engine lost), nor after a refusal that ends the
    /// screen.
    public var done: Bool {
        switch state {
        case .report, .failed: true
        case .loading: false
        case .room: answer.map { CompanionWords.status($0.companion.status) == "complete" } ?? false
        }
    }

    /// The pool's chip: the rows under it from the picks held, no read.
    public func choose(filter: String) {
        guard RoomDraft.filters.contains(filter), filter != self.filter else {
            return
        }
        self.filter = filter
        if case let .room(_, stale) = state, let answer {
            state = .room(model(answer), stale: stale)
        }
    }

    /// The visibility signal: visible reads at once and then every interval until the draft is done;
    /// hidden stops the poll. Saying the same twice changes nothing.
    public func setVisible(_ visible: Bool) {
        guard visible != polling else {
            return
        }
        polling = visible
        poll?.cancel()
        poll = nil
        guard visible else {
            return
        }
        let timer = timer
        // Held weakly between passes: the loop takes the view model only for a read, so a view model
        // dropped with its screen ends the loop after its sleep (onDisappear cancels it before that).
        poll = Task { [weak self] in
            while !Task.isCancelled {
                guard let finished = await self?.pass(), !finished else {
                    self?.polling = false
                    return
                }
                do {
                    try await timer.sleep(for: Self.pollInterval)
                } catch {
                    return
                }
            }
        }
    }

    /// The poll's one pass: the read, then whether the poll is done.
    private func pass() async -> Bool {
        await load()
        return done
    }

    /// A pull to refresh: the read in flight if there is one, nothing within the interval of the last
    /// read or once the draft is done, else one read. Never faster than the poll.
    public func refresh() async {
        if let inFlight {
            await inFlight.value
            return
        }
        if done {
            return
        }
        if let lastRead, clock.now.timeIntervalSince(lastRead) < TimeInterval(Self.pollSeconds) {
            return
        }
        await load()
    }

    /// One read, shared: a caller while a read runs waits on that read; a cancelled caller cancels it.
    public func load() async {
        if let inFlight {
            await inFlight.value
            return
        }
        let task = Task { await self.read() }
        inFlight = task
        await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }
        inFlight = nil
        lastRead = clock.now
    }

    /// The read: the saved draft at once on the first open, then the API's since the picks held, and
    /// the report once the draft is over and was not lost.
    private func read() async {
        if state == .loading, let saved = await cache.read(CompanionAnswer.self, route: Self.route(id)) {
            answer = saved.value
            stamp = saved.stamp
            show(saved.value, stale: true)
        }
        do {
            let since = hasRead ? answer?.companion.pickCount ?? 0 : 0
            let fresh = try await api.companion(id: id, since: since)
            hasRead = true
            let next = try merged(fresh)
            await keep(next)
            if CompanionWords.status(fresh.status) == "complete", fresh.lostAt == nil, next.report == nil {
                try await keep(CompanionAnswer(
                    companion: next.companion, picks: next.picks, board: next.board,
                    report: api.companionReport(id: id), seen: next.seen
                ))
            }
        } catch where APIError.signsOut(error) {
            state = .failed(.signedOut)
            onSignedOut()
        } catch APIError.envelope(code: "not_found", message: _) {
            state = .failed(.missing)
        } catch where error is CancellationError || Task.isCancelled {
            return
        } catch {
            if let answer {
                show(answer, stale: true)
            } else {
                state = .failed(.unreachable)
            }
        }
    }

    /// A fresh answer kept, saved with its stamp and shown.
    private func keep(_ next: CompanionAnswer) async {
        let now = clock.now
        answer = next
        stamp = now
        await cache.write(next, route: Self.route(id), stamp: now)
        show(next, stale: false)
    }

    /// The answer onto what is held: the board kept from the first read, the picks merged after the
    /// answer's since, and the name-matched picks told so far (CompanionRoom's namedSeen).
    private func merged(_ fresh: Companion) throws -> CompanionAnswer {
        guard let board = fresh.board?.value1 ?? answer?.board else {
            throw APIError.emptyEnvelope
        }
        let held = (answer?.picks ?? []).filter { $0.pick <= fresh.since }
        let previous = answer?.companion
        let seen = previous.map { $0.yourTurn ? answer?.seen ?? 0 : $0.placedByName.count } ?? 0
        let report = CompanionWords.status(fresh.status) == "complete" ? answer?.report : nil
        var companion = fresh
        companion.board = nil
        return CompanionAnswer(
            companion: companion,
            picks: held + fresh.picks,
            board: board,
            report: report,
            seen: seen
        )
    }

    private func show(_ answer: CompanionAnswer, stale: Bool) {
        let model = model(answer)
        if let report = answer.report {
            state = .report(
                DraftReportModel(
                    report, names: model.names, seats: CompanionWords.leagueOn(answer.companion.host),
                    reshuffled: Words.Companion.reshuffled
                ),
                bar: model.bar
            )
        } else {
            state = .room(model, stale: stale)
        }
    }

    private func model(_ answer: CompanionAnswer) -> CompanionModel {
        CompanionModel(
            companion: answer.companion, picks: answer.picks,
            board: RoomBoardView(answer.board, teams: answer.companion.teams), seen: answer.seen, filter: filter
        )
    }
}
