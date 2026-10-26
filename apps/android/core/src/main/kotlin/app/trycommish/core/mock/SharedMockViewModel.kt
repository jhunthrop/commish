package app.trycommish.core.mock

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.ApiFailure
import app.trycommish.api.models.MockCreate
import app.trycommish.api.models.MockRoom
import app.trycommish.api.models.MockStatus
import app.trycommish.core.companion.DraftReportModel
import app.trycommish.core.companion.Drafter
import app.trycommish.core.companion.RoomBoardView
import app.trycommish.core.companion.RoomDraft
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface SharedMockState {
    data object Loading : SharedMockState

    data class Room(
        val model: MockRoomModel,
    ) : SharedMockState

    data class Report(
        val report: DraftReportModel,
        val verb: String,
    ) : SharedMockState

    data class Failed(
        val sentence: String,
    ) : SharedMockState
}

/**
 * A shared draft opened from its link's code (web/src/routes/mock/share/[code]), the iOS SharedMockViewModel's:
 * the room as it stood, read and never drafted in, or the report once it is finished; its one verb runs the
 * same settings and seed as the reader's own mock from the drafter's slot.
 */
class SharedMockViewModel(
    val code: String,
    private val reads: MockReads,
) : ViewModel() {
    private val mutableState = MutableStateFlow<SharedMockState>(SharedMockState.Loading)
    private val mutableStarting = MutableStateFlow(false)
    private val mutableProblem = MutableStateFlow<String?>(null)
    private var room: MockRoom? = null
    private var filter = RoomDraft.ALL

    val state: StateFlow<SharedMockState> = mutableState.asStateFlow()

    /** The verb's start is on its way. */
    val starting: StateFlow<Boolean> = mutableStarting.asStateFlow()

    /** A start that did not go, in the API's words. */
    val problem: StateFlow<String?> = mutableProblem.asStateFlow()

    fun load(): Job =
        viewModelScope.launch {
            try {
                val read = reads.shared(code)
                room = read
                if (read.status == MockStatus.complete) {
                    val report = reads.sharedReport(code)
                    val drafter = Drafter(read.sharedBy)
                    mutableState.value =
                        SharedMockState.Report(
                            DraftReportModel.of(
                                report,
                                MockWords.seatNames(report.teams, report.slot, drafter),
                                Words.Mock.botsByAdp,
                                Words.Mock.reshuffled,
                                drafter,
                            ),
                            MockWords.runShared(report.slot),
                        )
                } else {
                    show()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                mutableState.value = SharedMockState.Failed(MockRoomViewModel.sentence(e))
            }
        }

    fun choose(filter: String) {
        this.filter = filter
        show()
    }

    /** Run this draft from the drafter's slot: the reader's own mock, the same settings and seed, its id to
     * `opened`. */
    fun run(opened: (String) -> Unit): Job? {
        val shared = room ?: return null
        if (mutableStarting.value) return null
        mutableStarting.value = true
        mutableProblem.value = null
        return viewModelScope.launch {
            try {
                reads
                    .create(MockCreate(settings = shared.settings.copy(slot = shared.slot), seed = shared.seed))
                    .id
                    ?.let { opened(it.toString()) }
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                mutableProblem.value = MockRoomViewModel.sentence(e)
            } finally {
                mutableStarting.value = false
            }
        }
    }

    /** A shared draft answered without its board cannot be drawn: it says so rather than spin. */
    private fun show() {
        val shared = room ?: return
        val board = shared.board
        if (board == null) {
            mutableState.value = SharedMockState.Failed(MockRoomViewModel.sentence(ApiFailure(0, "empty", "")))
            return
        }
        mutableState.value =
            SharedMockState.Room(
                MockRoomModel.of(
                    shared,
                    RoomBoardView.of(board, shared.teams),
                    null,
                    MockRoomUi(filter = filter),
                    Drafter(shared.sharedBy),
                ),
            )
    }
}
