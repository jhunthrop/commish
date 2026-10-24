package app.trycommish.android

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces

/** The bar's five tabs in the web's in-season order (web/src/lib/ui/rail-order.ts: League, the week's
 * Players, Rest of season; then Mock draft and Advisor). Only League is live in this build; the rest
 * show their name. */
enum class Tab(
    val route: String,
    @StringRes val label: Int,
    val icon: ImageVector,
) {
    League("league", R.string.tab_league, Icons.Filled.Home),
    Players("players", R.string.tab_players, Icons.Filled.Person),
    Rest("rest", R.string.tab_rest, Icons.AutoMirrored.Filled.List),
    Mock("mock", R.string.tab_mock, Icons.Filled.PlayArrow),
    Advisor("advisor", R.string.tab_advisor, Icons.Filled.Info),
}

/** The app's shell: the bottom bar and a back stack per tab (each tab keeps its place when left). */
@Composable
fun RootTabs(
    league: @Composable () -> Unit,
    nav: NavHostController = rememberNavController(),
) {
    val entry by nav.currentBackStackEntryAsState()
    val current = entry?.destination?.route
    Scaffold(
        containerColor = CommishTheme.colors.bg,
        bottomBar = { Bar(current) { tab -> nav.open(tab) } },
    ) { padding ->
        NavHost(nav, startDestination = Tab.League.route, modifier = Modifier.padding(padding)) {
            composable(Tab.League.route) { league() }
            Tab.entries.filter { it != Tab.League }.forEach { tab ->
                composable(tab.route) { Placeholder(stringResource(tab.label)) }
            }
        }
    }
}

/** Opens a tab with its own back stack restored, never a second copy of it. */
fun NavHostController.open(tab: Tab) {
    navigate(tab.route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
private fun Bar(
    current: String?,
    onOpen: (Tab) -> Unit,
) {
    val c = CommishTheme.colors
    NavigationBar(containerColor = c.shell) {
        Tab.entries.forEach { tab ->
            NavigationBarItem(
                selected = current == tab.route,
                onClick = { onOpen(tab) },
                icon = { Icon(tab.icon, contentDescription = null) },
                label = {
                    Text(
                        stringResource(tab.label),
                        style = Faces.label.copy(letterSpacing = Faces.small.letterSpacing),
                        maxLines = 1,
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
