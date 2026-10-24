import CommishAPI
import CommishCore
import CommishDesign
import LeagueHome
import SwiftUI

/// The phone's five, the web's bar for the league's phase (PhoneRail, held to rail-order.ts). Only
/// League is live; the others say their screen's name until their lane lands.
struct RootTabs: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var selection = "league"
    let environment: AppEnvironment
    let league: FollowedLeague?
    let tabs: [RailTab]
    let signOut: () -> Void
    /// The API refused the token on a signed-in read: the app signs out and shows sign-in.
    let expired: () -> Void

    var body: some View {
        TabView(selection: $selection) {
            ForEach(tabs) { tab in
                NavigationStack { screen(tab) }
                    .tabItem { Label(tab.label, systemImage: Self.symbol(tab.key)) }
                    .tag(tab.key)
            }
        }
        .tint(Theme(colorScheme).color(Tokens.Color.accent))
    }

    @ViewBuilder
    private func screen(_ tab: RailTab) -> some View {
        switch (tab.key, league) {
        case let ("league", league?):
            LeagueScreen(environment: environment, leagueID: league.id, expired: expired) { selection = "lineup" }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(AppWords.SignIn.signOut, action: signOut)
                    }
                }
        case ("league", nil):
            BasisText(AppWords.LeagueList.none).padding(Tokens.Space.s5)
        default:
            BasisText(tab.label).padding(Tokens.Space.s5).navigationTitle(tab.label)
        }
    }

    /// The tabs' glyphs, by the web's rail key (web/src/lib/ui/rail-icons.ts names the same items).
    static let symbols: [String: String] = [
        "league": "trophy", "lineup": "list.bullet.rectangle", "matchup": "sportscourt",
        "waivers": "person.badge.plus", "trades": "arrow.left.arrow.right",
        "board": "square.grid.3x3", "rest_first": "square.grid.3x3",
        "players": "person.2", "week": "person.2",
        "mock": "timer", "mock_late": "timer", "sheet": "doc.text",
        "advisor": "lightbulb", "advisor_first": "lightbulb", "record": "checkmark.seal",
    ]

    static func symbol(_ key: String) -> String {
        symbols[key] ?? "circle"
    }
}

/// The League tab: owns its view model for the league it shows.
private struct LeagueScreen: View {
    @State private var viewModel: LeagueHomeViewModel
    private let leagueID: String
    private let openLineup: () -> Void

    init(
        environment: AppEnvironment,
        leagueID: String,
        expired: @escaping () -> Void,
        openLineup: @escaping () -> Void
    ) {
        _viewModel = State(initialValue: LeagueHomeViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, onSignedOut: expired
        ))
        self.leagueID = leagueID
        self.openLineup = openLineup
    }

    var body: some View {
        LeagueHomeView(viewModel: viewModel, leagueID: leagueID, openLineup: openLineup)
    }
}
