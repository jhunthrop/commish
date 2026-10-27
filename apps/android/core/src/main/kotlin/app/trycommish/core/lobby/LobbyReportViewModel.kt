package app.trycommish.core.lobby

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.models.LobbyRoom
import app.trycommish.api.models.MockCreate
import app.trycommish.api.models.MockReport
import app.trycommish.core.SessionEnd
import app.trycommish.core.companion.DraftReportModel
import app.trycommish.core.mock.MockReads
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface LobbyReportState {
    data object Loading : LobbyReportState

    data class Report(
        val report: DraftReportModel,
        /** The quiet verb's words: the same draft against bots from the slot. */
        val solo: String,
    ) : LobbyReportState

    data class Failed(
        val sentence: String,
    ) : LobbyReportState
}

/**
 * The lobby's report (web/src/routes/lobby/[id]/report), the iOS LobbyReportViewModel's: the room and its report
 * read together, the mock report's box score with the people's names in the field and "2 drafters, 10 bots" in its
 * cells; its verbs are the way back to the lobbies and the same draft against bots from the slot. The web's lobby
 * report has no share link, so neither has this.
 */
class LobbyReportViewModel(
    val id: String,
    private val reads: LobbyReads,
    private val mocks: MockReads,
    private val sessionEnd: SessionEnd,
) : ViewModel() {
    private val mutableState = MutableStateFlow<LobbyReportState>(LobbyReportState.Loading)
    private val mutableStarting = MutableStateFlow(false)
    private val mutableProblem = MutableStateFlow<String?>(null)
    private var report: MockReport? = null

    val state: StateFlow<LobbyReportState> = mutableState.asStateFlow()
    val starting: StateFlow<Boolean> = mutableStarting.asStateFlow()

    /** A start that did not go, in the API's words. */
    val problem: StateFlow<String?> = mutableProblem.asStateFlow()

    fun load(): Job =
        viewModelScope.launch {
            try {
                val (room, answer) =
                    coroutineScope {
                        val room = async { reads.lobby(id) }
                        val answer = async { reads.report(id) }
                        room.await() to answer.await()
                    }
                report = answer
                mutableState.value = LobbyReportState.Report(model(answer, room), LobbyWords.soloAgain(answer.slot))
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                if (LobbyRefusal.signsOut(e)) sessionEnd.signedOut()
                mutableState.value = LobbyReportState.Failed(LobbyRefusal.sentence(e))
            }
        }

    /** The same draft against bots from the slot (actions.ts runAgain): the new mock's id to `opened`. */
    fun runSolo(opened: (String) -> Unit): Job? {
        val report = report ?: return null
        if (mutableStarting.value) return null
        mutableStarting.value = true
        mutableProblem.value = null
        return viewModelScope.launch {
            try {
                mocks.create(MockCreate(settings = report.settings.copy(slot = report.slot))).id?.let { opened(it.toString()) }
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                if (LobbyRefusal.signsOut(e)) sessionEnd.signedOut()
                mutableProblem.value = LobbyRefusal.sentence(e)
            } finally {
                mutableStarting.value = false
            }
        }
    }

    companion object {
        /** The report as the lobby's page draws it: each seat's name (You, a handle, Bot N), the seats cell. The
         * report is the seat's own, so its names say You at its slot. */
        fun model(
            report: MockReport,
            room: LobbyRoom,
        ): DraftReportModel {
            val names =
                (1..maxOf(room.teams, 1)).map { seat ->
                    room.seats.firstOrNull { it.seat == seat }?.let { LobbySeats.name(it, report.slot) } ?: LobbyWords.bot(seat)
                }
            val people = LobbySeats.people(room.seats.map(LobbySeats::kind))
            return DraftReportModel.of(report, names, LobbyWords.seats(people, report.teams), Words.Mock.reshuffled)
        }
    }
}
