package app.trycommish.core.companion

import app.trycommish.api.ApiFailure
import app.trycommish.api.Transport
import app.trycommish.api.data
import app.trycommish.api.models.CompanionCreate
import app.trycommish.api.models.CompanionSummary
import app.trycommish.api.models.DraftCompanion
import app.trycommish.api.models.MockReport
import java.util.UUID

/**
 * The live-draft companion's reads (web/src/lib/companion/api.ts), the iOS CompanionAPI's: the account's
 * followed drafts, following a draft on another platform from a seat, the followed draft since the pick
 * count the screen holds, and the report once the platform says the draft is over. A 401 throws
 * [app.trycommish.api.Unauthorized], any other refusal [ApiFailure] with the API's sentence. The seam the
 * view models' tests replace with a stub.
 */
interface CompanionReads {
    /** GET /companions: up to five, newest first. */
    suspend fun recent(): List<CompanionSummary>

    /** POST /companions: the followed draft, the board with it. */
    suspend fun follow(body: CompanionCreate): DraftCompanion

    /** GET /companions/{id}?since=: every pick after `since`, the board only when `since` is 0. */
    suspend fun companion(
        id: String,
        since: Int,
    ): DraftCompanion

    /** GET /companions/{id}/report: the report on the finished draft. */
    suspend fun report(id: String): MockReport
}

/** The reads through the generated client. */
class ApiCompanionReads(
    private val transport: Transport,
) : CompanionReads {
    override suspend fun recent(): List<CompanionSummary> = transport.companions().listCompanions().data()

    override suspend fun follow(body: CompanionCreate): DraftCompanion = transport.companions().createCompanion(body).data()

    override suspend fun companion(
        id: String,
        since: Int,
    ): DraftCompanion = transport.companions().getCompanion(uuid(id), since).data()

    override suspend fun report(id: String): MockReport = transport.companions().companionReport(uuid(id)).data()

    /** A followed draft's id; one that is no uuid (a hand-made link) is a draft the account does not hold. */
    private fun uuid(id: String): UUID =
        try {
            UUID.fromString(id)
        } catch (e: IllegalArgumentException) {
            throw ApiFailure(HTTP_NOT_FOUND, NOT_FOUND, e.message.orEmpty())
        }
}

/** The API's code for a draft the account does not hold. */
const val NOT_FOUND = "not_found"
private const val HTTP_NOT_FOUND = 404

/** What the start page says when the API would not follow a draft (POST /companions answered 400, 403, 404,
 * 422 or 502): the field's own sentence first (by its key in order, as the API's JSON writes its fields and
 * the web's `Object.values(fields)[0]` reads them), else the API's message. */
fun ApiFailure.refusal(): String = fields.toSortedMap().values.firstOrNull() ?: message
