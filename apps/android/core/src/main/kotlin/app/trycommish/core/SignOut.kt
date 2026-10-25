package app.trycommish.core

import kotlinx.coroutines.CancellationException

/**
 * The member signs this phone out: the API forgets its sign-in (DELETE /devices/{this id}) when it can be
 * reached, and the phone forgets its token and every kept answer whatever the API said. `revoke` is the
 * device's revoke call; a failure goes to `onError` (the app's log) and the phone still signs out.
 */
class SignOut(
    private val session: Session,
    private val cache: Cache,
    private val revoke: suspend (deviceId: String) -> Unit,
    private val onError: (Exception) -> Unit = {},
) {
    suspend operator fun invoke() {
        try {
            session.deviceId?.let { revoke(it) }
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            onError(e)
        } finally {
            session.signOut()
            cache.clear()
        }
    }
}
