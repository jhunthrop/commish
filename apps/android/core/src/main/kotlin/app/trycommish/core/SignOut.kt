package app.trycommish.core

import kotlinx.coroutines.CancellationException

/**
 * The member signs this phone out: the API forgets its sign-in (DELETE /devices/{this id}) when it can be
 * reached, and the phone forgets its token and every kept answer whatever the API said. `revoke` is the
 * device's revoke call, answering the WorkOS logout URL when the API has one (Lane 225). The URL is
 * returned, never opened here: SignInState opens it once the app has let the account go (B228). A failure
 * goes to `onError` (the app's log) and the phone still signs out, with nothing to open.
 */
class SignOut(
    private val session: Session,
    private val cache: Cache,
    private val revoke: suspend (deviceId: String) -> String?,
    private val onError: (Exception) -> Unit = {},
) {
    /** Signs out; the WorkOS logout URL to open, null when there is none. */
    suspend operator fun invoke(): String? =
        try {
            session.deviceId?.let { revoke(it) }
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            onError(e)
            null
        } finally {
            session.signOut()
            cache.clear()
        }
}
