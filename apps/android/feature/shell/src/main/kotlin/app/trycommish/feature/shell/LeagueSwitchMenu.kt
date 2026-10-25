package app.trycommish.feature.shell

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.trycommish.core.shell.LeagueSwitchModel
import app.trycommish.core.shell.LeagueSwitchRow
import app.trycommish.design.Basis
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Tokens

/** A row's least height, a tap target. */
private val ROW_MIN = 48.dp

/** The selected row's mark at its leading edge. */
private val MARK_W = 3.dp

/**
 * The switch opened, under the bar across the screen as the web's menu is on a phone (LeagueMenu.svelte):
 * a raised panel listing every followed league in GET /me's order, the selected one marked in place,
 * its platform and scoring under its name and its phase beside it where the leagues differ, one tap
 * each to its home. With none followed, where to follow one.
 */
@Composable
fun LeagueSwitchMenu(
    model: LeagueSwitchModel,
    choose: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Surface(
        shape = RoundedCornerShape(Tokens.Radius.md.dp),
        color = c.bg,
        border = BorderStroke(1.dp, c.lineStrong),
        shadowElevation = 8.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(Tokens.Space.s3.dp),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
        ) {
            val none = model.none
            if (none != null) {
                Basis(none)
            } else {
                Text(
                    model.title.uppercase(),
                    style = Faces.label,
                    color = c.ink3,
                    modifier = Modifier.padding(horizontal = Tokens.Space.s3.dp).semantics { heading() },
                )
                model.rows.forEach { row -> SwitchRow(row) { choose(row.id) } }
            }
        }
    }
}

/** One league: its name with its phase at the name's end, its platform and scoring on the line under. */
@Composable
private fun SwitchRow(
    row: LeagueSwitchRow,
    choose: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.sm.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .heightIn(min = ROW_MIN)
            .clip(shape)
            .background(if (row.selected) c.surface else c.bg)
            .selectable(selected = row.selected, role = Role.RadioButton, onClick = choose),
    ) {
        Box(Modifier.width(MARK_W).fillMaxHeight().background(if (row.selected) c.accent else c.bg))
        Column(
            Modifier.padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp), verticalAlignment = Alignment.Bottom) {
                Text(
                    row.name,
                    style = Faces.body.copy(fontWeight = FontWeight.SemiBold),
                    color = c.ink,
                    modifier = Modifier.weight(1f, fill = false),
                )
                row.phase?.let { Text(it, style = Faces.small.copy(fontWeight = FontWeight.Medium), color = c.ink2, maxLines = 1) }
            }
            Text(row.line, style = Faces.small, color = c.ink2)
        }
    }
}
