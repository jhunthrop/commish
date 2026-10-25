package app.trycommish.feature.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.RailItem
import app.trycommish.design.Section
import app.trycommish.design.Tokens

/** The phone's five at the foot of every tab (Rail.generated.kt, the web's phone bar for the phase),
 * Material's navigation bar in the theme's colours. */
@Composable
fun PhoneTabBar(
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

/** A screen named until its lane lands: its title as a section head, and what it was opened for beside it
 * (the search's query). */
@Composable
fun NamedScreen(
    title: String,
    aside: String? = null,
) {
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp)) {
        Section(title, aside) {}
    }
}
