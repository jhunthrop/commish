package app.trycommish.feature.leaguehome

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.trycommish.core.leaguehome.DraftDayEntry
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Tokens
import app.trycommish.design.Verb

/** The League home's draft-day word (SeasonPanel.svelte, draft_day), the iOS DraftDayPanel's: on the
 * accent's edge, when the draft is, that the site turns to the season after it, and the one verb that opens
 * the Advisor. */
@Composable
fun DraftDayPanel(
    entry: DraftDayEntry,
    openAdvisor: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(
        Modifier
            .padding(horizontal = Tokens.Space.s4.dp)
            .fillMaxWidth()
            .background(c.surface, shape)
            .border(2.dp, c.accent, shape)
            .padding(Tokens.Space.s3.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
            Text(entry.lead, style = Faces.body.copy(fontWeight = FontWeight.SemiBold), color = c.ink)
            Text(entry.line, style = Faces.small, color = c.ink2)
        }
        Verb(entry.verb, onClick = openAdvisor)
    }
}
