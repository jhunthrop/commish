package app.trycommish.feature.shell

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.R
import app.trycommish.design.Tokens
import app.trycommish.design.Words

/** The bar's controls' height, the web's phone bar's. */
private val CONTROL_H = 40.dp

/** The account's tap target. */
private val ACCOUNT_SIDE = 48.dp

/** What the bar's controls do: open or close the switch, open the account, search for what was typed. */
class TopBarActions(
    val toggleSwitch: () -> Unit,
    val openAccount: () -> Unit,
    val search: (String) -> Unit,
)

/**
 * The top bar on every tab, the web's phone bar (Shell.svelte at 760 px and under): the league switch
 * across the first row with the account's way in in its last cell, the player search across the
 * second. The caller owns what is typed and whether the switch is open.
 */
@Composable
fun TopBar(
    face: String,
    open: Boolean,
    query: String,
    onQuery: (String) -> Unit,
    actions: TopBarActions,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier.fillMaxWidth().background(c.shell)) {
        Column(
            Modifier.padding(horizontal = Tokens.Space.s4.dp, vertical = Tokens.Space.s2.dp),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
                SwitchFace(face, open, actions.toggleSwitch, Modifier.weight(1f))
                AccountButton(actions.openAccount)
            }
            SearchField(query, onQuery, actions.search)
        }
        HorizontalDivider(color = c.shellLine)
    }
}

/** The switch's face: the shown league's name cut at its end, with the switch's mark and chevron; one
 * width at every state, so the bar never moves when the name arrives (LeagueSwitch.svelte). */
@Composable
private fun SwitchFace(
    face: String,
    open: Boolean,
    toggle: () -> Unit,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Surface(
        onClick = toggle,
        shape = shape,
        color = c.surface,
        border = BorderStroke(1.dp, if (open) c.ink else c.lineStrong),
        modifier =
            modifier.height(CONTROL_H).semantics {
                selected = open
                contentDescription = "$face, ${Words.Shell.yourLeagues}"
            },
    ) {
        Row(
            Modifier.padding(horizontal = Tokens.Space.s3.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
        ) {
            Icon(painterResource(R.drawable.icon_league), null, Modifier.size(18.dp), tint = c.accentText)
            Text(
                face,
                style = Faces.small.copy(fontWeight = FontWeight.SemiBold),
                color = c.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(painterResource(R.drawable.icon_chevron), null, Modifier.size(16.dp), tint = c.ink3)
        }
    }
}

/** The account's way in, the bar's last cell (the rail's foot at a desk). */
@Composable
private fun AccountButton(open: () -> Unit) {
    IconButton(onClick = open, modifier = Modifier.size(ACCOUNT_SIDE)) {
        Icon(
            painterResource(R.drawable.rail_account),
            contentDescription = Words.Shell.account,
            tint = CommishTheme.colors.ink2,
            modifier = Modifier.size(26.dp),
        )
    }
}

/** The player search across the bar: what is typed opens the Players screen with it. */
@Composable
private fun SearchField(
    query: String,
    onQuery: (String) -> Unit,
    submit: (String) -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    BasicTextField(
        value = query,
        onValueChange = onQuery,
        singleLine = true,
        textStyle = Faces.body.copy(color = c.ink),
        cursorBrush = SolidColor(c.accent),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { submit(query) }),
        modifier =
            Modifier
                .fillMaxWidth()
                .height(CONTROL_H)
                .semantics { contentDescription = Words.Shell.searchPlayers },
        decorationBox = { field ->
            Row(
                Modifier
                    .background(c.surface, shape)
                    .border(1.dp, c.line, shape)
                    .fillMaxWidth()
                    .height(CONTROL_H)
                    .padding(horizontal = Tokens.Space.s3.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
            ) {
                Icon(painterResource(R.drawable.icon_search), null, Modifier.size(16.dp), tint = c.ink3)
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) Text(Words.Shell.searchPlayers, style = Faces.body, color = c.ink3)
                    field()
                }
            }
        },
    )
}
