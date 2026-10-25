import CommishAPI
import CommishCore
import CommishDesign
import LeagueHome
import Shell
import SwiftUI

/// The phone's five, the web's bar for the shown league's phase or, with none, the site's season
/// (PhoneRail, held to rail-order.ts), each under the top bar: the league switch, the player search
/// and the account's way in. Choosing a league opens its home: the League tab where the bar has one,
/// else the home pushed on the tab in view (B149). Only League is live; the others say their screen's
/// name until their lane lands. Every screen presents the player sheet through the one host.
struct RootTabs: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var selection = PhoneRail.leagueKey
    @State private var paths: [String: [ShellRoute]] = [:]
    @State private var switchOpen = false
    @State private var query = ""
    @State private var sheet = PlayerSheetHost()
    let environment: AppEnvironment
    let session: AppSession
    let signOut: () -> Void
    /// The API refused the token on a signed-in read: the app signs out and shows sign-in.
    let expired: @MainActor () -> Void

    var body: some View {
        TabView(selection: $selection) {
            ForEach(session.tabs) { tab in
                NavigationStack(path: path(tab.key)) {
                    root(tab)
                        .navigationDestination(for: ShellRoute.self, destination: destination)
                }
                .tabItem { Label(tab.label, systemImage: TabSymbols.symbol(tab.key)) }
                .tag(tab.key)
            }
        }
        .tint(Theme(colorScheme).color(Tokens.Color.accent))
        .environment(sheet)
        .playerSheet(sheet) { player in BasisText(PlayerSheetModel(player: player).loading) }
        .onChange(of: session.tabs) { _, tabs in
            if !tabs.contains(where: { $0.key == selection }), let first = tabs.first {
                selection = first.key
            }
        }
    }

    private func path(_ key: String) -> Binding<[ShellRoute]> {
        Binding(get: { paths[key] ?? [] }, set: { paths[key] = $0 })
    }

    /// A tab's first screen under the top bar, the switch's list over it while open.
    private func root(_ tab: RailTab) -> some View {
        screen(tab)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(alignment: .top) { switchList }
            .safeAreaInset(edge: .top, spacing: 0) {
                TopBar(
                    face: session.leagueSwitch.face, open: switchOpen, query: $query,
                    actions: TopBarActions(
                        toggleSwitch: { switchOpen.toggle() },
                        openAccount: { open(.account) },
                        search: { typed in ShellRoute.search(typed).map(open) }
                    )
                )
            }
            .toolbar(.hidden, for: .navigationBar)
    }

    @ViewBuilder
    private var switchList: some View {
        if switchOpen {
            ZStack(alignment: .top) {
                Color.black.opacity(0.001).onTapGesture { switchOpen = false }
                LeagueSwitchMenu(model: session.leagueSwitch, choose: choose)
                    .padding(.horizontal, Tokens.Space.s3)
                    .padding(.top, Tokens.Space.s1)
            }
        }
    }

    @ViewBuilder
    private func screen(_ tab: RailTab) -> some View {
        switch (tab.key, selectedLeague) {
        case let (PhoneRail.leagueKey, league?):
            LeagueScreen(environment: environment, leagueID: league.id, expired: expired) { selection = "lineup" }
                .id(league.id)
        case (PhoneRail.leagueKey, nil):
            BasisText(AppWords.LeagueList.none).padding(Tokens.Space.s5)
        default:
            NamedScreen(tab.label)
        }
    }

    @ViewBuilder
    private func destination(_ route: ShellRoute) -> some View {
        switch route {
        case .players:
            NamedScreen(AppWords.Tab.players)
        case .account:
            NamedScreen(PhoneRail.account.label, verb: (AppWords.SignIn.signOut, signOut))
        case let .leagueHome(id):
            LeagueScreen(environment: environment, leagueID: id, expired: expired) {}
        }
    }

    private var selectedLeague: FollowedLeague? {
        guard case let .signedIn(league) = session.state else {
            return nil
        }
        return league
    }

    private func open(_ route: ShellRoute) {
        switchOpen = false
        paths[selection, default: []].append(route)
    }

    private func choose(_ id: String) {
        switchOpen = false
        session.choose(id)
        let tabs = session.tabs
        if !tabs.contains(where: { $0.key == selection }), let first = tabs.first {
            selection = first.key
        }
        switch ShellRoute.home(of: id, in: tabs) {
        case let .tab(key):
            paths[key] = []
            selection = key
        case let .push(route):
            paths[selection, default: []].append(route)
        }
    }
}

/// A league's home: owns its view model for the league it shows.
private struct LeagueScreen: View {
    @State private var viewModel: LeagueHomeViewModel
    private let leagueID: String
    private let openLineup: () -> Void

    init(
        environment: AppEnvironment,
        leagueID: String,
        expired: @escaping @MainActor () -> Void,
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
