import CommishAPI
import CommishCore
import LeagueHome
import Matchup
import Start
import SwiftUI
import Trades
import UIKit
import Waivers

/// A league's home: owns its view model for the league it shows; a score bug opens its game; on the
/// followed league's draft day its Advisor verb opens the companion.
struct LeagueScreen: View {
    @State private var viewModel: LeagueHomeViewModel
    private let leagueID: String
    private let openLineup: () -> Void
    private let openGame: (Int?) -> Void
    private let draftDay: DraftDayEntry?
    private let openAdvisor: () -> Void
    private let openMock: () -> Void

    init(
        environment: AppEnvironment,
        leagueID: String,
        league: FollowedLeague?,
        expired: @escaping @MainActor () -> Void,
        openLineup: @escaping () -> Void,
        openGame: @escaping (Int?) -> Void,
        openAdvisor: @escaping () -> Void,
        openMock: @escaping () -> Void
    ) {
        _viewModel = State(initialValue: LeagueHomeViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, onSignedOut: expired
        ))
        self.leagueID = leagueID
        self.openLineup = openLineup
        self.openGame = openGame
        draftDay = league.flatMap {
            DraftDayEntry(phase: $0.phase, draftAt: $0.draftAt, now: environment.clock.now, zone: .current)
        }
        self.openAdvisor = openAdvisor
        self.openMock = openMock
    }

    var body: some View {
        LeagueHomeView(
            viewModel: viewModel, leagueID: leagueID, openLineup: openLineup, openGame: openGame,
            draftDay: draftDay, openAdvisor: openAdvisor, openMock: openMock
        )
    }
}

/// A league's Matchup: owns its view model for the game it shows, the member's (roster nil, the Matchup
/// tab) or another team's by its first side's roster (pushed from its score bug, Lane 206); the view
/// polls while on screen.
struct MatchupTab: View {
    @State private var viewModel: MatchupViewModel
    private let leagueID: String
    private let openLineup: @MainActor @Sendable () -> Void
    private let yourGame: @MainActor () -> Void

    init(
        environment: AppEnvironment, leagueID: String, roster: Int? = nil, expired: @escaping @MainActor () -> Void,
        openLineup: @escaping @MainActor @Sendable () -> Void, yourGame: @escaping @MainActor () -> Void = {}
    ) {
        _viewModel = State(initialValue: MatchupViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, roster: roster,
            onSignedOut: expired
        ))
        self.leagueID = leagueID
        self.openLineup = openLineup
        self.yourGame = yourGame
    }

    var body: some View {
        MatchupView(viewModel: viewModel, leagueID: leagueID, openLineup: openLineup, yourGame: yourGame)
    }
}

/// A league's Start screen: owns its view model for the league it shows; the lineup copied to the
/// system clipboard.
struct LineupScreen: View {
    @State private var viewModel: StartViewModel
    private let leagueID: String

    init(environment: AppEnvironment, league: FollowedLeague, expired: @escaping @MainActor () -> Void) {
        _viewModel = State(initialValue: StartViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, host: league.host,
            copy: { text in
                UIPasteboard.general.string = text
                return true
            },
            onSignedOut: expired
        ))
        leagueID = league.id
    }

    var body: some View {
        StartView(viewModel: viewModel, leagueID: leagueID)
    }
}

/// A league's Trades: owns its view model for the league it shows; the offer copied to the system
/// clipboard, the member's team and standing as the switch names them.
struct TradesTab: View {
    @State private var viewModel: TradesViewModel
    private let leagueID: String

    init(environment: AppEnvironment, league: FollowedLeague, expired: @escaping @MainActor () -> Void) {
        _viewModel = State(initialValue: TradesViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, host: league.host,
            me: TradeMe(league: league),
            copy: { text in
                UIPasteboard.general.string = text
                return true
            },
            onSignedOut: expired
        ))
        leagueID = league.id
    }

    var body: some View {
        TradesView(viewModel: viewModel, leagueID: leagueID)
    }
}

/// A league's Waivers: owns its view model for the league it shows; a name copied to the system
/// clipboard and the platform's waiver page opened where the claim is not made here.
struct WaiversTab: View {
    @State private var viewModel: WaiverViewModel
    private let leagueID: String

    init(environment: AppEnvironment, league: FollowedLeague, expired: @escaping @MainActor () -> Void) {
        _viewModel = State(initialValue: WaiverViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, host: league.host,
            zone: .current,
            copy: { UIPasteboard.general.string = $0 },
            openPage: { UIApplication.shared.open($0) },
            onSignedOut: expired
        ))
        leagueID = league.id
    }

    var body: some View {
        WaiverView(viewModel: viewModel, leagueID: leagueID)
    }
}
