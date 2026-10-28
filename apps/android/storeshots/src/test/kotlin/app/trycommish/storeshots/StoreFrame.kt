package app.trycommish.storeshots

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Mark
import app.trycommish.design.RailItem
import app.trycommish.feature.shell.PhoneTabBar
import app.trycommish.feature.shell.TopBar
import app.trycommish.feature.shell.TopBarActions

/** The app's own bars around a screen: the top bar with the league's face, the phone's five at the foot
 * with the screen's tab lit (none for a pushed page). */
class StoreChrome(
    val face: String,
    val bar: List<RailItem>,
    val tab: String?,
)

private val CAPTION = TextStyle(fontFamily = Faces.ui, fontWeight = FontWeight.SemiBold, fontSize = 30.sp, lineHeight = 36.sp)
private val WORDMARK = TextStyle(fontFamily = Faces.ui, fontWeight = FontWeight.SemiBold, fontSize = 76.sp, letterSpacing = (-1).sp)
private val PHONE_CORNER = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
private val CAPTION_MARK = 30.dp
private val FEATURE_MARK = 112.dp

/**
 * One store screenshot: the whistle and the caption on the surface, the screen below it as the phone
 * draws it (its bars where the app has them), the phone's foot running off the bottom edge.
 */
@Composable
fun StoreShotFrame(
    caption: String,
    chrome: StoreChrome?,
    screen: @Composable () -> Unit,
) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxSize().background(c.surface)) {
        Column(Modifier.padding(start = 32.dp, end = 32.dp, top = 36.dp, bottom = 28.dp)) {
            Mark(CAPTION_MARK)
            Text(caption, style = CAPTION, color = c.ink, modifier = Modifier.padding(top = 14.dp))
        }
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .clip(PHONE_CORNER)
                .border(1.dp, c.lineStrong, PHONE_CORNER)
                .background(c.bg),
        ) {
            chrome?.let { TopBar(it.face, false, "", {}, TopBarActions({}, {}, {}), Modifier.background(c.shell)) }
            Box(Modifier.weight(1f).fillMaxWidth()) { screen() }
            chrome?.let { PhoneTabBar(it.bar, it.tab) {} }
        }
    }
}

/** The feature graphic: the whistle and the name on the dark page, nothing else. */
@Composable
fun FeatureGraphic() {
    val c = CommishTheme.colors
    Row(
        Modifier.fillMaxSize().background(c.bg),
        horizontalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Mark(FEATURE_MARK)
        Text("Commish", style = WORDMARK, color = c.ink)
    }
}
