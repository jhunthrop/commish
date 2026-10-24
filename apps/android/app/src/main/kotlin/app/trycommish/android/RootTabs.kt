package app.trycommish.android

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.trycommish.core.leaguehome.LeagueHomeViewModel
import app.trycommish.core.phoneBar
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Rail
import app.trycommish.design.RailItem

/** The League page's route, the one screen live in this build. */
private const val LEAGUE = "league"

/** Every page any phase's bar opens (Rail.generated.kt), each its own route. */
private val PAGES: List<RailItem> = (Rail.byKey.values.flatten() + Rail.withoutLeague).distinctBy { it.page }

/**
 * The app's shell: the web's phone bar for the season phase of the league the League tab opened
 * (rail-order.ts railFor, generated into Rail.generated.kt with the web's labels and glyphs), signed
 * out the season's bar without a league, and a back stack per tab. Only League is live; the rest show
 * their name until their screen lanes land.
 */
@Composable
fun Shell(
    graph: AppGraph,
    onOpenLineup: (leagueId: String) -> Unit,
    nav: NavHostController = rememberNavController(),
) {
    val vm: LeagueHomeViewModel = viewModel { graph.leagueHomeViewModel() }
    val signedIn by graph.signedIn.collectAsStateWithLifecycle()
    val choice by vm.choice.collectAsStateWithLifecycle()
    val bar = if (signedIn) phoneBar(choice) else Rail.withoutLeague
    val entry by nav.currentBackStackEntryAsState()
    val current = entry?.destination?.route
    // A bar that no longer holds the open page (the phase moved) opens its first tab.
    LaunchedEffect(bar, current) {
        if (current != null && bar.none { it.page == current }) nav.open(bar.first().page)
    }
    Scaffold(
        containerColor = CommishTheme.colors.bg,
        bottomBar = { Bar(bar, current) { nav.open(it.page) } },
    ) { padding ->
        NavHost(nav, startDestination = LEAGUE, modifier = Modifier.padding(padding)) {
            composable(LEAGUE) { LeagueTab(graph, vm, onOpenLineup) }
            PAGES.filter { it.page != LEAGUE }.forEach { item ->
                composable(item.page) { Placeholder(item.label) }
            }
        }
    }
}

/** Opens a tab with its own back stack restored, never a second copy of it. */
private fun NavHostController.open(route: String) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
private fun Bar(
    items: List<RailItem>,
    current: String?,
    onOpen: (RailItem) -> Unit,
) {
    val c = CommishTheme.colors
    NavigationBar(containerColor = c.shell) {
        items.forEach { item ->
            NavigationBarItem(
                selected = current == item.page,
                onClick = { onOpen(item) },
                icon = { Icon(painterResource(item.glyph), contentDescription = null) },
                label = {
                    Text(
                        item.label,
                        style = Faces.label.copy(letterSpacing = Faces.small.letterSpacing),
                        maxLines = 2,
                        textAlign = TextAlign.Center,
                    )
                },
                colors =
                    NavigationBarItemDefaults.colors(
                        selectedIconColor = c.accent,
                        selectedTextColor = c.ink,
                        indicatorColor = c.accentWash,
                        unselectedIconColor = c.ink3,
                        unselectedTextColor = c.ink3,
                    ),
            )
        }
    }
}

/** A tab not built yet: its name and nothing else. */
@Composable
private fun Placeholder(name: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(name, style = Faces.head, color = CommishTheme.colors.ink3)
    }
}
