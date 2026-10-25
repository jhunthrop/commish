package app.trycommish.feature.boxscore

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.trycommish.core.AppWords
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Mark
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens

/** An in-season screen with nothing to draw: the mark, the sentence for why, and the way to read again
 * where there is one. Scrolls, so a pull reads again. */
@Composable
fun ScreenFailed(
    message: String,
    retry: (() -> Unit)?,
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Tokens.Space.s5.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Mark(size = 48.dp)
        Spacer(Modifier.height(Tokens.Space.s4.dp))
        Text(message, style = Faces.body, color = CommishTheme.colors.ink2, textAlign = TextAlign.Center)
        retry?.let { QuietButton(AppWords.tryAgain, onClick = it) }
    }
}
