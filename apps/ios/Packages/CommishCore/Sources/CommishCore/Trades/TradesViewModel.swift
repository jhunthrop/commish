import CommishAPI
import CommishDesign
import Foundation
import Observation

/// The Trades screen's view model (the League home's pattern): the API, the cache, the clock and the
/// clipboard injected; the saved finder at once, then the API's; each team's best or every trade, by
/// either gain; the trades holding one player, read from the API as the picker narrows; a trade opened
/// into its players; the builder, from a trade or new, posting the check of the trade built as each
/// pick lands and keeping only the latest answer; the verb copies a trade's offer for the member to
/// propose on the platform. A read that fails keeps what is shown, the finder dated by its stamp.
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
    /// The line under each pressed verb, by trade.
    public private(set) var copied: [String: CopiedLine] = [:]
    /// The player the trades are narrowed to (state.ts pickKey), nil for every trade.
    public private(set) var holding: String?
    /// The trades holding him are being read: the last ones stay, quieter.
    public private(set) var narrowing = false
    /// Why the trades holding him could not be read, over the finder.
    public private(set) var problem: String?
    /// The builder's picks while it is open.
    public private(set) var building: TradePicks?
    /// The builder's check is being read: the last answer stays, quieter.
    public private(set) var checking = false
    /// The line under the builder's verb once pressed.
    public private(set) var builderCopied: CopiedLine?

    private let api: any TradesAPI
    private let cache: any AnswerCache
    private let clock: any Clock
    private let zone: TimeZone
    private let host: Components.Schemas.LeagueHost
    private let me: TradeMe
    private let copy: @MainActor (String) -> Bool
    private let onSignedOut: @MainActor () -> Void
    /// The answer shown, so the chips, the order and the picker redraw it.
    private var answer: TradeAdvice?
    /// The trades holding the picked player, as the API answered.
    private var narrowed: TradeAdvice?
    private var narrowAsk = 0
    private var builderAnswer: TradeCheck?
    private var builderProblem: String?
    private var checkAsk = 0

    /// `me` is the member's team and standing as the switch names them; `copy` puts the offer on the
    /// clipboard and says whether it took; `onSignedOut` runs when the API refuses the device token.
    public init(
        api: any TradesAPI, cache: any AnswerCache, clock: any Clock, host: Components.Schemas.LeagueHost,
        me: TradeMe, zone: TimeZone = .current, copy: @escaping @MainActor (String) -> Bool,
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

    /// "Last read Sat 12:00 pm" while the finder shown is a saved one, or a read found no signal.
    public var stampWords: String? {
        guard case let .loaded(_, stamp, true) = state else {
            return nil
        }
        return AppWords.lastRead(stamp, zone: zone)
    }

    /// What the basis speaks to: the builder open, a trade opened, or the finder alone.
    public var shownOpen: TradesOpened {
        building != nil ? .builder : opened.isEmpty ? .none : .trade
    }

    /// The builder as its picks and its answer draw it, nil while it is closed.
    public var builder: TradeBuilderModel? {
        guard let building, let answer else {
            return nil
        }
        return TradeBuilder.model(.init(
            advice: TradeFinder.held(answer, now: clock.now), picks: building, answer: builderAnswer,
            problem: builderProblem, me: me, pageKnown: !answer.hostTradesUrl.isEmpty, zone: zone, now: clock.now
        ))
    }

    /// The saved finder at once on the first open, then the API's; a failed read keeps the finder shown,
    /// dated; a refused token signs out.
    public func load(leagueID: String) async {
        let route = Self.route(leagueID)
        if state == .loading, let saved = await cache.read(TradeAdvice.self, route: route) {
            show(saved.value, stamp: saved.stamp, stale: true)
        }
        do {
            let fresh = try await api.trades(id: leagueID, player: nil)
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

    /// Opens a trade's players under its row, or closes them.
    public func toggle(_ key: String) {
        if opened.contains(key) {
            opened.remove(key)
        } else {
            opened.insert(key)
        }
        redraw()
    }

    /// The Trades holding picker (TradeScreen's pick): every trade again, or the trades holding one
    /// player read from the API; a player our board does not place is in no trade, so nothing is read.
    /// The last rows stay while the next are read, and only the latest choice's answer lands.
    public func pick(_ key: String?, leagueID: String) async {
        holding = key
        narrowed = nil
        problem = nil
        narrowAsk += 1
        let mine = narrowAsk
        guard let key, !key.hasPrefix(TradeFinder.unplaced) else {
            narrowing = false
            redraw()
            return
        }
        narrowing = true
        redraw()
        do {
            let answer = try await api.trades(id: leagueID, player: key)
            guard mine == narrowAsk else {
                return
            }
            narrowed = answer
        } catch where APIError.signsOut(error) {
            signOut()
            return
        } catch {
            guard mine == narrowAsk else {
                return
            }
            problem = Self.unread(error)
            markStale(error)
        }
        narrowing = false
        redraw()
    }

    /// Build a trade: the builder opened on the first team with a trade found.
    public func buildNew() {
        guard case let .loaded(model, _, _) = state else {
            return
        }
        open(model.opening)
    }

    /// Build from this: the builder opened with a finder row's trade, its check read.
    public func build(from key: String, leagueID: String) async {
        guard let picks = line(key)?.built else {
            return
        }
        open(picks)
        await ask(leagueID: leagueID)
    }

    /// Not now: the builder closed.
    public func closeBuilder() {
        building = nil
        builderAnswer = nil
        builderProblem = nil
        builderCopied = nil
        checking = false
        checkAsk += 1
        redraw()
    }

    /// Another team: their side starts again.
    public func choose(team: Int, leagueID: String) async {
        guard let building else {
            return
        }
        self.building = TradePicks(team: team, give: building.give, get: [])
        await ask(leagueID: leagueID)
    }

    /// A tick on a roster's row: picked, or put back; the check asked again.
    public func tap(_ side: TradePicks.Side, player: String, leagueID: String) async {
        guard let building else {
            return
        }
        self.building = building.tapped(side, player)
        await ask(leagueID: leagueID)
    }

    /// The verb on a finder row or a strip card: the trade's offer on the clipboard and the line under
    /// it. The caller opens the platform's trade page, as the web's verb does.
    public func press(_ key: String) {
        guard case let .loaded(model, _, _) = state, let line = line(key) ?? cardLine(key) else {
            return
        }
        copied[key] = TradesWords.copied(copy(line.offer), platform: model.platform)
    }

    /// The builder's verb: the built trade's offer, once its check has answered.
    public func pressBuilder() {
        guard let answer, let check = builderAnswer, let team = answer.teams.first(where: {
            $0.rosterId == building?.team
        }) else {
            return
        }
        let offer = TradesWords.offer(team: team.name, row: check.trade.value1)
        builderCopied = TradesWords.copied(copy(offer), platform: ValueWords.platform(host))
    }

    /// Reads the check for the picks, keeping only the latest answer; the last answer stays, quieter,
    /// while the next is read (TradeBuilder's ask).
    private func ask(leagueID: String) async {
        builderProblem = nil
        builderCopied = nil
        checkAsk += 1
        let mine = checkAsk
        guard let input = building?.checkInput else {
            builderAnswer = nil
            checking = false
            return
        }
        checking = true
        do {
            let answer = try await api.checkTrade(id: leagueID, trade: input)
            guard mine == checkAsk else {
                return
            }
            builderAnswer = answer
            builderProblem = answer == nil ? Words.InSeason.narrowingUnread : nil
        } catch where APIError.signsOut(error) {
            signOut()
            return
        } catch {
            guard mine == checkAsk else {
                return
            }
            builderAnswer = nil
            builderProblem = Self.unread(error)
            markStale(error)
        }
        checking = false
    }

    private func open(_ picks: TradePicks) {
        building = picks
        builderAnswer = nil
        builderProblem = nil
        builderCopied = nil
        redraw()
    }

    /// Why a narrowed read or a check is missing: the API's own sentence where it refused, else the
    /// web's line that the last read stands (state.ts Narrowing).
    static func unread(_ error: any Error) -> String {
        if case let APIError.envelope(_, message) = error, !message.isEmpty {
            return message
        }
        return Words.InSeason.narrowingUnread
    }

    /// A read that found no signal dates the finder shown; an API refusal does not (review L1).
    private func markStale(_ error: any Error) {
        guard !(error is APIError), case let .loaded(model, stamp, _) = state else {
            return
        }
        state = .loaded(model, stamp: stamp, stale: true)
    }

    private func line(_ key: String) -> TradeLine? {
        guard case let .loaded(model, _, _) = state else {
            return nil
        }
        return model.rows.first { $0.id == key }
    }

    /// A strip card's trade where the finder shown no longer lists it (narrowed to a player).
    private func cardLine(_ key: String) -> TradeLine? {
        guard let answer else {
            return nil
        }
        return TradesModel(
            advice: answer, host: host, me: me.name, every: true, sort: sort, now: clock.now, zone: zone
        ).rows.first { $0.id == key }
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
        TradesModel(
            advice: advice, narrowed: narrowed, holding: holding, host: host, me: me.name, every: every, sort: sort,
            now: clock.now, zone: zone
        )
    }

    private func signOut() {
        state = .failed(AppWords.Failure.signedOut)
        onSignedOut()
    }
}
