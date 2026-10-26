package app.trycommish.core

import app.trycommish.design.Words
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.CopyOnWriteArrayList

/** Which account the app shows, for the pieces that hold one (the shell): a generation that moves at each
 * sign-in and sign-out, and a hook run the moment the phone signs out, before anything else happens. */
interface AccountGeneration {
    /** Moves as the phone signs in and as it signs out, never on a read of the same account (iOS's
     * AppSession.generation). */
    val generation: StateFlow<Int>

    /** Runs `hook` each time the phone signs out, at once and before the logout URL opens; closing the
     * handle stops it. */
    fun onSignOut(hook: () -> Unit): AutoCloseable
}

/**
 * Whether the phone is signed in, and what the sign-in screen says, as the shell reads them: the one place
 * the app's sign-in state turns. A deliberate sign out returns to sign-in with nothing said; a token the
 * API refused returns with "Your sign-in on this phone has run out."; a sign-in that finished clears both.
 * A sign-out lets the account go in this order: the token and the kept answers, then the signed-in flag
 * and the generation, then every sign-out hook (the shell forgets the account), and only then the WorkOS
 * logout URL opens with `openLogout` (B228).
 */
class SignInState(
    private val session: Session,
    private val cache: Cache,
    private val signOutSession: SignOut,
    private val openLogout: (url: String) -> Unit = {},
) : AccountGeneration {
    private val signedInState = MutableStateFlow(session.token != null)
    private val messageState = MutableStateFlow<String?>(null)
    private val generationState = MutableStateFlow(0)
    private val hooks = CopyOnWriteArrayList<() -> Unit>()

    /** Whether the device holds a token, for the tabs that need one. */
    val signedIn: StateFlow<Boolean> = signedInState.asStateFlow()

    /** What the sign-in screen says about the last attempt or the last sign-out, if anything. */
    val message: StateFlow<String?> = messageState.asStateFlow()

    /** Which account the shell shows, so it rebuilds every tab per account and no screen's state passes
     * from one member to the next on a shared phone. */
    override val generation: StateFlow<Int> = generationState.asStateFlow()

    override fun onSignOut(hook: () -> Unit): AutoCloseable {
        hooks += hook
        return AutoCloseable { hooks -= hook }
    }

    /** Whether the phone holds a sign-in right now (the session's token, not the flow, which turns after). */
    fun holdsToken(): Boolean = session.token != null

    /** The API refused the token: forget it and every kept answer, and ask for a sign-in. A refusal that
     * reaches a phone already signed out (a read sent before a deliberate sign-out, answered after it) is
     * no news: nothing is said and nothing moves. */
    val sessionEnd =
        SessionEnd {
            if (!signedInState.value) return@SessionEnd
            session.signOut()
            cache.clear()
            messageState.value = AppWords.signedOut
            signedOutNow()
        }

    /** The member signs this phone out: the API forgets its sign-in when it can be reached, the phone forgets
     * its token and every kept answer whatever the API said, the app returns to sign-in, and then the WorkOS
     * logout opens when the API answered one. */
    suspend fun signOut() {
        val logout =
            try {
                signOutSession()
            } finally {
                messageState.value = null
                signedOutNow()
            }
        logout?.let(openLogout)
    }

    /** The account was deleted (POST /me/delete answered 204): the phone forgets its token and every kept
     * answer as a sign-out does, with nothing to revoke (the API deleted every device) and no sign-in
     * provider's logout (the API deleted the user), and the sign-in screen says so until the next sign-in.
     * The account is let go in the sign-out's order: the token and the kept answers, then the signed-in flag,
     * the generation and every sign-out hook (the shell forgets the account). The line is held in memory
     * only, so it does not outlast this launch. */
    fun deleted() {
        session.signOut()
        cache.clear()
        messageState.value = Words.DeleteAccount.doneTitle
        signedOutNow()
    }

    /** A sign-in finished: the tabs read the account. */
    fun signedInNow() {
        messageState.value = null
        if (!signedInState.value) generationState.value++
        signedInState.value = true
    }

    /** Signed out, then the generation moved, then every hook ran, so nothing reads or shows the account
     * again for a phone that has already let its token go. */
    private fun signedOutNow() {
        val was = signedInState.value
        signedInState.value = false
        if (!was) return
        generationState.value++
        hooks.forEach { it() }
    }

    /** A sign-in did not finish: the screen says why. */
    fun refused(message: String) {
        messageState.value = message
    }
}
