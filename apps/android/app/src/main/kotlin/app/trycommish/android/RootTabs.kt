package app.trycommish.android

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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.trycommish.core.AppWords
import app.trycommish.core.phoneBar
import app.trycommish.core.shell.LEAGUE_PAGE
import app.trycommish.core.shell.LINEUP_PAGE
import app.trycommish.core.shell.MATCHUP_PAGE
import app.trycommish.core.shell.PlayerSheetHost
import app.trycommish.core.shell.ShellDestination
import app.trycommish.core.shell.ShellRoute
import app.trycommish.core.shell.ShellState
import app.trycommish.core.shell.ShellViewModel
import app.trycommish.core.shell.TRADES_PAGE
import app.trycommish.core.shell.WAIVERS_PAGE
import app.trycommish.core.shell.homeOf
import app.trycommish.core.shell.lineupOf
import app.trycommish.core.shell.searchRoute
import app.trycommish.design.CommishTheme
import app.trycommish.design.Rail
import app.trycommish.design.RailItem
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.shell.LeagueSwitchMenu
import app.trycommish.feature.shell.LocalPlayerSheet
import app.trycommish.feature.shell.NamedScreen
import app.trycommish.feature.shell.PhoneTabBar
import app.trycommish.feature.shell.PlayerSheet
import app.trycommish.feature.shell.TopBar
import app.trycommish.feature.shell.TopBarActions

/** Every page any bar opens (Rail.generated.kt), each its own route. */
private val PAGES: List<RailItem> =
    (Rail.byKey.values.flatten() + Rail.withoutLeague + Rail.withoutLeagueBySeason.values.flatten()).distinctBy { it.page }

/** The tabs drawn by their own screens; the rest show their name until their lane lands. */
private val LIVE_PAGES = setOf(LEAGUE_PAGE, LINEUP_PAGE, MATCHUP_PAGE, WAIVERS_PAGE, TRADES_PAGE, BOARD_PAGE)

/** The pushed screens' routes, one per ShellRoute. */
private object Routes {
    const val PLAYERS = "search/{query}"
    const val ACCOUNT = "account"
    const val LEAGUE_HOME = "league-home/{id}"
    const val PLAYER = "player/{slug}"

    fun of(route: ShellRoute): String =
        when (route) {
            is ShellRoute.Players -> "search/${android.net.Uri.encode(route.query)}"
            ShellRoute.Account -> ACCOUNT
            is ShellRoute.LeagueHome -> "league-home/${route.id}"
            is ShellRoute.Player -> "player/${route.slug}"
        }
}

/**
 * The app's shell: on every tab the top bar (the league switch read from GET /me, the player search,
 * the account's way in) and the web's phone bar for the shown league's phase, or with none the site's
 * season (Rail.generated.kt), a back stack per tab, and the one player sheet over all of it. Choosing
 * a league shows it, writes it to the site, and opens its home: the League tab where the bar has one,
 * else the home pushed on the tab in view (B149). League, Lineup, Matchup, Waivers, Trades and the board (the
 * Board item, and Rest of season in season with no league) are live; the rest show their name.
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
    val state by shell.state.collectAsStateWithLifecycle()
    val sheet = remember { PlayerSheetHost() }
    var tab by rememberSaveable { mutableStateOf(LEAGUE_PAGE) }
    var switchOpen by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
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

    LaunchedEffect(signedIn) { if (signedIn) shell.open() }
    // Back closes the open switch before it leaves the screen.
    BackHandler(enabled = switchOpen) { switchOpen = false }
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

    CompositionLocalProvider(LocalPlayerSheet provides sheet) {
        Scaffold(
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
            bottomBar = { PhoneTabBar(bar, tab) { openTab(it.page) } },
        ) { padding ->
            // The bars' room counted as taken, so a pin's imePadding lifts it only by what the keyboard adds.
            Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
                Pages(graph, nav, state, bar, shell::open, openLineup)
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
        PlayerSheet(sheet, openPlayer = { push(it) })
    }
}

/** The tabs' pages and the pushed screens. */
@Composable
private fun Pages(
    graph: AppGraph,
    nav: NavHostController,
    state: ShellState,
    bar: List<RailItem>,
    retry: () -> Unit,
    onOpenLineup: (leagueId: String) -> Unit,
) {
    NavHost(nav, startDestination = LEAGUE_PAGE) {
        composable(LEAGUE_PAGE) { LeagueTab(graph, state, retry, onOpenLineup) }
        composable(LINEUP_PAGE) { StartTab(graph, state, retry) }
        composable(MATCHUP_PAGE) { MatchupTab(graph, state, retry) }
        composable(WAIVERS_PAGE) { WaiversTab(graph, state, retry) }
        composable(TRADES_PAGE) { TradesTab(graph, state, retry) }
        composable(BOARD_PAGE) {
            val following = (state as? ShellState.Ready)?.selected != null
            boardInSeason(bar)?.let { BoardTab(graph, it, following) }
        }
        PAGES.filter { it.page !in LIVE_PAGES }.forEach { item ->
            composable(item.page) { NamedScreen(item.label) }
        }
        composable(Routes.PLAYERS, listOf(navArgument("query") { type = NavType.StringType })) { entry ->
            NamedScreen(AppWords.players, aside = entry.arguments?.getString("query"))
        }
        // The player page's lane (S6) fills this from the slug.
        composable(Routes.PLAYER) { NamedScreen(AppWords.players) }
        composable(Routes.ACCOUNT) { NamedScreen(Words.Shell.account, verb = AppWords.signOut to graph::signOut) }
        composable(Routes.LEAGUE_HOME) { entry ->
            entry.arguments?.getString("id")?.let { LeagueHome(graph, it, onOpenLineup) }
        }
    }
}

/** Opens a tab with its own back stack restored, never a second copy of it. */
private fun NavHostController.openTab(route: String) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
