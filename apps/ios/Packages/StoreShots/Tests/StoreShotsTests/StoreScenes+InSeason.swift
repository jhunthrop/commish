import BoxScore
import CommishAPI
import CommishCore
import CommishDesign
import Foundation
@testable import Matchup
@testable import Start
import SwiftUI
@testable import Trades
@testable import Waivers

/// The in-season shots: each screen's view model over the fixtures through a stub of the API, drawn from
/// the screen's own parts as the phone's first screen shows them (the parts each screen's snapshot mock
/// draws: ImageRenderer cannot draw a scroll view).
@MainActor
enum InSeasonScenes {
    /// Saturday noon, the lineup on a platform that takes it: the swaps and the one verb that sets them.
    static func lineup() async throws -> StoreScreen {
        var advice = try StoreFixtures.answer(
            LineupAdvice.self, "lineup-\(StoreFixtures.leagueID)-\(StoreFixtures.saturday).json"
        )
        advice.moves = .init(
            takesWrites: true,
            writesOn: true,
            reason: nil,
            lineup: .init(value1: .available),
            note: nil
        )
        let viewModel = StartViewModel(
            api: StoreLineup(advice: everySlotFilled(advice)), cache: StoreFixtures.cache("lineup"),
            clock: FixedClock(StoreFixtures.instant(StoreFixtures.saturday)), host: StoreFixtures.host,
            zone: StoreFixtures.zone, copy: { _ in true }
        )
        await viewModel.load(leagueID: StoreFixtures.leagueID)
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw StoreSceneError.notLoaded("lineup")
        }
        let rows = RowActions(open: { _ in }, toggleWhy: { _ in }, opened: [])
        return StoreScreen(
            StartPartView(part: .lineup, model: model, stamp: viewModel.stampWords, actions: rows)
                .padding(.top, Tokens.Space.s4),
            pin: PinView(pin: viewModel.pin, actions: PinActions(press: {}, confirm: {}, close: {}))
        )
    }

    /// The first shot shows the lineup working, not a hole (the coordinator's ruling, Lane 255, as the Play
    /// set's StoreScenes.kt): in the fixture the set TE is on his bye and the bench TE is ruled out, so no
    /// one can fill the slot. Here the bench TE is cleared to play and the advice starts him, the bye TE
    /// goes to the bench, as the API answers a playable swap. The store run only; every other line is the
    /// fixture's own.
    static func everySlotFilled(_ advice: LineupAdvice) -> LineupAdvice {
        guard let empty = advice.slots.firstIndex(where: { $0.slot.value1?.rawValue == "TE" && $0.noOneCanPlay }),
              let ruledOut = advice.bench.firstIndex(where: {
                  $0.player.position == "TE" && $0.facts.designation != nil
              })
        else {
            preconditionFailure("The fixture's lineup no longer has the TE hole the store shot fills.")
        }
        var filled = advice
        var playing = advice.bench[ruledOut]
        playing.facts.designation = nil
        filled.bench[ruledOut] = advice.slots[empty].ours
        filled.slots[empty].ours = playing
        filled.slots[empty].changed = true
        filled.slots[empty].noOneCanPlay = false
        return filled
    }

    /// Saturday noon, the wire before it clears on ESPN: the position cards opening on the weakest Need,
    /// the best add first, the claim pinned.
    static func waivers() async throws -> StoreScreen {
        let league = StoreFixtures.pendingClaimLeague
        let advice = try StoreFixtures.answer(WaiverAdvice.self, "waivers-\(league)-\(StoreFixtures.saturday).json")
        let viewModel = WaiverViewModel(
            api: StoreWaivers(advice: advice), cache: StoreFixtures.cache("waivers"),
            clock: FixedClock(StoreFixtures.instant(StoreFixtures.saturday)), host: StoreFixtures.host,
            zone: StoreFixtures.zone, copy: { _ in }
        )
        await viewModel.load(leagueID: league)
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw StoreSceneError.notLoaded("waivers")
        }
        return StoreScreen(
            waiverTop(model, viewModel: viewModel).padding(.top, Tokens.Space.s4),
            pin: WaiverPinView(pin: viewModel.pin, actions: .none, still: true)
        )
    }

    private static func waiverTop(_ model: WaiverModel, viewModel: WaiverViewModel) -> WaiverPartView {
        WaiverPartView(
            part: .top, model: model, stamp: viewModel.stampWords, chosenCard: viewModel.card?.key,
            chooseCard: { _ in },
            actions: TableActions(
                open: { _ in }, tap: { _ in }, chooseDrop: { _ in }, opened: viewModel.openRow,
                drops: viewModel.drops, chosenDrop: viewModel.chosenDrop,
                dropHead: viewModel.opened.map { model.dropHead($0) }, table: viewModel.table,
                sort: viewModel.sort, onSort: { _ in }, reading: viewModel.reading, compare: viewModel.compare,
                empty: viewModel.empty
            ),
            filters: FiltersView(query: viewModel.query, find: { _ in }, problem: viewModel.problem, still: true),
            nav: NavActions(
                cards: viewModel.nav, chosen: viewModel.navKey, mode: viewModel.panelMode,
                hasWeek: viewModel.navHasWeek, lead: viewModel.lead, choose: { _ in }, chooseMode: { _ in },
                still: true
            )
        )
    }

    /// The finder's best idea (the Trades' fixture's `best`), loaded into the builder's ticks.
    static let bestIdea = "8:96>7526+8116"

    /// Saturday noon, the builder with our best idea loaded into its ticks, the verdict's pin over its foot.
    static func trades() async throws -> StoreScreen {
        let league = StoreFixtures.leagueID
        let clock = StoreFixtures.saturday
        let viewModel = try TradesViewModel(
            api: StoreTrades(
                advice: StoreFixtures.answer(TradeAdvice.self, "trades-\(league)-\(clock).json"),
                check: StoreFixtures.answer(TradeCheck.self, "trade-check-\(league)-\(clock)-1.json")
            ),
            cache: StoreFixtures.cache("trades"), clock: FixedClock(StoreFixtures.instant(clock)),
            host: StoreFixtures.host, me: StoreFixtures.me, zone: StoreFixtures.zone, copy: { _ in true }
        )
        await viewModel.load(leagueID: league)
        await viewModel.load(idea: bestIdea, leagueID: league)
        guard case let .loaded(model, _, _) = viewModel.state, let builder = viewModel.builder else {
            throw StoreSceneError.notLoaded("trades")
        }
        let shown = TradesShown(builder: builder, drawn: .give, checking: viewModel.checking)
        return StoreScreen(
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                TradesTop(stamp: viewModel.stampWords, shown: shown, actions: TradeActions(), still: true)
                BuilderBoxView(shown: shown, actions: TradeActions())
            }
            .padding(Tokens.Space.s3),
            pin: BuilderPin(
                builder: builder, verb: model.verb, page: model.page, checking: viewModel.checking, copied: nil,
                shared: nil, actions: TradeActions()
            )
        )
    }

    /// Sunday afternoon, the member's game with its points coming in.
    static func matchup() async throws -> StoreScreen {
        let league = StoreFixtures.leagueID
        let clock = StoreFixtures.sunday
        let viewModel = try MatchupViewModel(
            api: StoreMatchup(
                sync: StoreFixtures.answer(LeagueSync.self, "sync-\(league)-\(clock).json"),
                box: StoreFixtures.answer(MatchupBox.self, "matchup-\(league)-\(clock).json")
            ),
            cache: StoreFixtures.cache("matchup"), clock: FixedClock(StoreFixtures.instant(clock)),
            zone: StoreFixtures.zone, roster: nil
        )
        await viewModel.load(leagueID: league)
        guard case let .loaded(.week(week), _, _) = viewModel.state else {
            throw StoreSceneError.notLoaded("matchup")
        }
        return StoreScreen(
            MatchupPartView(part: .mine, week: week, stamp: viewModel.stampWords, actions: .init(open: { _ in }))
                .padding(.top, Tokens.Space.s4)
        )
    }
}

enum StoreSceneError: Error {
    case notLoaded(String)
}

/// The lineup route as the fixture answers it; a store shot makes no move.
struct StoreLineup: LineupAPI {
    let advice: LineupAdvice

    func lineup(id _: String) async throws -> LineupAdvice {
        advice
    }

    func planMove(id _: String, move _: HostMoveInput) async throws -> HostMovePlan {
        throw URLError(.badServerResponse)
    }

    func makeMove(id _: String, move _: HostMoveInput, confirm _: String) async throws -> HostMoveResult {
        throw URLError(.badServerResponse)
    }
}

/// The waiver read as the fixture answers it, a position's own read as the API answers it (that
/// position's rows: the screen opens on the weakest Need and reads it); a store shot makes no claim.
struct StoreWaivers: WaiversAPI {
    let advice: WaiverAdvice

    func waivers(id _: String, position: WaiverPosition?) async throws -> WaiverAdvice {
        position.map { WaiverNav.atPosition(advice, key: $0.rawValue) } ?? advice
    }

    func planMove(id _: String, move _: HostMoveInput) async throws -> HostMovePlan {
        throw URLError(.badServerResponse)
    }

    func makeMove(id _: String, move _: HostMoveInput, confirm _: String) async throws -> HostMoveResult {
        throw URLError(.badServerResponse)
    }
}

/// The trades and their check as the fixture answers them.
struct StoreTrades: TradesAPI {
    let advice: TradeAdvice
    let check: TradeCheck

    func trades(id _: String, player _: String?) async throws -> TradeAdvice {
        advice
    }

    func checkTrade(id _: String, trade _: TradeCheckInput) async throws -> TradeCheck? {
        check
    }
}

/// The member's league read and box as the fixture answers them at a clock.
struct StoreMatchup: MatchupAPI {
    let sync: LeagueSync
    let box: MatchupBox

    func leagueSync(id _: String) async throws -> LeagueSync {
        sync
    }

    func matchup(id _: String, roster _: Int?) async throws -> MatchupBox? {
        box
    }

    func scoreboard(id _: String) async throws -> Scoreboard {
        throw URLError(.notConnectedToInternet)
    }
}
