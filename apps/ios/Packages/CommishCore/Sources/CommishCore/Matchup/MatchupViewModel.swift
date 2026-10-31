import CommishAPI
import CommishDesign
import Foundation
import Observation

/// The wait between two reads of a live screen: the system's sleep in the app, a hand-driven one in a
/// test, so the cadence is tested without waiting a minute.
public protocol PollTimer: Sendable {
    /// Returns after `interval`, or throws once the task waiting on it is cancelled.
    func sleep(for interval: Duration) async throws
}

public struct SystemPollTimer: PollTimer {
    public init() {}

    public func sleep(for interval: Duration) async throws {
        try await Task.sleep(for: interval)
    }
}

/// What the Matchup reads and keeps: the league read, the box score and, for another team's game, the
/// scoreboard its score is read from; saved together with their stamp.
public struct MatchupAnswer: Codable, Sendable, Equatable {
    public let sync: LeagueSync
    public let box: MatchupBox?
    /// The week's scoreboard, read for another team's game only; nil where it was not read.
    public let board: Scoreboard?

    public init(sync: LeagueSync, box: MatchupBox?, board: Scoreboard? = nil) {
        self.sync = sync
        self.box = box
        self.board = board
    }
}

/// The Matchup screen's view model (the League home's pattern): the API, the cache, the clock and the
/// poll's timer injected; the game the member's (`roster` nil) or the one a score bug's roster plays
/// in (Lane 206), each kept under its own key; the saved week at once, then the API's; while the
/// screen is visible it reads again on the web's cadence (model.ts POLL_MS, once a minute) and stops
/// the moment it is hidden or the app leaves the foreground. A read that fails keeps the week shown
/// with its stamp, never blank.
@MainActor
@Observable
public final class MatchupViewModel {
    public enum State: Equatable, Sendable {
        case loading
        /// The week, when its answer was read, and whether that read is older than the latest try.
        case loaded(MatchupModel, stamp: Date, stale: Bool)
        case failed(String)
    }

    /// The web's cadence (web/src/lib/league/model.ts POLL_MS): the API reads the platform at most once
    /// a minute whatever the number of viewers, so a faster poll would only see the same read.
    public static let pollInterval: Duration = .seconds(60)

    public private(set) var state: State = .loading
    /// The poll runs: the screen is on screen and the app in the foreground.
    public private(set) var polling = false

    private let api: any MatchupAPI
    private let cache: any AnswerCache
    private let clock: any Clock
    private let timer: any PollTimer
    private let zone: TimeZone
    /// The game's first side, a score bug's (Lane 204's `?roster=`); nil for the member's own game.
    private let roster: Int?
    private let onSignedOut: @MainActor () -> Void
    /// The platform's words: the league's own, or the store graphics' neutral one (Lane 310). Nil: the league's own.
    private let words: HostWords?
    private var poll: Task<Void, Never>?
    private var signedOut = false
    /// The answer shown, so a failed read redraws it at the clock it failed at.
    private var answer: MatchupAnswer?

    public init(
        api: any MatchupAPI, cache: any AnswerCache, clock: any Clock, timer: any PollTimer = SystemPollTimer(),
        zone: TimeZone = .current, roster: Int? = nil, onSignedOut: @escaping @MainActor () -> Void = {},
        words: HostWords? = nil
    ) {
        self.words = words
        self.roster = roster
        self.api = api
        self.cache = cache
        self.clock = clock
        self.timer = timer
        self.zone = zone
        self.onSignedOut = onSignedOut
    }

    /// The cache key of a league's matchup: the member's game, or another team's by its roster, so
    /// going back and forth between games never shows one game's saved box under another.
    public static func route(_ leagueID: String, roster: Int? = nil) -> String {
        let base = "/leagues/attached/\(leagueID)/matchup"
        return roster.map { "\(base)?roster=\($0)" } ?? base
    }

    /// "Last read Sun 1:52 pm" while the week shown is a saved one or the latest read failed.
    public var stampWords: String? {
        guard case let .loaded(_, stamp, true) = state else {
            return nil
        }
        return "\(AppWords.lastRead) \(Formatting.weekdayTime(stamp, zone: zone))"
    }

    /// The visibility signal: true while the screen is on screen with the app in the foreground. Visible
    /// reads at once and then every interval; hidden stops the poll, so nothing is read in the
    /// background. Saying the same twice changes nothing.
    public func setVisible(_ visible: Bool, leagueID: String) {
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
        // The loop holds the view model weakly: it takes it for each read alone, so a view model
        // dropped with its screen (a league switched, a tab the bar no longer shows) stops the poll at
        // its next pass even if nothing said hidden.
        poll = Task { [weak self] in
            while !Task.isCancelled {
                guard await Self.pass(self, leagueID: leagueID) else {
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

    /// The saved week at once on the first open, then the API's; a failed read keeps the week shown,
    /// dated; a refused token signs out.
    public func load(leagueID: String) async {
        let route = Self.route(leagueID, roster: roster)
        if state == .loading, let saved = await cache.read(MatchupAnswer.self, route: route) {
            answer = saved.value
            state = .loaded(model(saved.value), stamp: saved.stamp, stale: true)
        }
        do {
            let fresh = try await read(leagueID)
            let stamp = clock.now
            await cache.write(fresh, route: route, stamp: stamp)
            answer = fresh
            state = .loaded(model(fresh), stamp: stamp, stale: false)
        } catch where APIError.signsOut(error) {
            signedOut = true
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
        } catch where error is CancellationError || Task.isCancelled {
            // Hidden while the read was on its way: the week shown stays as it was.
            return
        } catch {
            if case let .loaded(week, stamp, _) = state {
                // The week as read, its live read cell aged to now, dated by its stamp.
                state = .loaded(answer.map(model) ?? week, stamp: stamp, stale: true)
            } else {
                state = .failed(LeagueHomeViewModel.sentence(for: error))
            }
        }
    }

    /// One pass of the poll: a read, and whether to go on (not once the view model is gone or the
    /// token was refused).
    private static func pass(_ viewModel: MatchupViewModel?, leagueID: String) async -> Bool {
        guard let viewModel else {
            return false
        }
        await viewModel.load(leagueID: leagueID)
        guard !viewModel.signedOut else {
            viewModel.polling = false
            return false
        }
        return true
    }

    /// The reads at once, as the web's Promise.all: the box where the API has one for the league; for
    /// another team's game the scoreboard too, whose failure never fails the box that arrived (review
    /// 204 M1): the score then reads as unread.
    private func read(_ leagueID: String) async throws -> MatchupAnswer {
        async let box = api.matchup(id: leagueID, roster: roster)
        async let board = roster == nil ? nil : try? api.scoreboard(id: leagueID)
        let sync = try await api.leagueSync(id: leagueID)
        return try await MatchupAnswer(sync: sync, box: box, board: board)
    }

    private func model(_ answer: MatchupAnswer) -> MatchupModel {
        MatchupModel(
            sync: answer.sync,
            box: answer.box,
            board: answer.board,
            clock: clock.now,
            zone: zone,
            words: words
        )
    }
}
