import CommishAPI
import CommishDesign
import Foundation
import Observation

/// The Trades screen's view model (the League home's pattern): the API, the cache, the clock and the
/// clipboard injected; the saved trades at once, then the API's; the builder is the screen (Lane 260):
/// it opens on our best trade's team with nothing ticked, an idea loads its ticks, a tick or another
/// team posts the check of the trade built, keeping only the latest answer; the verb copies the built
/// trade's offer for the member to propose on the platform and Share copies it as text. A read that
/// fails keeps what is shown, dated by its stamp.
@MainActor
@Observable
public final class TradesViewModel {
    public enum State: Equatable, Sendable {
        case loading
        /// The trades, when their answer was read, and whether that read is older than the latest try.
        case loaded(TradesModel, stamp: Date, stale: Bool)
        case failed(String)
    }

    public private(set) var state: State = .loading
    /// The builder's picks, our best trade's team until the member changes them.
    public private(set) var building: TradePicks?
    /// The builder's check is being read: the last answer stays, quieter.
    public private(set) var checking = false
    /// The line under the verb once pressed.
    public private(set) var builderCopied: CopiedLine?
    /// The line beside Share once pressed.
    public private(set) var shared: String?
    /// Whether the ideas row shows every idea, or the best three and "N more".
    public private(set) var allIdeas = false
    /// The roster drawn where the two stack: the member's first.
    public private(set) var drawn: TradePicks.Side = .give

    private let api: any TradesAPI
    private let cache: any AnswerCache
    private let clock: any Clock
    private let zone: TimeZone
    private let host: Components.Schemas.LeagueHost
    private let me: TradeMe
    private let copy: @MainActor (String) -> Bool
    private let onSignedOut: @MainActor () -> Void
    /// The answer shown.
    private var answer: TradeAdvice?
    private var builderAnswer: TradeCheck?
    /// The picks the last answer was read for (builder.ts Answered).
    private var answeredPicks: TradePicks?
    private var builderProblem: String?
    private var checkAsk = 0
    /// The check being read: a newer tick cancels it, so only the latest is asked of the API.
    private var checkTask: Task<TradeCheck?, any Error>?

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

    /// "Last read Sat 12:00 pm" while the trades shown are a saved read, or a read found no signal.
    public var stampWords: String? {
        guard case let .loaded(_, stamp, true) = state else {
            return nil
        }
        return AppWords.lastRead(stamp, zone: zone)
    }

    /// The builder as its picks and its answer draw it, nil before the trades are read.
    public var builder: TradeBuilderModel? {
        guard let building, let answer, case let .loaded(model, _, _) = state else {
            return nil
        }
        return TradeBuilder.model(.init(
            advice: TradeFinder.held(answer, now: clock.now), ideas: model.ideas, allIdeas: allIdeas,
            picks: building, answer: builderAnswer, answered: answeredPicks, problem: builderProblem, me: me,
            pageKnown: !answer.hostTradesUrl.isEmpty, zone: zone, now: clock.now
        ))
    }

    /// The saved trades at once on the first open, then the API's; a failed read keeps the trades shown,
    /// dated; a refused token signs out. The picks hold across a read again.
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

    /// One tap loads an idea or a host's offer into the ticks; the member changes it freely from there. An
    /// offer the builder cannot hold loads nothing.
    public func load(idea key: String, leagueID: String) async {
        guard case let .loaded(model, _, _) = state,
              let picks = model.ideas.at(clock.now).places.first(where: { $0.id == key })?.picks
        else {
            return
        }
        if picks.team != building?.team {
            forgetAnswer()
        }
        building = picks
        await ask(leagueID: leagueID)
    }

    /// "N more": every idea in place.
    public func showAllIdeas() {
        allIdeas = true
    }

    /// The roster switch: the member's roster or theirs.
    public func show(_ side: TradePicks.Side) {
        drawn = side
    }

    /// Another team: their side starts again, and the last answer, for the last team, goes.
    public func choose(team: Int, leagueID: String) async {
        guard let building else {
            return
        }
        forgetAnswer()
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

    /// The verb: the built trade's offer on the clipboard and the line under it, while the answer is the
    /// picks'. The caller opens the platform's trade page, as the web's verb does.
    public func pressBuilder() {
        guard let (team, check) = liveTrade() else {
            return
        }
        let offer = TradesWords.offer(team: team.name, row: check.trade.value1)
        builderCopied = TradesWords.copied(copy(offer), platform: ValueWords.platform(host))
    }

    /// Share: the built trade as text in our words, and the line beside it.
    public func share() {
        guard let (team, check) = liveTrade() else {
            return
        }
        let text = TradesWords.share(team: team.name, row: check.trade.value1)
        shared = copy(text) ? Words.Analyzer.shared : Words.Trades.copyFailed
    }

    /// The team and the answer the verbs act on: only while the answer is the picks' (proposable).
    private func liveTrade() -> (TradeTeam, TradeCheck)? {
        guard builder?.live == true, let answer, let check = builderAnswer,
              let team = answer.teams.first(where: { $0.rosterId == building?.team })
        else {
            return nil
        }
        return (team, check)
    }

    /// Reads the check for the picks, keeping only the latest answer; the last answer stays, quieter,
    /// while the next is read (TradeBuilder's ask). A newer tick cancels the read before it, and an
    /// answer that still lands after a newer ask is dropped.
    private func ask(leagueID: String) async {
        builderProblem = nil
        builderCopied = nil
        shared = nil
        checkAsk += 1
        let mine = checkAsk
        checkTask?.cancel()
        checkTask = nil
        guard let picks = building, let input = picks.checkInput else {
            forgetAnswer()
            checking = false
            return
        }
        checking = true
        let api = api
        let task = Task { try await api.checkTrade(id: leagueID, trade: input) }
        checkTask = task
        do {
            let answer = try await task.value
            guard mine == checkAsk else {
                return
            }
            builderAnswer = answer
            answeredPicks = answer == nil ? nil : picks
            builderProblem = answer == nil ? Words.InSeason.narrowingUnread : nil
        } catch where APIError.signsOut(error) {
            checking = false
            signOut()
            return
        } catch {
            guard mine == checkAsk else {
                return
            }
            forgetAnswer()
            builderProblem = Self.unread(error)
            markStale(error)
        }
        checking = false
    }

    private func forgetAnswer() {
        builderAnswer = nil
        answeredPicks = nil
    }

    /// Why a check is missing: the API's own sentence where it refused, else the web's line that the last
    /// read stands (state.ts Narrowing).
    static func unread(_ error: any Error) -> String {
        if case let APIError.envelope(_, message) = error, !message.isEmpty {
            return message
        }
        return Words.InSeason.narrowingUnread
    }

    /// A read that found no signal dates the trades shown; an API refusal does not (review L1).
    private func markStale(_ error: any Error) {
        guard !(error is APIError), case let .loaded(model, stamp, _) = state else {
            return
        }
        state = .loaded(model, stamp: stamp, stale: true)
    }

    private func show(_ advice: TradeAdvice, stamp: Date, stale: Bool) {
        answer = advice
        let model = TradesModel(advice: advice, host: host, now: clock.now, zone: zone)
        if building == nil {
            building = model.opening
        }
        state = .loaded(model, stamp: stamp, stale: stale)
    }

    private func signOut() {
        state = .failed(AppWords.Failure.signedOut)
        onSignedOut()
    }
}
