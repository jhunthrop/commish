package app.trycommish.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
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
import app.trycommish.core.signin.SignIn
import app.trycommish.core.signin.SignInResult
import app.trycommish.core.signin.SignInWords
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Mark
import app.trycommish.design.Tokens

/**
 * Sign-in through the system browser: a Custom Tab opens the API's login with the PKCE challenge, and
 * the API's return (the app link https://trycommish.app/app/signed-in?code=...) comes back to
 * MainActivity, which hands it here to trade for the device token.
 */
class SignInFlow(
    private val signIn: SignIn,
    private val returnTo: String = BuildConfig.RETURN_TO,
) {
    fun launch(context: Context) {
        CustomTabsIntent
            .Builder()
            .setShowTitle(true)
            .build()
            .launchUrl(context, Uri.parse(signIn.start()))
    }

    /** The app's return link an intent carries, null for any other intent. */
    fun returnLink(intent: Intent?): String? = intent?.data?.toString()?.takeIf { it.startsWith(returnTo) }

    suspend fun complete(link: String): SignInResult = signIn.complete(link)
}

/** The League tab signed out: what signing in does, and the one verb. */
@Composable
fun SignInScreen(
    message: String?,
    onSignIn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(
        modifier.fillMaxSize().padding(Tokens.Space.s5.dp),
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
