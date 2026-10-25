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

/// What the Matchup reads and keeps: the league read and the box score, saved together with their stamp.
public struct MatchupAnswer: Codable, Sendable, Equatable {
    public let sync: LeagueSync
    public let box: MatchupBox?
}

/// The Matchup screen's view model (the League home's pattern): the API, the cache, the clock and the
/// poll's timer injected; the saved week at once, then the API's; while the screen is visible it reads
/// again on the web's cadence (model.ts POLL_MS, once a minute) and stops the moment it is hidden or
/// the app leaves the foreground. A read that fails keeps the week shown with its stamp, never blank.
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
    private let onSignedOut: @MainActor () -> Void
    private var poll: Task<Void, Never>?
    private var signedOut = false

    public init(
        api: any MatchupAPI, cache: any AnswerCache, clock: any Clock, timer: any PollTimer = SystemPollTimer(),
        zone: TimeZone = .current, onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.api = api
        self.cache = cache
        self.clock = clock
        self.timer = timer
        self.zone = zone
        self.onSignedOut = onSignedOut
    }

    /// The cache key of a league's matchup.
    public static func route(_ leagueID: String) -> String {
        "/leagues/attached/\(leagueID)/matchup"
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
        poll = Task { [weak self] in
            await self?.run(leagueID: leagueID)
        }
    }

    /// The saved week at once on the first open, then the API's; a failed read keeps the week shown,
    /// dated; a refused token signs out.
    public func load(leagueID: String) async {
        let route = Self.route(leagueID)
        if state == .loading, let saved = await cache.read(MatchupAnswer.self, route: route) {
            state = .loaded(model(saved.value), stamp: saved.stamp, stale: true)
        }
        do {
            let answer = try await read(leagueID)
            let stamp = clock.now
            await cache.write(answer, route: route, stamp: stamp)
            state = .loaded(model(answer), stamp: stamp, stale: false)
        } catch where APIError.signsOut(error) {
            signedOut = true
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
        } catch where error is CancellationError || Task.isCancelled {
            // Hidden while the read was on its way: the week shown stays as it was.
            return
        } catch {
            if case let .loaded(week, stamp, _) = state {
                state = .loaded(week, stamp: stamp, stale: true)
            } else {
                state = .failed(LeagueHomeViewModel.sentence(for: error))
            }
        }
    }

    /// Reads, then waits the interval, until hidden (the task cancelled) or signed out.
    private func run(leagueID: String) async {
        while !Task.isCancelled {
            await load(leagueID: leagueID)
            guard !signedOut else {
                polling = false
                return
            }
            do {
                try await timer.sleep(for: Self.pollInterval)
            } catch {
                return
            }
        }
    }

    /// Both reads at once, as the web's Promise.all: the box where the API has one for the league.
    private func read(_ leagueID: String) async throws -> MatchupAnswer {
        async let box = api.matchup(id: leagueID)
        let sync = try await api.leagueSync(id: leagueID)
        return try await MatchupAnswer(sync: sync, box: box)
    }

    private func model(_ answer: MatchupAnswer) -> MatchupModel {
        MatchupModel(sync: answer.sync, box: answer.box, clock: clock.now, zone: zone)
    }
}
