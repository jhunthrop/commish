package app.trycommish.core.mock

import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.League
import app.trycommish.api.models.MockCreate
import app.trycommish.api.models.MockReport
import app.trycommish.api.models.MockRoom
import app.trycommish.api.models.RoomCard
import kotlinx.coroutines.CompletableDeferred
import java.io.File
import java.io.IOException
import java.time.Instant
import java.time.ZoneId

/**
 * The recorded mock draft (shared/fixtures/mock-room, web/scripts/record-mock-room.ts), the iOS MockFixture's:
 * two solo mocks on seed 213 against a local API, every answer the API's envelope as it answered.
 */
object MockFixtures {
    /** A room answer, in the order the draft was recorded. */
    enum class Answer(
        val file: String,
    ) {
        /** Slot 5 at its first turn, 1.05, the board with it and no card. */
        Create("create"),
        Pick1("pick-1"),
        Pick2("pick-2"),
        Pick3("pick-3"),

        /** 4.08 drafted: the room at 5.05. */
        Pick4("pick-4"),

        /** The room at 5.05 read whole, the board with it. */
        Round5("round5"),

        /** Three players queued at 5.05. */
        Queue("queue"),

        /** 4.08 taken back. */
        Undo("undo"),

        /** 4.08 drafted again. */
        PickAgain("pick-again"),

        /** Pick for me through round 8. */
        Autopick("autopick"),

        /** Finish the draft. */
        Finish("finish"),

        /** The draft at 5.05 read through its link. */
        SharedRound5("shared-round5"),

        /** The finished draft read through its link. */
        SharedComplete("shared-complete"),
    }

    /** The first mock's id in every answer. */
    const val ID = "98cd4c08-d008-455a-8e8b-2ad04ac81ae9"

    /** The member's zone the shots draw in. */
    val zone: ZoneId = ZoneId.of("America/Chicago")

    /** The draft was recorded on Sunday 2026-10-25 at 16:00 Central. */
    val readAt: Instant = Instant.parse("2026-10-25T21:00:00Z")

    private val folder = File(System.getProperty("fixtures"), "mock-room")

    fun body(file: String): String = File(folder, "$file.json").readText()

    fun room(answer: Answer): MockRoom = decodeEnvelope(body(answer.file))

    fun card(): RoomCard = decodeEnvelope(body("card-first"))

    /** The report at 1st of 12 ("report"), the one well down ("report-down", 12th of 12), the shared one. */
    fun report(name: String = "report"): MockReport = decodeEnvelope(body(name))

    /** The parity file the web wrote over this draft (shared/fixtures/parity/mock.json). */
    fun parity(): String = File(System.getProperty("fixtures"), "parity/mock.json").readText()
}

/**
 * The mock's reads over the recorded draft, the iOS StubMock's: the room read answers `opened`, each pick the
 * next of the recorded picks (after an undo, the pick drafted again), each write its recorded answer; with
 * `offline` every call fails with no connection; `refusal` refuses every write with the API's sentence;
 * `cardMissing` fails the card route; a call named in `held` waits until [release]. Records what was sent and
 * the order calls arrived.
 */
class StubMock(
    var opened: MockFixtures.Answer = MockFixtures.Answer.Create,
    private val signedOut: Boolean = false,
) : MockReads {
    val picks = mutableListOf<Pair<String, Int>>()
    val queues = mutableListOf<List<String>>()
    val undone = mutableListOf<Int>()
    val autopicks = mutableListOf<Int>()
    val created = mutableListOf<MockCreate>()
    val calls = mutableListOf<String>()
    var cards = 0
        private set
    var offline = false
    var refusal: String? = null
    var cardMissing = false

    /** Picks answered without the next turn's card, so the room reads it from the card route. */
    var pickWithoutCard = false

    /** The report read fails with no connection. */
    var reportFails = false

    /** The room read is refused with this status (403, 404). */
    var readRefused: Int? = null

    /** A start (POST /mocks) answers the API's 401. */
    var createSignedOut = false
    var saved: List<League> = emptyList()
    private var next =
        mutableListOf(MockFixtures.Answer.Pick1, MockFixtures.Answer.Pick2, MockFixtures.Answer.Pick3, MockFixtures.Answer.Pick4)
    private val held = mutableMapOf<String, CompletableDeferred<Unit>>()

    /** The calls by name ("mock", "pick", "queue", "card") held until released. */
    fun hold(name: String) {
        held[name] = CompletableDeferred()
    }

    fun release(name: String) {
        held.remove(name)?.complete(Unit)
    }

    /** The writes, in the order they reached the API. */
    val writes: List<String> get() = calls.filter { it == "queue" || it == "pick" }

    private suspend fun pass(name: String) {
        calls += name
        held[name]?.await()
    }

    override suspend fun create(body: MockCreate): MockRoom {
        pass("create")
        fail()
        if (createSignedOut) throw Unauthorized()
        created += body
        return MockFixtures.room(MockFixtures.Answer.Create)
    }

    override suspend fun mock(id: String): MockRoom {
        pass("mock")
        fail()
        readRefused?.let { throw ApiFailure(it, "not_found", "No mock with that id.") }
        return MockFixtures.room(opened)
    }

    override suspend fun pick(
        id: String,
        player: String,
        at: Int,
    ): MockRoom {
        pass("pick")
        write()
        picks += player to at
        val answer = MockFixtures.room(if (next.isEmpty()) MockFixtures.Answer.PickAgain else next.removeAt(0))
        return if (pickWithoutCard) answer.copy(card = null) else answer
    }

    override suspend fun undo(
        id: String,
        pick: Int,
    ): MockRoom {
        write()
        undone += pick
        next = mutableListOf(MockFixtures.Answer.PickAgain)
        return MockFixtures.room(MockFixtures.Answer.Undo)
    }

    override suspend fun autopick(
        id: String,
        toRound: Int,
    ): MockRoom {
        write()
        autopicks += toRound
        return MockFixtures.room(MockFixtures.Answer.Autopick)
    }

    override suspend fun finish(id: String): MockRoom {
        write()
        return MockFixtures.room(MockFixtures.Answer.Finish)
    }

    override suspend fun queue(
        id: String,
        players: List<String>,
    ): MockRoom {
        pass("queue")
        write()
        queues += players
        return MockFixtures.room(MockFixtures.Answer.Queue)
    }

    override suspend fun card(id: String): RoomCard {
        pass("card")
        fail()
        cards++
        if (cardMissing) throw ApiFailure(HTTP_UNAVAILABLE, "unavailable", "")
        return MockFixtures.card()
    }

    override suspend fun report(id: String): MockReport {
        fail()
        if (reportFails) throw IOException("no signal")
        return MockFixtures.report()
    }

    override suspend fun shared(code: String): MockRoom {
        fail()
        return MockFixtures.room(opened)
    }

    override suspend fun sharedReport(code: String): MockReport {
        fail()
        return MockFixtures.report("shared-report")
    }

    override suspend fun leagues(): List<League> {
        fail()
        return saved
    }

    private fun write() {
        fail()
        refusal?.let { throw ApiFailure(HTTP_CONFLICT, "conflict", it) }
    }

    private fun fail() {
        if (signedOut) throw Unauthorized()
        if (offline) throw IOException("no signal")
    }

    private companion object {
        const val HTTP_CONFLICT = 409
        const val HTTP_UNAVAILABLE = 503
    }
}
