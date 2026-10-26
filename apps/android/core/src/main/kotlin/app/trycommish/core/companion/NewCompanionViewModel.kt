package app.trycommish.core.companion

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.CompanionCreate
import app.trycommish.api.models.CompanionHost
import app.trycommish.api.models.CompanionSeat
import app.trycommish.core.SessionEnd
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A followed draft as the start page lists it (model.ts recentLine). */
data class RecentDraft(
    val id: String,
    val lead: String,
    val text: String,
)

/** How the member says which seat is theirs. */
enum class SeatBy { Slot, Username }

/** The start page's form and what it has read: the link, the seat, the API's sentence under the verb, and
 * the drafts followed before. */
data class NewCompanionForm(
    val link: String,
    val seat: SeatBy = SeatBy.Slot,
    val slot: Int = 1,
    val username: String = "",
    val busy: Boolean = false,
    val problem: String? = null,
    val recent: List<RecentDraft> = emptyList(),
    val recentFailed: Boolean = false,
    /** The draft just followed, for the screen to open while it is on screen, then [NewCompanionViewModel.opened]. */
    val followed: String? = null,
) {
    /** The verb is ready with a link and, by username, a name. */
    val ready: Boolean get() = link.isNotBlank() && (seat == SeatBy.Slot || username.isNotBlank()) && !busy
}

/**
 * The companion's start page (NewCompanion.svelte), the iOS NewCompanionViewModel's: paste the Sleeper
 * draft link, say which seat is yours by slot or by your Sleeper username, one verb; the drafts followed
 * before, a tap back to each. The username used last comes first. A development build that opened the page
 * with the replay asks the API's recorded draft, whatever the link says (COMPANION_REPLAY, refused by any
 * other API).
 */
class NewCompanionViewModel(
    private val reads: CompanionReads,
    private val sessionEnd: SessionEnd,
    val replay: Boolean = false,
) : ViewModel() {
    private val mutableForm = MutableStateFlow(NewCompanionForm(link = if (replay) Words.CompanionNew.replay else ""))
    private var following: Job? = null

    val form: StateFlow<NewCompanionForm> = mutableForm.asStateFlow()

    fun type(link: String) = mutableForm.update { it.copy(link = link) }

    fun seat(seat: SeatBy) = mutableForm.update { it.copy(seat = seat) }

    fun slot(slot: Int) = mutableForm.update { if (slot in SLOTS) it.copy(slot = slot) else it }

    fun username(name: String) = mutableForm.update { it.copy(username = name) }

    /** The drafts followed before; a failure leaves the form working and says the list is missing. */
    fun load(): Job =
        viewModelScope.launch {
            try {
                val summaries = reads.recent()
                val used = summaries.firstNotNullOfOrNull { it.hostUsername }
                mutableForm.update { form ->
                    val recent =
                        summaries.map {
                            RecentDraft(
                                it.id.toString(),
                                CompanionWords.recentLine(it).lead,
                                CompanionWords.recentLine(it).text,
                            )
                        }
                    val named = if (used != null && form.username.isEmpty()) form.copy(seat = SeatBy.Username, username = used) else form
                    named.copy(recent = recent, recentFailed = false)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Unauthorized) {
                sessionEnd.signedOut()
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                mutableForm.update { it.copy(recentFailed = true) }
            }
        }

    /** Follows the draft from the seat chosen: its id is [NewCompanionForm.followed] for the screen to open
     * while it is on screen (never onto another tab), else the API's sentence (or the web's own) is said
     * under the verb. A follow already running is let go first. */
    fun follow(): Job? {
        val form = mutableForm.value
        if (!form.ready) return null
        following?.cancel()
        mutableForm.update { it.copy(busy = true, problem = null) }
        val body =
            CompanionCreate(
                host = CompanionHost.sleeper,
                draft = form.link.trim(),
                seat = if (form.seat == SeatBy.Slot) CompanionSeat(slot = form.slot) else CompanionSeat(username = form.username.trim()),
                replay = if (replay) true else null,
            )
        return viewModelScope
            .launch {
                var followed: String? = null
                val problem =
                    try {
                        followed = reads.follow(body).id.toString()
                        null
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Unauthorized) {
                        sessionEnd.signedOut()
                        null
                    } catch (e: ApiFailure) {
                        e.refusal().ifEmpty { Words.CompanionNew.failed }
                    } catch (
                        @Suppress("TooGenericExceptionCaught") e: Exception,
                    ) {
                        Words.CompanionNew.failed
                    }
                mutableForm.update { it.copy(busy = false, problem = problem, followed = followed) }
            }.also { following = it }
    }

    /** The screen opened the draft just followed. */
    fun opened() = mutableForm.update { it.copy(followed = null) }

    companion object {
        /** setup.ts MAX_TEAMS: every slot a league can have, one chip each. */
        val SLOTS: List<Int> = (1..14).toList()
    }
}
