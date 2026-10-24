import CommishCore
import CommishDesign
import LeagueHome
import SwiftUI

/// The phone's five in season, the web's names and order (web/src/lib/ui/rail-order.ts in_season).
/// Only League is live; the others say their screen's name until their lane lands.
enum Tab: String, CaseIterable, Identifiable {
    case league
    case lineup
    case matchup
    case waivers
    case trades

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .league: AppWords.Tab.league
        case .lineup: AppWords.Tab.lineup
        case .matchup: AppWords.Tab.matchup
        case .waivers: AppWords.Tab.waivers
        case .trades: AppWords.Tab.trades
        }
    }

    var symbol: String {
        switch self {
        case .league: "trophy"
        case .lineup: "list.bullet.rectangle"
        case .matchup: "sportscourt"
        case .waivers: "person.badge.plus"
        case .trades: "arrow.left.arrow.right"
        }
    }
}

struct RootTabs: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var selection = Tab.league
    let environment: AppEnvironment
    let leagueID: String?
    let signOut: () -> Void

    var body: some View {
        TabView(selection: $selection) {
            ForEach(Tab.allCases) { tab in
                NavigationStack { screen(tab) }
                    .tabItem { Label(tab.title, systemImage: tab.symbol) }
                    .tag(tab)
            }
        }
        .tint(Theme(colorScheme).color(Tokens.Color.accent))
    }

    @ViewBuilder
    private func screen(_ tab: Tab) -> some View {
        switch (tab, leagueID) {
        case let (.league, id?):
            LeagueScreen(environment: environment, leagueID: id) { selection = .lineup }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(AppWords.SignIn.signOut, action: signOut)
                    }
                }
        case (.league, nil):
            BasisText(AppWords.LeagueList.none).padding(Tokens.Space.s5)
        default:
            BasisText(tab.title).padding(Tokens.Space.s5).navigationTitle(tab.title)
        }
    }
}

/// The League tab: owns its view model for the league it shows.
private struct LeagueScreen: View {
    @State private var viewModel: LeagueHomeViewModel
    private let leagueID: String
    private let openLineup: () -> Void

    init(environment: AppEnvironment, leagueID: String, openLineup: @escaping () -> Void) {
        _viewModel = State(initialValue: LeagueHomeViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock
        ))
        self.leagueID = leagueID
        self.openLineup = openLineup
    }

    var body: some View {
        LeagueHomeView(viewModel: viewModel, leagueID: leagueID, openLineup: openLineup)
    }
}
