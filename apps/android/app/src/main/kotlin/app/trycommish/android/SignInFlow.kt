package app.trycommish.android

import android.content.Context
import android.content.Intent
import app.trycommish.core.signin.SignIn
import app.trycommish.core.signin.SignInResult

/**
 * Sign-in through the system browser: a Custom Tab opens the API's login with the PKCE challenge, and
 * the API's return (the app link https://trycommish.app/app/signed-in?code=...) comes back to
 * MainActivity, which hands it here to trade for the device token.
 */
class SignInFlow(
    private val signIn: SignIn,
    private val returnTo: String = BuildConfig.RETURN_TO,
    private val onError: (Exception) -> Unit = {},
) {
    /** Opens the login in the ephemeral tab, so a sign-in never reuses a WorkOS session an earlier one left
     * in the browser (B168); a tab that cannot open goes to `onError`. */
    fun launch(context: Context) {
        openEphemeral(context, signIn.start(), newTask = false, onError = onError)
    }

    /** The app's return link an intent carries, null for any other intent. */
    fun returnLink(intent: Intent?): String? = intent?.data?.toString()?.takeIf { it.startsWith(returnTo) }

    suspend fun complete(link: String): SignInResult = signIn.complete(link)
}
