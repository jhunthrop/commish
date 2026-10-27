package app.trycommish.core.account

import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.core.AppWords
import app.trycommish.core.SessionEnd
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The confirmation dialog's state: the account's email, the email typed so far, whether the delete is under
 * way, and the API's sentence for one that did not go through. */
data class DeletionUi(
    val email: String,
    val typed: String = "",
    val busy: Boolean = false,
    val problem: String? = null,
) {
    /** "Signed in as <email>", the line above the field (DeleteView.svelte). */
    val signedIn: String get() = "${Words.DeleteAccount.signedInAs} $email"

    /** Whether the verb may run: the typed email is the account's and no delete is under way. */
    val canDelete: Boolean get() = !busy && AccountDeletion.confirmed(typed, email)
}

/**
 * The Account's delete dialog (web/src/lib/account/DeleteView.svelte, the iOS DeleteAccountViewModel): what
 * goes and what stays, the email typed by hand, and one verb that waits for it to be the account's (the web's
 * `confirmed`, the API's deletion.Confirmed). The call runs with the device token; a 204 hands the phone to
 * `deleted` (the sign-in state forgets it as a sign-out does), a refusal says the API's sentence, a refused
 * token ends the session. Owned by the Account's view model, so the dialog outlives a rotation.
 */
class AccountDeletion(
    private val reads: AccountScreenReads,
    private val scope: CoroutineScope,
    private val sessionEnd: SessionEnd,
    private val deleted: () -> Unit,
) {
    private val state = MutableStateFlow<DeletionUi?>(null)

    /** The dialog while it is open; null while it is closed. */
    val ui: StateFlow<DeletionUi?> = state.asStateFlow()

    /** Opens the dialog for the account's email, nothing typed. */
    fun open(email: String) {
        state.value = DeletionUi(email)
    }

    /** Closes the dialog, unless a delete is under way. */
    fun close() {
        if (state.value?.busy == true) return
        state.value = null
    }

    fun type(text: String) = state.update { it?.copy(typed = text) }

    /** Deletes the account with the typed email, once it matches. */
    fun delete(): Job? {
        val shown = state.value ?: return null
        if (!shown.canDelete) return null
        state.value = shown.copy(busy = true, problem = null)
        return scope.launch {
            val problem = attempt(shown.typed)
            if (problem == null) {
                state.value = null
                deleted()
            } else {
                state.update { it?.copy(busy = false, problem = problem) }
            }
        }
    }

    /** The delete's failure in words, or null when the API answered 204. */
    private suspend fun attempt(typed: String): String? =
        try {
            reads.deleteAccount(typed)
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            sessionEnd.signedOut()
            AppWords.signedOut
        } catch (e: ApiFailure) {
            e.message.ifEmpty { Words.DeleteAccount.failed }
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            Words.DeleteAccount.failed
        }

    companion object {
        /** The web's rule: the typed email is the account's, without regard to case or the spaces around it. */
        fun confirmed(
            typed: String,
            email: String,
        ): Boolean {
            val t = typed.trim()
            return t.isNotEmpty() && t.lowercase() == email.trim().lowercase()
        }
    }
}
