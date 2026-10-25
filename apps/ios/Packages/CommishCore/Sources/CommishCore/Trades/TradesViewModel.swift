import CommishAPI
import CommishDesign
import Foundation
import Observation

/// A trade's check, once its row is opened: being read, answered with both lineups, absent where the
/// API is older than the check, or the sentence of why it could not be read.
public enum TradeCheckState: Equatable, Sendable {
    case reading
    case answered(TradeCheckBug)
    /// An API older than the check: the trade stands without the scoreboard.
    case absent
    case failed(String)
}

/// The Trades screen's view model (the League home's pattern): the API, the cache, the clock and the
/// clipboard injected; the saved finder at once, then the API's; each team's best or every trade, by
/// either gain; a trade opened reads its check once; the verb copies the trade's offer for the member
/// to propose on the platform. A failed read or check keeps the finder shown with its stamp.
@MainActor
@Observable
public final class TradesViewModel {
    public enum State: Equatable, Sendable {
        case loading
        /// The finder, when its answer was read, and whether that read is older than the latest try.
        case loaded(TradesModel, stamp: Date, stale: Bool)
        case failed(String)
    }

    public private(set) var state: State = .loading
    /// Every trade, or each team's best.
    public private(set) var every = false
    public private(set) var sort: TradeSort = .mine
    /// The trades opened, by key.
    public private(set) var opened: Set<String> = []
    public private(set) var checks: [String: TradeCheckState] = [:]
    /// The line under each pressed verb, by trade.
    public private(set) var copied: [String: CopiedLine] = [:]

    private let api: any TradesAPI
    private let cache: any AnswerCache
    private let clock: any Clock
    private let zone: TimeZone
    private let host: Components.Schemas.LeagueHost
    private let me: String
    private let copy: @MainActor (String) -> Bool
    private let onSignedOut: @MainActor () -> Void
    /// The answer shown, so the chips and the order redraw it.
    private var answer: TradeAdvice?

    /// `me` is the member's team as the switch names it; `copy` puts the offer on the clipboard and
    /// says whether it took; `onSignedOut` runs when the API refuses the device token.
    public init(
        api: any TradesAPI, cache: any AnswerCache, clock: any Clock, host: Components.Schemas.LeagueHost,
        me: String, zone: TimeZone = .current, copy: @escaping @MainActor (String) -> Bool,
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.api = api
        self.cache = cache
        self.clock = clock
        self.host = host
        self.me = me
        self.zone = zone
        self.copy = copy
        self.onSignedOut = onSignedOut
    }

    /// The cache key of a league's trades.
    public static func route(_ leagueID: String) -> String {
        "/leagues/attached/\(leagueID)/trades"
    }

    /// "Last read Sat 12:00 pm" while the finder shown is a saved one, or a read or a check failed.
    public var stampWords: String? {
        guard case let .loaded(_, stamp, true) = state else {
            return nil
        }
        return AppWords.lastRead(stamp, zone: zone)
    }

    /// The saved finder at once on the first open, then the API's; a failed read keeps the finder shown,
    /// dated; a refused token signs out.
    public func load(leagueID: String) async {
        let route = Self.route(leagueID)
        if state == .loading, let saved = await cache.read(TradeAdvice.self, route: route) {
            show(saved.value, stamp: saved.stamp, stale: true)
        }
        do {
            let fresh = try await api.trades(id: leagueID)
            let stamp = clock.now
            await cache.write(fresh, route: route, stamp: stamp)
            show(fresh, stamp: stamp, stale: false)
        } catch where APIError.signsOut(error) {
            signOut()
        } catch {
            if case let .loaded(_, stamp, _) = state, let answer {
                show(answer, stamp: stamp, stale: true)
            } else {
                state = .failed(LeagueHomeViewModel.sentence(for: error))
            }
        }
    }

    public func showEvery(_ every: Bool) {
        self.every = every
        redraw()
    }

    public func sort(by sort: TradeSort) {
        self.sort = sort
        redraw()
    }

    /// Opens a trade, reading its check the first time, or closes it.
    public func toggle(_ key: String, leagueID: String) async {
        guard !opened.contains(key) else {
            opened.remove(key)
            return
        }
        opened.insert(key)
        guard needsCheck(key), let line = line(key), let input = line.check else {
            return
        }
        checks[key] = .reading
        do {
            let answer = try await api.checkTrade(id: leagueID, trade: input)
            checks[key] = answer
                .map { .answered(TradeCheckBug($0, me: me, team: line.team, now: clock.now)) } ?? .absent
        } catch where APIError.signsOut(error) {
            checks[key] = nil
            signOut()
        } catch {
            checks[key] = .failed(Self.checkSentence(error))
            if case let .loaded(model, stamp, _) = state {
                state = .loaded(model, stamp: stamp, stale: true)
            }
        }
    }

    /// The verb, on a finder row or a strip card (each card is its team's best row): the trade's offer
    /// on the clipboard and the line under it. The caller opens the platform's trade page, as the web's
    /// verb does.
    public func press(_ key: String) {
        guard case let .loaded(model, _, _) = state, let line = line(key) else {
            return
        }
        copied[key] = TradesWords.copied(copy(line.offer), platform: model.platform)
    }

    /// Why a check is missing: the API's own sentence where it refused the trade, else that it could not
    /// be read just now (the finder shown is kept, so no word about nothing saved).
    static func checkSentence(_ error: any Error) -> String {
        if case let APIError.envelope(_, message) = error, !message.isEmpty {
            return message
        }
        return AppWords.Trades.checkUnread
    }

    /// A trade not checked yet, or whose check failed: opening it reads the check.
    private func needsCheck(_ key: String) -> Bool {
        switch checks[key] {
        case nil, .failed?: true
        default: false
        }
    }

    private func line(_ key: String) -> TradeLine? {
        guard case let .loaded(model, _, _) = state else {
            return nil
        }
        return model.rows.first { $0.id == key }
    }

    private func show(_ advice: TradeAdvice, stamp: Date, stale: Bool) {
        answer = advice
        state = .loaded(model(advice), stamp: stamp, stale: stale)
    }

    private func redraw() {
        guard case let .loaded(_, stamp, stale) = state, let answer else {
            return
        }
        state = .loaded(model(answer), stamp: stamp, stale: stale)
    }

    private func model(_ advice: TradeAdvice) -> TradesModel {
        TradesModel(advice: advice, host: host, me: me, every: every, sort: sort, now: clock.now, zone: zone)
    }

    private func signOut() {
        state = .failed(AppWords.Failure.signedOut)
        onSignedOut()
    }
}
