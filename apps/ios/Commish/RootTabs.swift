import Board
import CommishAPI
import CommishCore
import CommishDesign
import LeagueHome
import Matchup
import Player
import Rankings
import Record
import Shell
import Start
import SwiftUI
import Trades
import Waivers

/// The phone's five, the web's bar for the shown league's phase or, with none, the site's season
/// (PhoneRail, held to rail-order.ts), each under the top bar: the league switch, the player search
/// and the account's way in. Choosing a league opens its home: the League tab where the bar has one,
/// else the home pushed on the tab in view (B149). League, Lineup, Matchup, Waivers, Trades, the board
/// (the Board item, and Rest of season in season with no league), Rankings and Our record are live, and
/// the search opens Rankings with its letters; the others say their screen's name until their lane
/// lands. Every screen presents the player sheet through the one host; its Full page and a player's
/// site link push his page on the tab in view.
struct RootTabs: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var selection = PhoneRail.leagueKey
    @State private var paths: [String: [ShellRoute]] = [:]
    @State private var switchOpen = false
    @State private var query = ""
    @State private var sheet = PlayerSheetHost()
    @Environment(\.openURL) private var openURL
    let environment: AppEnvironment
    let session: AppSession
    /// A site link the app was opened with (a player's page), pushed on the tab in view once.
    @Binding var linked: ShellRoute?
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
        // The sheet's Full page is his page in the app: the sheet closes onto it, pushed on the tab in view.
        .playerSheet(sheet, openPage: { open(.player(slug: $0)) }, openRoute: open, content: { player in
            PlayerSheetContainer(player: player, offer: sheet.offer, close: sheet.close) { player in
                PlayerSheetViewModel(
                    player: player, run: environment.api, pages: environment.api, weeks: environment.api,
                    cache: environment.cache, clock: environment.clock, league: selectedLeague, onSignedOut: expired
                )
            }
            .id(player.id)
        })
        .onChange(of: session.tabs) { _, tabs in
            // A tab the new bar does not show takes its pushed screens with it.
            paths = paths.filter { key, _ in tabs.contains { $0.key == key } }
            if !tabs.contains(where: { $0.key == selection }), let first = tabs.first {
                selection = first.key
            }
        }
        .onChange(of: linked, initial: true) { _, route in
            guard let route else {
                return
            }
            sheet.close()
            open(route)
            linked = nil
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
                        search: { typed in
                            if let route = ShellRoute.search(typed) {
                                query = ""
                                open(route)
                            }
                        }
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
            LeagueScreen(environment: environment, leagueID: league.id, expired: expired) {
                selection = PhoneRail.lineupKey
            }
            .id(league.id)
        case let (PhoneRail.lineupKey, league?):
            LineupScreen(environment: environment, league: league, expired: expired)
                .id(league.id)
        case let (PhoneRail.matchupKey, league?):
            MatchupTab(environment: environment, leagueID: league.id, expired: expired) {
                selection = PhoneRail.lineupKey
            }
            .id(league.id)
        case let (PhoneRail.waiversKey, league?):
            WaiversTab(environment: environment, league: league, expired: expired)
                .id(league.id)
        case let (PhoneRail.tradesKey, league?):
            TradesTab(environment: environment, league: league, expired: expired)
                .id(league.id)
        case (PhoneRail.leagueKey, nil), (PhoneRail.lineupKey, nil), (PhoneRail.matchupKey, nil),
             (PhoneRail.waiversKey, nil), (PhoneRail.tradesKey, nil):
            BasisText(AppWords.LeagueList.none).padding(Tokens.Space.s5)
        case (PhoneRail.rankingsKey, _):
            RankingsTab(environment: environment, inSeason: inSeason, query: "", expired: expired)
        case (PhoneRail.recordKey, _):
            RecordTab(environment: environment, expired: expired)
        default:
            if let inSeason = PhoneRail.boardInSeason(tab.key) {
                BoardTab(
                    environment: environment,
                    inSeason: inSeason,
                    following: selectedLeague != nil,
                    expired: expired
                )
                .id("\(tab.key)-\(selectedLeague != nil)")
            } else {
                NamedScreen(tab.label)
            }
        }
    }

    @ViewBuilder
    private func destination(_ route: ShellRoute) -> some View {
        switch route {
        case let .players(query):
            RankingsTab(environment: environment, inSeason: inSeason, query: query, expired: expired)
                .id(query)
        case let .player(slug):
            PlayerPageView(
                viewModel: PlayerPageViewModel(
                    slug: slug, run: environment.api, pages: environment.api, weeks: environment.api,
                    cache: environment.cache, clock: environment.clock, league: selectedLeague, onSignedOut: expired
                ),
                act: verbAction
            )
            .id(slug)
        case .account:
            NamedScreen(PhoneRail.account.label, verb: (AppWords.SignIn.signOut, signOut))
        case let .leagueHome(id):
            LeagueScreen(environment: environment, leagueID: id, expired: expired) {}
        case .adp, .compare, .clubs, .club, .schedule:
            ReferenceScreen(route: route, environment: environment, league: selectedLeague, expired: expired)
                .id(route)
        }
    }

    /// The season names the order's page Rankings (week-names.ts weekNames): the site's regular season,
    /// whether or not a league is followed; Players before it, after it and in the NFL's postseason. An
    /// unread season reads as in season, as the bar does.
    private var inSeason: Bool {
        session.sitePhase == nil || session.sitePhase == .inSeason
    }

    private var selectedLeague: FollowedLeague? {
        guard case let .signedIn(league) = session.state else {
            return nil
        }
        return league
    }

    /// What the page's verb does in the app: its league screen's tab where the bar has it, the platform's
    /// waiver page with his name on the clipboard first (so its search takes it); nil where the app has
    /// no way to follow it, and the page then pins none.
    private func verbAction(_ verb: CardVerb, name: String) -> (() -> Void)? {
        if case let .platform(url) = verb.target {
            return {
                UIPasteboard.general.string = name
                openURL(url)
            }
        }
        guard let key = verb.target.tabKey, session.tabs.contains(where: { $0.key == key }) else {
            return nil
        }
        return { selection = key }
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

/// A league's Start screen: owns its view model for the league it shows; the lineup copied to the
/// system clipboard.
private struct LineupScreen: View {
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

/// A league's Matchup: owns its view model for the league it shows; the view polls while on screen.
private struct MatchupTab: View {
    @State private var viewModel: MatchupViewModel
    private let leagueID: String
    private let openLineup: @MainActor @Sendable () -> Void

    init(
        environment: AppEnvironment, leagueID: String, expired: @escaping @MainActor () -> Void,
        openLineup: @escaping @MainActor @Sendable () -> Void
    ) {
        _viewModel = State(initialValue: MatchupViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, onSignedOut: expired
        ))
        self.leagueID = leagueID
        self.openLineup = openLineup
    }

    var body: some View {
        MatchupView(viewModel: viewModel, leagueID: leagueID, openLineup: openLineup)
    }
}

/// A league's Trades: owns its view model for the league it shows; the offer copied to the system
/// clipboard, the member's team and standing as the switch names them.
private struct TradesTab: View {
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

/// The board's tab: owns its view model, which holds the chips while the player sheet is open over it.
private struct BoardTab: View {
    @State private var viewModel: BoardViewModel

    init(environment: AppEnvironment, inSeason: Bool, following: Bool, expired: @escaping @MainActor () -> Void) {
        _viewModel = State(initialValue: BoardViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, inSeason: inSeason,
            following: following, onSignedOut: expired
        ))
    }

    var body: some View {
        BoardView(viewModel: viewModel)
    }
}

/// A league's Waivers: owns its view model for the league it shows; a name copied to the system
/// clipboard and the platform's waiver page opened where the claim is not made here.
private struct WaiversTab: View {
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

/// The Rankings: owns its view model, which holds the chips and the search while the sheet is open.
private struct RankingsTab: View {
    @State private var viewModel: RankingsViewModel

    init(environment: AppEnvironment, inSeason: Bool, query: String, expired: @escaping @MainActor () -> Void) {
        _viewModel = State(initialValue: RankingsViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, inSeason: inSeason,
            query: query, onSignedOut: expired
        ))
    }

    var body: some View {
        RankingsView(viewModel: viewModel)
    }
}

/// Our record: owns its view model, which holds the chips.
private struct RecordTab: View {
    @State private var viewModel: RecordViewModel

    init(environment: AppEnvironment, expired: @escaping @MainActor () -> Void) {
        _viewModel = State(initialValue: RecordViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, onSignedOut: expired
        ))
    }

    var body: some View {
        RecordView(viewModel: viewModel)
    }
}
