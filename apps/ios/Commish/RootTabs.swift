import Account
import Board
import CommishAPI
import CommishCore
import CommishDesign
import Companion
import LeagueHome
import Matchup
import MockRoom
import Player
import Sheet
import Shell
import SwiftUI

/// The phone's five, the web's bar for the shown league's phase or, with none, the site's season
/// (PhoneRail, held to rail-order.ts), each under the top bar: the league switch, the player search
/// and the account's way in, which opens the Account. Choosing a league opens its home: the League
/// tab where the bar has one, else the home pushed on the tab in view (B149). League, Lineup,
/// Matchup, Waivers, Trades, the board (the Board item, and Rest of season in season with no league),
/// Rankings, Our record, the Cheat sheet and the Advisor (the live-draft companion) are live, and the search opens
/// Rankings with its letters; the others say
/// their screen's name until their lane lands. A score bug opens its game: the member's on the Matchup
/// tab, another team's pushed on the tab in view (Lane 206). Every screen presents the player sheet through the one
/// host; its Full page and a player's site link push his page on the tab in view. Signed out (B155,
/// as Android) the bar is the web's public five with no top bar, the League tab the sign-in; a public
/// page's site link opens, the rest wait for the sign-in. The app builds the shell anew for each
/// account (AppSession.generation), so nothing one member left on a tab shows to the next.
struct RootTabs: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var selection = PhoneRail.leagueKey
    @State private var paths: [String: [ShellRoute]] = [:]
    @State private var switchOpen = false
    @State private var query = ""
    @State private var sheet = PlayerSheetHost()
    /// The mock room open full screen over the shell, its bar hidden while drafting.
    @State private var mockRoom: OpenMock?
    @Environment(\.openURL) private var openURL
    let environment: AppEnvironment
    let session: AppSession
    /// The League tab's screen while signed out.
    let signIn: SignInView
    /// A site link the app was opened with (a player's page), pushed on the tab in view once signed in.
    @Binding var linked: ShellRoute?
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
        .fullScreenCover(item: $mockRoom) { open in
            MockRoomCover(
                environment: environment, id: open.id, expired: expired, close: { mockRoom = nil },
                opened: { mockRoom = OpenMock(id: $0) },
                anotherSlot: { settings in
                    mockRoom = nil
                    self.open(.mockSetup(from: settings))
                }
            )
            .id(open.id)
        }
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
        .onChange(of: session.tabs, initial: true) { _, tabs in
            // A tab the new bar does not show takes its pushed screens with it.
            paths = paths.filter { key, _ in tabs.contains { $0.key == key } }
            if !tabs.contains(where: { $0.key == selection }), let first = tabs.first {
                selection = first.key
            }
        }
        .onChange(of: linked, initial: true) { openLinked() }
    }

    private var signedIn: Bool {
        session.isSignedIn
    }

    /// The site link the app was opened with: a public page at once, the rest once signed in (the
    /// shell is rebuilt at the sign-in, which reads it again).
    private func openLinked() {
        guard let route = linked, signedIn || route.isPublic else {
            return
        }
        sheet.close()
        open(route)
        linked = nil
    }

    private func path(_ key: String) -> Binding<[ShellRoute]> {
        Binding(get: { paths[key] ?? [] }, set: { paths[key] = $0 })
    }

    /// A tab's first screen under the top bar (signed in), the switch's list over it while open.
    private func root(_ tab: RailTab) -> some View {
        screen(tab)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(alignment: .top) { switchList }
            .safeAreaInset(edge: .top, spacing: 0) {
                if signedIn {
                    topBar
                }
            }
            .toolbar(.hidden, for: .navigationBar)
    }

    private var topBar: some View {
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
        if tab.key == PhoneRail.leagueKey, !signedIn {
            signIn
        } else {
            tabScreen(tab)
        }
    }

    @ViewBuilder
    private func tabScreen(_ tab: RailTab) -> some View {
        switch (tab.key, selectedLeague) {
        case let (PhoneRail.leagueKey, league?):
            LeagueScreen(
                environment: environment, leagueID: league.id, league: league, expired: expired,
                openLineup: { selection = PhoneRail.lineupKey }, openGame: { openGame($0, league: league.id) },
                openAdvisor: { open(.companionNew(replay: false)) },
                openMock: { open(.mockSetup(from: nil, league: league.settingsLeagueID)) }
            )
            .id(league.id)
        case let (PhoneRail.lineupKey, league?):
            LineupScreen(environment: environment, league: league, expired: expired)
                .id(league.id)
        case let (PhoneRail.matchupKey, league?):
            MatchupTab(
                environment: environment, leagueID: league.id, expired: expired,
                openLineup: { selection = PhoneRail.lineupKey }
            )
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
            draftScreen(tab)
        }
    }

    /// A tab of the draft's bar: the Advisor's companion, the board, the cheat sheet, the mock's setup, or the
    /// name of a screen to come.
    @ViewBuilder
    private func draftScreen(_ tab: RailTab) -> some View {
        if PhoneRail.isAdvisor(tab.key) {
            CompanionStartScreen(environment: environment, replay: false, expired: expired) { id in
                open(.companion(id: id))
            }
        } else if let inSeason = PhoneRail.boardInSeason(tab.key) {
            BoardTab(
                environment: environment,
                inSeason: inSeason,
                following: selectedLeague != nil,
                expired: expired
            )
            .id("\(tab.key)-\(selectedLeague != nil)")
        } else if tab.key == PhoneRail.sheetKey {
            SheetTab(environment: environment, format: selectedLeague?.format ?? session.format, expired: expired) {
                open(.mockSetup(from: nil, league: selectedLeague?.settingsLeagueID))
            }
        } else if PhoneRail.isMock(tab.key) {
            MockSetupTab(environment: environment, from: nil, seed: mockSeed(league: nil), expired: expired) {
                mockRoom = OpenMock(id: $0)
            }
        } else {
            NamedScreen(tab.label)
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
            AccountTab(environment: environment, session: session, expired: expired) { id in
                choose(id)
            }
        case let .leagueHome(id):
            leagueHome(id)
        case let .game(league, roster):
            MatchupTab(
                environment: environment, leagueID: league, roster: roster, expired: expired,
                openLineup: { selection = PhoneRail.lineupKey }, yourGame: { openGame(nil, league: league) }
            )
            .id(route)
        case let .companionNew(replay):
            CompanionStartScreen(environment: environment, replay: replay, expired: expired) { id in
                open(.companion(id: id))
            }
        case let .companion(id):
            CompanionDraftScreen(environment: environment, id: id, expired: expired) {
                open(.companionNew(replay: false))
            }
            .id(id)
        case let .mockSetup(from, league):
            MockSetupTab(environment: environment, from: from, seed: mockSeed(league: league), expired: expired) {
                mockRoom = OpenMock(id: $0)
            }
        case let .sharedMock(code):
            SharedMockTab(environment: environment, code: code) { mockRoom = OpenMock(id: $0) }
                .id(code)
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

    /// A league's home pushed by its id: its draft entry opens the Advisor or the setup on its saved
    /// league.
    private func leagueHome(_ id: String) -> some View {
        let league = selectedLeague.flatMap { $0.id == id ? $0 : nil }
        return LeagueScreen(
            environment: environment, leagueID: id, league: league,
            expired: expired, openLineup: {}, openGame: { openGame($0, league: id) },
            openAdvisor: { open(.companionNew(replay: false)) },
            openMock: { open(.mockSetup(from: nil, league: league?.settingsLeagueID)) }
        )
    }

    /// Where a mock's setup starts (the web's site context): the selected league's board and saved
    /// league, else the format chosen with no league; a link's `?league=` names the saved league first.
    private func mockSeed(league: String?) -> MockSetupSeed {
        MockSetupSeed(
            format: selectedLeague?.format ?? session.format,
            league: league ?? selectedLeague?.settingsLeagueID,
            exactRules: session.features.contains(Components.Schemas.FeatureKnown.customScoring.rawValue)
        )
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

    /// A score bug's game: the member's on the Matchup tab where the bar has one, else pushed.
    private func openGame(_ roster: Int?, league: String) {
        switch ShellRoute.game(of: roster, league: league, in: session.tabs) {
        case let .tab(key):
            switchOpen = false
            selection = key
        case let .push(route):
            open(route)
        }
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
