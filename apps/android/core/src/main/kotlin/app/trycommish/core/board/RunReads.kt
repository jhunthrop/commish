package app.trycommish.core.board

import app.trycommish.api.Transport
import app.trycommish.api.bodyText
import app.trycommish.api.infrastructure.HttpResponse
import io.ktor.http.HttpHeaders

/** One read of a run file: its answer with the ETag the API gave it, or a 304 saying the kept copy
 * stands (with the ETag, which a 304 repeats). */
sealed interface RunRead {
    data class Fresh(
        val body: String,
        val tag: String?,
    ) : RunRead

    data class Unchanged(
        val tag: String?,
    ) : RunRead
}

/** The Board's reads of the published run (GET /run/manifest, /run/boards/{format}, /run/adp,
 * /run/designations, /run/clubs), each naming the ETag kept for its file. A 401 throws
 * [app.trycommish.api.Unauthorized]. */
interface RunReads {
    suspend fun manifest(tag: String?): RunRead

    suspend fun board(
        format: String,
        tag: String?,
    ): RunRead

    suspend fun adp(tag: String?): RunRead

    suspend fun designations(tag: String?): RunRead

    suspend fun clubs(tag: String?): RunRead
}

/** The reads through the generated client. The ETag goes out as the API gave it: the Kotlin client
 * sets the header as written (the iOS generator URI-encoded it), and no HTTP cache sits in the client
 * to answer for the API or turn its 304 into a copy's 200. */
class ApiRunReads(
    private val transport: Transport,
) : RunReads {
    override suspend fun manifest(tag: String?): RunRead = transport.run().runManifest(tag).read()

    override suspend fun board(
        format: String,
        tag: String?,
    ): RunRead = transport.run().runBoard(format, tag).read()

    override suspend fun adp(tag: String?): RunRead = transport.run().runAdp(tag).read()

    override suspend fun designations(tag: String?): RunRead = transport.run().runDesignations(tag).read()

    override suspend fun clubs(tag: String?): RunRead = transport.run().runClubs(tag).read()

    private suspend fun HttpResponse<*>.read(): RunRead {
        val tag = response.headers[HttpHeaders.ETag]
        return if (status == NOT_MODIFIED) RunRead.Unchanged(tag) else RunRead.Fresh(bodyText(), tag)
    }

    private companion object {
        const val NOT_MODIFIED = 304
    }
}
