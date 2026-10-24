import CommishAPI
import Foundation
import Observation

/// The pattern every screen copies: a view model that takes the API, the cache and the clock, holds
/// the screen's state, and leaves the view nothing to decide.
@MainActor
@Observable
public final class LeagueHomeViewModel {
    public enum State: Equatable, Sendable {
        case loading
        /// The home, when its answer was read, and whether that read is older than this open (the
        /// saved one, shown at once or because the latest read failed).
        case loaded(LeagueHomeModel, stamp: Date, stale: Bool)
        /// Nothing to show: the API's own sentence, or the app's, never an error code.
        case failed(String)
    }

    public private(set) var state: State = .loading

    private let api: any LeagueAPI
    private let cache: any AnswerCache
    private let clock: any Clock
    private let zone: TimeZone

    public init(api: any LeagueAPI, cache: any AnswerCache, clock: any Clock, zone: TimeZone = .current) {
        self.api = api
        self.cache = cache
        self.clock = clock
        self.zone = zone
    }

    /// The cache key of a league's home.
    public static func route(_ leagueID: String) -> String {
        "/leagues/attached/\(leagueID)/home"
    }

    /// "Last read Sun 3:05 pm" while the home shown is a saved one, as the web stamps a failed read.
    public var stampWords: String? {
        guard case let .loaded(_, stamp, true) = state else {
            return nil
        }
        return "\(AppWords.lastRead) \(Formatting.weekdayTime(stamp, zone: zone))"
    }

    /// The saved home at once when there is one, then the API's; the saved one stays, dated, when the
    /// read fails.
    public func load(leagueID: String) async {
        let route = Self.route(leagueID)
        let saved = await cache.read(LeagueHomeAnswer.self, route: route)
        if let saved {
            state = .loaded(model(saved.value), stamp: saved.stamp, stale: true)
        }
        do {
            let answer = try await read(leagueID)
            let stamp = clock.now
            await cache.write(answer, route: route, stamp: stamp)
            state = .loaded(model(answer), stamp: stamp, stale: false)
        } catch {
            if saved == nil {
                state = .failed(Self.sentence(for: error))
            }
        }
    }

    /// The league must read; its scoreboard may fail (a week not started on some platforms) and the
    /// home then shows the standings and the moves without the week's games.
    private func read(_ leagueID: String) async throws -> LeagueHomeAnswer {
        async let board = try? api.scoreboard(id: leagueID)
        let sync = try await api.leagueSync(id: leagueID)
        return await LeagueHomeAnswer(sync: sync, scoreboard: board)
    }

    private func model(_ answer: LeagueHomeAnswer) -> LeagueHomeModel {
        LeagueHomeModel(sync: answer.sync, scoreboard: answer.scoreboard, now: clock.now, zone: zone)
    }

    static func sentence(for error: any Error) -> String {
        switch error {
        case APIError.envelope(code: "unauthorized", _), APIError.status(401):
            AppWords.Failure.signedOut
        case let APIError.envelope(_, message) where !message.isEmpty:
            message
        case is URLError:
            AppWords.Failure.offline
        default:
            AppWords.Failure.unknown
        }
    }
}
