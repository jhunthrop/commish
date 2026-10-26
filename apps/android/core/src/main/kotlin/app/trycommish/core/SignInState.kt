package app.trycommish.core

import app.trycommish.design.Words
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Whether the phone is signed in, and what the sign-in screen says, as the shell reads them: the one place
 * the app's sign-in state turns. A deliberate sign out returns to sign-in with nothing said; a token the
 * API refused returns with "Your sign-in on this phone has run out."; a sign-in that finished clears both.
 */
class SignInState(
    private val session: Session,
    private val cache: Cache,
    private val signOutSession: SignOut,
) {
    private val signedInState = MutableStateFlow(session.token != null)
    private val messageState = MutableStateFlow<String?>(null)

    /** Whether the device holds a token, for the tabs that need one. */
    val signedIn: StateFlow<Boolean> = signedInState.asStateFlow()

    /** What the sign-in screen says about the last attempt or the last sign-out, if anything. */
    val message: StateFlow<String?> = messageState.asStateFlow()

    /** Whether the phone holds a sign-in right now (the session's token, not the flow, which turns after). */
    fun holdsToken(): Boolean = session.token != null

    /** The API refused the token: forget it and every kept answer, and ask for a sign-in. */
    val sessionEnd =
        SessionEnd {
            session.signOut()
            cache.clear()
            messageState.value = AppWords.signedOut
            signedInState.value = false
        }

    /** The member signs this phone out: the API forgets its sign-in when it can be reached, the phone forgets
     * its token and every kept answer whatever the API said, and the app returns to sign-in. */
    suspend fun signOut() {
        try {
            signOutSession()
        } finally {
            messageState.value = null
            signedInState.value = false
        }
    }

    /** The account was deleted (POST /me/delete answered 204): the phone forgets its token and every kept
     * answer as a sign-out does, with nothing to revoke (the API deleted every device) and no sign-in
     * provider's logout (the API deleted the user), and the sign-in screen says so until the next sign-in.
     * The line is held in memory only, so it does not outlast this launch. */
    fun deleted() {
        session.signOut()
        cache.clear()
        messageState.value = Words.DeleteAccount.doneTitle
        signedInState.value = false
    }

    /** A sign-in finished: the tabs read the account. */
    fun signedInNow() {
        messageState.value = null
        signedInState.value = true
    }

    /** A sign-in did not finish: the screen says why. */
    fun refused(message: String) {
        messageState.value = message
    }
}
