package app.trycommish.android

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.trycommish.core.lobby.LobbyLandingViewModel
import app.trycommish.core.phoneBar
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.LEAGUE_PAGE
import app.trycommish.core.shell.LINEUP_PAGE
import app.trycommish.core.shell.MATCHUP_PAGE
import app.trycommish.core.shell.ShellDestination
import app.trycommish.core.shell.ShellRoute
import app.trycommish.core.shell.ShellState
import app.trycommish.core.shell.ShellViewModel
import app.trycommish.core.shell.SiteLinks
import app.trycommish.core.shell.TRADES_PAGE
import app.trycommish.core.shell.WAIVERS_PAGE
import app.trycommish.core.shell.gameOf
import app.trycommish.core.shell.homeOf
import app.trycommish.core.shell.isPublic
import app.trycommish.core.shell.lineupOf
import app.trycommish.core.shell.searchRoute
import app.trycommish.design.CommishTheme
import app.trycommish.design.Rail
import app.trycommish.design.RailItem
import app.trycommish.design.Tokens
import app.trycommish.feature.mock.MockRoomExits
import app.trycommish.feature.shell.LeagueSwitchMenu
import app.trycommish.feature.shell.LocalPlayerSheet
import app.trycommish.feature.shell.NamedScreen
import app.trycommish.feature.shell.PhoneTabBar
import app.trycommish.feature.shell.TopBar
import app.trycommish.feature.shell.TopBarActions
import kotlinx.coroutines.launch

/** Every page any bar opens (Rail.generated.kt), each its own route. */
private val PAGES: List<RailItem> =
    (Rail.byKey.values.flatten() + Rail.withoutLeague + Rail.withoutLeagueBySeason.values.flatten()).distinctBy { it.page }

/** Every page a tab opens, whose saved stacks a sign-in or sign-out lets go. */
internal val SHELL_PAGES: List<String> = PAGES.map { it.page }

/** The tabs drawn by their own screens; the rest show their name until their lane lands. */
private val LIVE_PAGES =
    setOf(
        LEAGUE_PAGE,
        LINEUP_PAGE,
        MATCHUP_PAGE,
        WAIVERS_PAGE,
        TRADES_PAGE,
        BOARD_PAGE,
        PLAYERS_PAGE,
        RECORD_PAGE,
        ADVISOR_PAGE,
        MOCK_PAGE,
        SHEET_PAGE,
    )

/** The run pages the bar opens: the order's (Rankings in season, Players before and after it) and Our
 * record. */
private const val PLAYERS_PAGE = "players"
private const val RECORD_PAGE = "record"

/** The pushed screens' routes, one per ShellRoute. */
private object Routes {
    const val PLAYERS = "search/{query}"
    const val ACCOUNT = "account"
    const val LEAGUE_HOME = "league-home/{id}"
    const val PLAYER = "player/{slug}"
    const val GAME = "game/{id}?roster={roster}"
    const val ADP = "adp?format={format}"
    const val COMPARE = "compare?a={a}&b={b}"
    const val CLUBS = "clubs"
    const val CLUB = "club/{abbr}"
    const val SCHEDULE = "schedule"
    const val COMPANION_NEW = "companion-new?replay={replay}"
    const val COMPANION = "companion/{id}"
    const val MOCK_SETUP = "mock-new?league={league}&from={from}"
    const val SHARED_MOCK = "mock-share/{code}"

    fun of(route: ShellRoute): String =
        when (route) {
            is ShellRoute.Players -> "search/${android.net.Uri.encode(route.query)}"
            ShellRoute.Account -> ACCOUNT
            is ShellRoute.LeagueHome -> "league-home/${route.id}"
            is ShellRoute.Player -> "player/${route.slug}"
            is ShellRoute.Game -> "game/${route.leagueId}" + (route.roster?.let { "?roster=$it" } ?: "")
            is ShellRoute.Adp -> "adp?format=${route.format.orEmpty()}"
            is ShellRoute.Compare -> "compare?a=${route.first.orEmpty()}&b=${route.second.orEmpty()}"
            ShellRoute.Clubs -> CLUBS
            is ShellRoute.Club -> "club/${route.abbr}"
            ShellRoute.Schedule -> SCHEDULE
            is ShellRoute.CompanionNew -> "companion-new?replay=${route.replay}"
            is ShellRoute.Companion -> "companion/${route.id}"
            is ShellRoute.MockSetup ->
                "mock-new?league=${android.net.Uri.encode(route.league.orEmpty())}&from=${settingsArg(route.from)}"
            is ShellRoute.SharedMock -> "mock-share/${android.net.Uri.encode(route.code)}"
        }
}

/**
 * The app's shell: on every tab the top bar (the league switch read from GET /me, the player search,
 * the account's way in) and the web's phone bar for the shown league's phase, or with none the site's
 * season (Rail.generated.kt), a back stack per tab, and the one player sheet over all of it. Choosing
 * a league shows it, writes it to the site, and opens its home: the League tab where the bar has one,
 * else the home pushed on the tab in view (B149). League, Lineup, Matchup, Waivers, Trades and the board (the
 * Board item, and Rest of season in season with no league), Rankings (the Players page), Our record and
 * the Cheat sheet are live, and the search opens Rankings with its letters; the rest show their name.
 * A home's Open Lineup opens the Lineup tab for the league shown, else the lineup on the site.
 */
@Composable
fun Shell(
    graph: AppGraph,
    onOpenLineup: (leagueId: String) -> Unit,
    nav: NavHostController = rememberNavController(),
) {
    val shell: ShellViewModel = viewModel { graph.shellViewModel() }
    val signedIn by graph.signedIn.collectAsStateWithLifecycle()
    val generation by graph.generation.collectAsStateWithLifecycle()
    val state by shell.state.collectAsStateWithLifecycle()
    val chrome = rememberShellChrome()
    val sheet = chrome.sheet
    var tab by chrome::tab
    var switchOpen by chrome::switchOpen
    var query by chrome::query
    var mockRoom by chrome::mockRoom
    var lobby by chrome::lobby
    // The open house drafts, one list per account, shared by the setup that draws it and the lobby over it.
    val lobbies: LobbyLandingViewModel = viewModel(key = "lobby-landing-$generation") { graph.lobbyLandingViewModel() }
    val scope = rememberCoroutineScope()
    // Read from the collected state, so the bar follows every answer and choice.
    val bar = if (signedIn && state != ShellState.SignedOut) shell.bar() else phoneBar(null, null)

    fun openTab(page: String) {
        tab = page
        nav.openTab(page)
    }

    fun push(route: ShellRoute) {
        switchOpen = false
        nav.navigate(Routes.of(route))
    }

    // A site link a screen follows: a reference page (ADP, Compare, the clubs, a club, the schedule) or a
    // player's page is pushed on the tab in view, as the web links them; any other opens on the site. Signed
    // out, a page that waits for the sign-in (the companion) is held as an app link is (B213).
    val uri = LocalUriHandler.current
    val link: (String) -> Unit = { url ->
        val route = SiteLinks.reference(url) ?: SiteLinks.companion(url) ?: SiteLinks.mock(url)
        when {
            route != null && (signedIn || route.isPublic) -> push(route)
            route != null -> graph.openLink(route)
            else -> SiteLinks.playerSlug(url)?.let { push(ShellRoute.Player(it)) } ?: uri.openUri(url)
        }
    }

    // Signed in, the account is read; signed out, the League tab is the sign-in.
    LaunchedEffect(generation, signedIn) { if (signedIn) shell.open() }
    // Each sign-in and sign-out rebuilds the shell for the account in hand (iOS's generation, kept by the
    // shell's view model so a rotation still finds it owed): every tab's stack and the view models on it, the
    // room, the sheet, the switch and the search let go, so nothing one member opened shows to the next. Then
    // a held app link: a public page (a shared mock, the mock setup) at once, signed in or out; the companion
    // once the device is signed in (B213).
    val asked by graph.link.collectAsStateWithLifecycle()
    LaunchedEffect(generation, signedIn, asked) {
        chrome.follow(shell, nav, signedIn, asked)?.let { route ->
            graph.linkOpened()
            push(route)
        }
    }
    // The bar chooses the page shown: drawn from the back stack on the frame back lands, kept for a rotation.
    val shown by nav.currentBackStackEntryAsState()
    val chosen = tabShown(shown?.destination?.route, tab)
    LaunchedEffect(chosen) { tab = chosen }
    val activity = LocalContext.current.activity()
    // A bar that no longer holds the tab in view (the phase moved) opens its first tab.
    LaunchedEffect(bar) { if (bar.none { it.page == tab }) openTab(bar.first().page) }

    val choose: (String) -> Unit = { id ->
        switchOpen = false
        shell.choose(id)
        val next = shell.bar()
        if (next.none { it.page == tab }) openTab(next.first().page)
        when (val home = homeOf(id, next)) {
            is ShellDestination.Tab -> openTab(home.page)
            is ShellDestination.Push -> push(home.route)
        }
    }

    val openLineup: (String) -> Unit = { id ->
        val shown = (state as? ShellState.Ready)?.selected?.id
        lineupOf(id, shown, bar)?.let { openTab(it.page) } ?: onOpenLineup(id)
    }

    // A score bug's game: the member's on the Matchup tab where the bar has one, every other pushed.
    val openGame: (String, Int?) -> Unit = { id, roster ->
        when (val game = gameOf(roster, id, (state as? ShellState.Ready)?.selected?.id, bar)) {
            is ShellDestination.Tab -> openTab(game.page)
            is ShellDestination.Push -> push(game.route)
        }
    }

    CompositionLocalProvider(LocalPlayerSheet provides sheet) {
        Scaffold(
            // Under the room full screen the shell is out of reach, to touch (the room takes it) and to a
            // screen reader.
            modifier = if (chrome.covered) Modifier.clearAndSetSemantics {} else Modifier,
            containerColor = CommishTheme.colors.bg,
            topBar = {
                if (signedIn) {
                    TopBar(
                        face = shell.leagueSwitch().face,
                        open = switchOpen,
                        query = query,
                        onQuery = { query = it },
                        actions =
                            TopBarActions(
                                toggleSwitch = { switchOpen = !switchOpen },
                                openAccount = { push(ShellRoute.Account) },
                                search = { typed ->
                                    searchRoute(typed)?.let {
                                        query = ""
                                        push(it)
                                    }
                                },
                            ),
                        modifier = Modifier.background(CommishTheme.colors.shell).statusBarsPadding(),
                    )
                }
            },
            bottomBar = { PhoneTabBar(bar, chosen) { openTab(it.page) } },
        ) { padding ->
            // The bars' room counted as taken, so a pin's imePadding lifts it only by what the keyboard adds.
            Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
                PagesWithBack(
                    nav,
                    bar.map { it.page },
                    BackVerbs(::openTab, leave = { activity?.moveTaskToBack(false) }),
                    switchOpen,
                    closeSwitch = { switchOpen = false },
                ) {
                    Pages(
                        graph,
                        nav,
                        state,
                        bar,
                        PageVerbs(
                            shell::open,
                            openLineup,
                            ::openTab,
                            choose,
                            link,
                            openGame,
                            ::push,
                            LobbyEntry(lobbies) {
                                lobby =
                                    OpenLobby(it)
                            },
                        ) {
                            mockRoom = it
                        },
                    )
                }
                if (switchOpen) {
                    Box(
                        Modifier
                            .fillMaxSize()
                            .clickable(remember { MutableInteractionSource() }, indication = null) { switchOpen = false },
                    )
                    LeagueSwitchMenu(
                        shell.leagueSwitch(),
                        choose,
                        Modifier.padding(horizontal = Tokens.Space.s3.dp).padding(top = Tokens.Space.s1.dp),
                    )
                }
            }
        }
        mockRoom?.let { id ->
            MockRoomCover(
                graph,
                id,
                MockRoomExits(
                    close = { mockRoom = null },
                    opened = { mockRoom = it },
                    anotherSlot = { settings ->
                        mockRoom = null
                        push(ShellRoute.MockSetup(from = settings))
                    },
                    open = { sheet.open(it) },
                ),
            )
        }
        lobby?.let { open ->
            LobbyCover(
                graph,
                open,
                lobbies,
                LobbyCoverExits(
                    show = { lobby = it },
                    close = {
                        lobby = null
                        scope.launch { lobbies.load() }
                    },
                    solo = { id ->
                        lobby = null
                        mockRoom = id
                    },
                    open = { sheet.open(it) },
                ),
                generation,
            )
        }
        // Over a draft in progress the sheet has no Full page: one verb per screen, and the room has no page
        // stack to push it on; his page is reachable after the draft (Lane 214 review M3).
        PlayerSheetOver(
            graph,
            sheet,
            (state as? ShellState.Ready)?.selected,
            openPlayer = if (chrome.covered) null else ({ push(it) }),
        )
    }
}

/** What the pages ask of the shell: read the account again (a retry, or the Account's leagues changed), a
 * league's lineup, a tab, a league chosen as the switch chooses it, and a game of a league's week. */
private class PageVerbs(
    val retry: () -> Unit,
    val onOpenLineup: (leagueId: String) -> Unit,
    val openTab: (String) -> Unit,
    val choose: (String) -> Unit,
    /** A site link: a reference page or a player's page pushed, any other on the site. */
    val link: (String) -> Unit,
    val openGame: (leagueId: String, roster: Int?) -> Unit,
    /** A screen pushed on the tab in view. */
    val push: (ShellRoute) -> Unit,
    /** The open house drafts under the setup, and a lobby opened full screen by its id. */
    val lobby: LobbyEntry,
    /** A mock room opened full screen by its id. */
    val openRoom: (String) -> Unit,
)

/** What back asks of the shell: a tab opened, or the app left (sent behind, as the system's back does). */
internal class BackVerbs(
    val openTab: (String) -> Unit,
    val leave: () -> Unit,
)

/**
 * The pages and the shell's two backs (Lane 218). The dispatcher asks the newest callback first.
 * - The tabs' back, added after the NavHost's: the bar's first tab is the start, whatever the NavHost starts
 *   at. Back from another tab's root opens it; back from its root leaves the app. A draft bar has no League
 *   tab, and the NavHost's start (League) sits under its first, so the NavHost alone would pop to a page no
 *   tab holds. At the first tab's root with nothing under it the handler stands aside for the system's back.
 *   A page's own back, drawn later, answers ahead of it.
 * - The open switch's back, added only while it is open, so it is newer than any page's: back closes the
 *   switch first.
 */
@Composable
internal fun PagesWithBack(
    nav: NavHostController,
    bar: List<String>,
    verbs: BackVerbs,
    switchOpen: Boolean,
    closeSwitch: () -> Unit,
    pages: @Composable () -> Unit,
) {
    pages()
    val shown by nav.currentBackStackEntryAsState()
    val route = shown?.destination?.route
    val first = bar.firstOrNull()
    val atTabRoot = route != null && route in bar
    val underFirst = route == first && nav.previousBackStackEntry != null
    BackHandler(enabled = atTabRoot && (route != first || underFirst)) {
        if (route == first) verbs.leave() else first?.let(verbs.openTab)
    }
    if (switchOpen) BackHandler(onBack = closeSwitch)
}

/** The activity a context belongs to, for sending the app behind. */
private tailrec fun Context.activity(): Activity? =
    when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.activity()
        else -> null
    }

/** Every tab's page, the routes the bar can choose. */
private val TAB_PAGES: Set<String> = PAGES.map { it.page }.toSet()

/** The tab the bar draws as chosen: the page shown when it is a tab's own page, else (a pushed screen, or
 * nothing shown yet) the tab it sits on. */
internal fun tabShown(
    route: String?,
    current: String,
    pages: Collection<String> = TAB_PAGES,
): String = route?.takeIf { it in pages } ?: current

/** The tabs' pages and the pushed screens. */
@Composable
private fun Pages(
    graph: AppGraph,
    nav: NavHostController,
    state: ShellState,
    bar: List<RailItem>,
    verbs: PageVerbs,
) {
    val retry = verbs.retry
    val onOpenLineup = verbs.onOpenLineup
    val openTab = verbs.openTab
    val selected = (state as? ShellState.Ready)?.selected
    NavHost(nav, startDestination = LEAGUE_PAGE) {
        val openAdvisor = { verbs.push(ShellRoute.CompanionNew(replay = false)) }
        val openMock = { league: String? -> verbs.push(ShellRoute.MockSetup(league)) }
        composable(LEAGUE_PAGE) { LeagueTab(graph, state, retry, onOpenLineup, verbs.openGame, openAdvisor, openMock) }
        composable(LINEUP_PAGE) { StartTab(graph, state, retry) }
        composable(MATCHUP_PAGE) { MatchupTab(graph, state, retry) { openTab(LINEUP_PAGE) } }
        composable(WAIVERS_PAGE) { WaiversTab(graph, state, retry) }
        composable(TRADES_PAGE) { TradesTab(graph, state, retry) }
        composable(BOARD_PAGE) {
            val following = (state as? ShellState.Ready)?.selected != null
            boardInSeason(bar)?.let { BoardTab(graph, it, following, verbs.link) }
        }
        composable(PLAYERS_PAGE) { RankingsTab(graph, state, query = "") }
        composable(RECORD_PAGE) { RecordTab(graph) }
        // The sheet's pinned verb opens a mock's setup on the league shown, as the iOS Sheet's does.
        composable(SHEET_PAGE) { SheetTab(graph, state) { openMock(selected?.settingsLeagueId) } }
        companion(graph, verbs.push)
        mock(graph, state, verbs.openRoom, verbs.lobby)
        PAGES.filter { it.page !in LIVE_PAGES }.forEach { item ->
            composable(item.page) { NamedScreen(item.label) }
        }
        composable(Routes.PLAYERS, listOf(navArgument("query") { type = NavType.StringType })) { entry ->
            RankingsTab(graph, state, entry.arguments?.getString("query").orEmpty())
        }
        composable(Routes.PLAYER, listOf(navArgument("slug") { type = NavType.StringType })) { entry ->
            entry.arguments?.getString("slug")?.let { PlayerPage(graph, it, selected, bar, openTab) }
        }
        reference(graph, selected, verbs.link)
        composable(Routes.ACCOUNT) { AccountTab(graph, leaguesChanged = retry, openLeague = verbs.choose) }
        composable(Routes.LEAGUE_HOME) { entry ->
            entry.arguments?.getString("id")?.let { id ->
                val league = (state as? ShellState.Ready)?.leagues?.firstOrNull { it.id == id }
                LeagueHome(graph, id, onOpenLineup, verbs.openGame, draftDayOf(graph, league, openAdvisor, openMock))
            }
        }
        composable(
            Routes.GAME,
            listOf(
                navArgument("id") { type = NavType.StringType },
                navArgument("roster") {
                    type = NavType.StringType
                    nullable = true
                },
            ),
        ) { entry ->
            val id = entry.arguments?.getString("id") ?: return@composable
            val roster = entry.arguments?.getString("roster")?.toIntOrNull()
            // Open Lineup as a home's: the Lineup tab for the league shown where the bar has one, else the site.
            GameScreen(graph, GameOf(id, roster), openLineup = { onOpenLineup(id) }, yourGame = { verbs.openGame(id, null) })
        }
    }
}

/** The live-draft companion's routes: the Advisor's start page on the bar, the start page pushed (a site
 * link, a League home's draft day, a report's Follow another draft) and a followed draft. */
private fun NavGraphBuilder.companion(
    graph: AppGraph,
    push: (ShellRoute) -> Unit,
) {
    val open = { id: String -> push(ShellRoute.Companion(id)) }
    val start = { push(ShellRoute.CompanionNew(replay = false)) }
    composable(ADVISOR_PAGE) { CompanionStartTab(graph, replay = false, open = open) }
    composable(
        Routes.COMPANION_NEW,
        listOf(
            navArgument("replay") {
                type = NavType.BoolType
                defaultValue = false
            },
        ),
    ) { entry ->
        CompanionStartTab(graph, replay = entry.arguments?.getBoolean("replay") == true, open = open)
    }
    composable(Routes.COMPANION, listOf(navArgument("id") { type = NavType.StringType })) { entry ->
        entry.arguments?.getString("id")?.let { CompanionDraftTab(graph, it, followAnother = start) }
    }
}

/** The mock room's routes: the setup on the bar's Mock draft, the setup pushed (a site link, a League home's
 * Start a mock draft, a report's Try another slot) and a shared draft by its code. Starting opens the room
 * full screen. */
private fun NavGraphBuilder.mock(
    graph: AppGraph,
    state: ShellState,
    openRoom: (String) -> Unit,
    lobby: LobbyEntry,
) {
    composable(MOCK_PAGE) { MockSetupTab(graph, ShellRoute.MockSetup(), state, openRoom, lobby) }
    val optional = { name: String ->
        navArgument(name) {
            type = NavType.StringType
            defaultValue = ""
        }
    }
    composable(Routes.MOCK_SETUP, listOf(optional("league"), optional("from"))) { entry ->
        val route =
            ShellRoute.MockSetup(
                entry.arguments?.getString("league")?.takeIf { it.isNotEmpty() },
                settingsOf(entry.arguments?.getString("from")),
            )
        MockSetupTab(graph, route, state, openRoom, lobby)
    }
    composable(Routes.SHARED_MOCK, listOf(navArgument("code") { type = NavType.StringType })) { entry ->
        entry.arguments?.getString("code")?.let { SharedMockTab(graph, it, openRoom) }
    }
}

/** The reference pages' routes (ADP, Compare, the clubs, a club, the schedule), each its own screen. */
private fun NavGraphBuilder.reference(
    graph: AppGraph,
    league: FollowedLeague?,
    link: (String) -> Unit,
) {
    val optional = { name: String ->
        navArgument(name) {
            type = NavType.StringType
            defaultValue = ""
        }
    }

    fun NavBackStackEntry.text(name: String): String? = arguments?.getString(name)?.takeIf { it.isNotEmpty() }
    composable(Routes.ADP, listOf(optional("format"))) { ReferenceScreen(graph, ShellRoute.Adp(it.text("format")), league, link) }
    composable(Routes.COMPARE, listOf(optional("a"), optional("b"))) {
        ReferenceScreen(graph, ShellRoute.Compare(it.text("a"), it.text("b")), league, link)
    }
    composable(Routes.CLUBS) { ReferenceScreen(graph, ShellRoute.Clubs, league, link) }
    composable(Routes.CLUB, listOf(navArgument("abbr") { type = NavType.StringType })) { entry ->
        entry.text("abbr")?.let { ReferenceScreen(graph, ShellRoute.Club(it), league, link) }
    }
    composable(Routes.SCHEDULE) { ReferenceScreen(graph, ShellRoute.Schedule, league, link) }
}

/** A sign-in or a sign-out: back to a new League tab with nothing above or under it, and no tab's saved
 * stack kept (an Account left open on another tab would come back with the last account's words). The start
 * entry goes too, so no view model on any entry (a League home, a mock setup) passes to the next account. */
internal fun NavHostController.startOver(pages: List<String> = SHELL_PAGES) {
    pages.forEach { clearBackStack(it) }
    navigate(LEAGUE_PAGE) {
        popUpTo(graph.findStartDestination().id) { inclusive = true }
    }
}

/** Opens a tab with its own back stack restored, never a second copy of it. */
internal fun NavHostController.openTab(route: String) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
