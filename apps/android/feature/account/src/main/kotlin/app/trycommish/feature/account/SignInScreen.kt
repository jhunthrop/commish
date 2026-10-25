package app.trycommish.feature.account

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.trycommish.core.signin.SignInWords
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Mark
import app.trycommish.design.Tokens

/** The League tab signed out, where sign out returns the phone: what signing in does, and the one verb.
 * Beside the Account (as the iOS SignInView, Lane 198) so its snapshot is the signed-out return's mock. */
@Composable
fun SignInScreen(
    message: String?,
    onSignIn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(
        modifier.fillMaxSize().background(c.bg).padding(Tokens.Space.s5.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Mark(size = 64.dp)
        Spacer(Modifier.height(Tokens.Space.s5.dp))
        Text(SignInWords.lead, style = Faces.body, color = c.ink2, textAlign = TextAlign.Center)
        if (message != null) {
            Spacer(Modifier.height(Tokens.Space.s3.dp))
            Text(message, style = Faces.small, color = c.lossInk, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(Tokens.Space.s5.dp))
        Button(onClick = onSignIn, shape = RoundedCornerShape(Tokens.Radius.md.dp), modifier = Modifier.fillMaxWidth().height(48.dp)) {
            Text(SignInWords.signIn, style = Faces.body)
        }
    }
}
