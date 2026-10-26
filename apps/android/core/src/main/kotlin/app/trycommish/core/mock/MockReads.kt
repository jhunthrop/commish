package app.trycommish.core.mock

import app.trycommish.api.ApiFailure
import app.trycommish.api.Transport
import app.trycommish.api.data
import app.trycommish.api.models.League
import app.trycommish.api.models.MockCreate
import app.trycommish.api.models.MockPickInput
import app.trycommish.api.models.MockQueueInput
import app.trycommish.api.models.MockReport
import app.trycommish.api.models.MockRoom
import app.trycommish.api.models.MockUndoInput
import app.trycommish.api.models.RoomCard
import java.util.UUID

/**
 * The solo mock's calls (web/src/lib/room/api.ts `rooms`), the iOS MockAPI's: start a mock, read it, draft,
 * take a pick back, Pick for me, Finish, the queue, the turn's call, the report, a shared draft by its link's
 * code, and the account's saved leagues a mock reruns from. Every write answers the room as it stands after
 * it, so the screen is rebuilt from the answer, never from a guess. A 401 throws
 * [app.trycommish.api.Unauthorized], any other refusal [ApiFailure] with the API's sentence. The seam the
 * view models' tests replace with a stub.
 */
interface MockReads {
    /** POST /mocks: the room at the drafter's first turn, the board with it. */
    suspend fun create(body: MockCreate): MockRoom

    /** GET /mocks/{id}: the room as it stands, the board with it. */
    suspend fun mock(id: String): MockRoom

    /** POST /mocks/{id}/picks: the pick at the overall pick the drafter saw, the bots to his next turn. */
    suspend fun pick(
        id: String,
        player: String,
        at: Int,
    ): MockRoom

    /** POST /mocks/{id}/undo: one of the drafter's picks taken back, with every pick after it. */
    suspend fun undo(
        id: String,
        pick: Int,
    ): MockRoom

    /** POST /mocks/{id}/autopick?to_round=: the drafter's turns through that round made for him. */
    suspend fun autopick(
        id: String,
        toRound: Int,
    ): MockRoom

    /** POST /mocks/{id}/finish: every remaining turn made for him. */
    suspend fun finish(id: String): MockRoom

    /** PUT /mocks/{id}/queue: the whole queue, best first. */
    suspend fun queue(
        id: String,
        players: List<String>,
    ): MockRoom

    /** GET /mocks/{id}/card: our call at the turn on the clock. */
    suspend fun card(id: String): RoomCard

    /** GET /mocks/{id}/report: the finished draft's report. */
    suspend fun report(id: String): MockReport

    /** GET /shared/mocks/{code}: a shared draft replayed, the board with it. */
    suspend fun shared(code: String): MockRoom

    /** GET /shared/mocks/{code}/report: a shared, finished draft's report. */
    suspend fun sharedReport(code: String): MockReport

    /** GET /leagues: the account's saved leagues, newest first. */
    suspend fun leagues(): List<League>
}

/** The calls through the generated client. */
class ApiMockReads(
    private val transport: Transport,
) : MockReads {
    private val mocks get() = transport.mocks()

    override suspend fun create(body: MockCreate): MockRoom = mocks.createMock(body).data()

    override suspend fun mock(id: String): MockRoom = mocks.getMock(uuid(id)).data()

    override suspend fun pick(
        id: String,
        player: String,
        at: Int,
    ): MockRoom = mocks.pickMock(uuid(id), MockPickInput(player, at)).data()

    override suspend fun undo(
        id: String,
        pick: Int,
    ): MockRoom = mocks.undoMock(uuid(id), MockUndoInput(pick)).data()

    override suspend fun autopick(
        id: String,
        toRound: Int,
    ): MockRoom = mocks.autopickMock(uuid(id), toRound).data()

    override suspend fun finish(id: String): MockRoom = mocks.finishMock(uuid(id)).data()

    override suspend fun queue(
        id: String,
        players: List<String>,
    ): MockRoom = mocks.queueMock(uuid(id), MockQueueInput(players)).data()

    override suspend fun card(id: String): RoomCard = mocks.mockCard(uuid(id)).data()

    override suspend fun report(id: String): MockReport = mocks.mockReport(uuid(id)).data()

    override suspend fun shared(code: String): MockRoom = mocks.sharedMock(code).data()

    override suspend fun sharedReport(code: String): MockReport = mocks.sharedMockReport(code).data()

    override suspend fun leagues(): List<League> = transport.leagues().listLeagues(null, null).data()

    /** A mock's id; one that is no uuid (a hand-made link) is a mock the account does not hold. */
    private fun uuid(id: String): UUID =
        try {
            UUID.fromString(id)
        } catch (e: IllegalArgumentException) {
            throw ApiFailure(HTTP_NOT_FOUND, "not_found", e.message.orEmpty())
        }

    private companion object {
        const val HTTP_NOT_FOUND = 404
    }
}
