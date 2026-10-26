package app.trycommish.core.companion

import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.CompanionCreate
import app.trycommish.api.models.CompanionSummary
import app.trycommish.api.models.DraftCompanion
import app.trycommish.api.models.MockReport
import java.io.File
import java.io.IOException
import java.time.Instant
import java.time.ZoneId

/**
 * The live-draft companion's recorded replay (shared/fixtures/companion, web/scripts/record-companion.ts),
 * the iOS CompanionFixture's: the recorded Sleeper draft followed from slot 5, read at five moments as the
 * web's page reads it (the first with the board, each later one since the pick count before), the report on
 * the finished draft and the account's followed drafts, each the API's envelope as it answered.
 */
object CompanionFixtures {
    /** The moments, in the order they were read. */
    enum class Moment(
        val id: String,
    ) {
        /** Picks 1 and 2 made, before the drafter's first turn at 1.05. */
        Waiting("waiting"),

        /** 11 picks made, between turns, the call waiting on the board for 2.08. */
        Between("between"),

        /** 19 picks made, the drafter on the clock at 2.08 with our call. */
        Turn("turn"),

        /** 22 picks made, the drafter's 2.08 on the strip, waiting on 3.05. */
        Taken("taken"),

        /** All 240 picks made. */
        Complete("complete"),
    }

    /** The followed draft's id in every answer. */
    const val ID = "31d7ec59-4176-4180-b32d-e7689de4ac90"

    /** The member's zone the shots draw in. */
    val zone: ZoneId = ZoneId.of("America/Chicago")

    /** The replay was recorded on Sunday 2026-10-25 at 14:30 Central. */
    val readAt: Instant = Instant.parse("2026-10-25T19:31:00Z")

    private val folder = File(System.getProperty("fixtures"), "companion")

    fun body(file: String): String = File(folder, file).readText()

    fun answer(moment: Moment): DraftCompanion = decodeEnvelope(body("companion-${moment.id}.json"))

    fun report(): MockReport = decodeEnvelope(body("report.json"))

    fun recent(): List<CompanionSummary> = decodeEnvelope(body("companions.json"))

    /** The moments up to and with `moment`, in order. */
    fun through(moment: Moment): List<Moment> = Moment.entries.take(moment.ordinal + 1)
}

/** How the stub's draft reads answer. */
enum class StubMode {
    Answers,

    /** Every read fails with no connection. */
    Offline,

    /** Every read answers the API's 401. */
    SignedOut,

    /** A draft read answers the API's 404. */
    NotFound,
}

/**
 * The companion's reads over the recorded replay, the iOS StubCompanion's: each draft read answers the next
 * moment (the last again once they run out), edited by `edit`; the report and the followed drafts as
 * recorded; `mode` fails them; `reportFails` makes the report read answer a 502; `refusal` the follow's
 * sentence. Counts the draft reads with their `since`, and the report reads.
 */
class StubCompanion(
    moments: List<CompanionFixtures.Moment> = CompanionFixtures.Moment.entries,
    var mode: StubMode = StubMode.Answers,
    private val refusal: Map<String, String>? = null,
    private val reportFails: Boolean = false,
    private val edit: (DraftCompanion) -> DraftCompanion = { it },
) : CompanionReads {
    private val queue = moments.toMutableList()
    val reads = mutableListOf<Int>()
    var reportReads = 0
        private set
    val followed = mutableListOf<CompanionCreate>()

    override suspend fun recent(): List<CompanionSummary> {
        fail()
        return CompanionFixtures.recent()
    }

    override suspend fun follow(body: CompanionCreate): DraftCompanion {
        fail()
        followed += body
        refusal?.let { throw ApiFailure(HTTP_BAD_REQUEST, "bad_request", "That did not go through.", it) }
        return CompanionFixtures.answer(CompanionFixtures.Moment.Waiting)
    }

    override suspend fun companion(
        id: String,
        since: Int,
    ): DraftCompanion {
        reads += since
        fail()
        if (mode == StubMode.NotFound) throw ApiFailure(HTTP_NOT_FOUND, NOT_FOUND, "No companion with that id.")
        val moment = if (queue.size > 1) queue.removeAt(0) else queue.first()
        return edit(CompanionFixtures.answer(moment))
    }

    override suspend fun report(id: String): MockReport {
        reportReads++
        fail()
        if (reportFails) throw ApiFailure(HTTP_BAD_GATEWAY, "bad_gateway", "Sleeper did not answer.")
        return CompanionFixtures.report()
    }

    private fun fail() {
        when (mode) {
            StubMode.SignedOut -> throw Unauthorized()
            StubMode.Offline -> throw IOException("no signal")
            StubMode.Answers, StubMode.NotFound -> Unit
        }
    }

    private companion object {
        const val HTTP_BAD_REQUEST = 400
        const val HTTP_NOT_FOUND = 404
        const val HTTP_BAD_GATEWAY = 502
    }
}
