import CommishAPI
import CommishCore
import LeagueHome
import Matchup
import SwiftUI

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
