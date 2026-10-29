package app.trycommish.feature.trades

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.R
import app.trycommish.design.Tokens
import app.trycommish.feature.boxscore.HEAD_TRACKING

private val FIELD_HEIGHT = 40.dp

/** One choice: its key and its words. */
data class Choice(
    val key: String,
    val label: String,
)

/** One group of choices under its heading (none for the first). */
data class ChoiceGroup(
    val title: String?,
    val choices: List<Choice>,
)

/** A select as the phone draws it (the web's PickSelect at 390): a box with the choice in it and its
 * chevron; a tap drops the choices under it (the platform's menu), each group under its heading, the
 * chosen one marked. */
@Composable
internal fun ChoiceField(
    label: String,
    value: String,
    chosen: String?,
    groups: List<ChoiceGroup>,
    modifier: Modifier = Modifier,
    choose: (String) -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    var open by remember { mutableStateOf(false) }
    var width by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    Box(modifier.onSizeChanged { width = it.width }) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = FIELD_HEIGHT)
                .clip(shape)
                .background(c.surface)
                .border(1.dp, c.lineStrong, shape)
                .clickable(role = Role.DropdownList) { open = true }
                .semantics {
                    contentDescription = label
                    stateDescription = value
                }.padding(horizontal = Tokens.Space.s3.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
        ) {
            // The choice whole, on a second line where it is long.
            Text(
                value,
                style = Faces.small.copy(fontWeight = FontWeight.SemiBold),
                color = c.ink,
                modifier = Modifier.weight(1f).padding(vertical = Tokens.Space.s1.dp),
            )
            Icon(painterResource(R.drawable.icon_chevron), contentDescription = null, tint = c.ink2, modifier = Modifier.size(14.dp))
        }
        // As wide as the field it drops from, as a select's choices are.
        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            containerColor = c.surface,
            modifier = Modifier.width(with(density) { width.toDp() }),
        ) {
            groups.forEachIndexed { index, group ->
                if (index > 0) HorizontalDivider(color = c.line)
                group.title?.let {
                    Text(
                        it.uppercase(),
                        style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em),
                        color = c.ink3,
                        modifier = Modifier.padding(horizontal = Tokens.Space.s4.dp, vertical = Tokens.Space.s2.dp).semantics { heading() },
                    )
                }
                group.choices.forEach { choice ->
                    val lit = choice.key == chosen
                    DropdownMenuItem(
                        text = {
                            Text(
                                choice.label,
                                style = Faces.body.copy(fontWeight = if (lit) FontWeight.SemiBold else FontWeight.Normal),
                                color = if (lit) c.accentText else c.ink,
                            )
                        },
                        onClick = {
                            open = false
                            choose(choice.key)
                        },
                        modifier = Modifier.semantics { selected = lit },
                    )
                }
            }
        }
    }
}
