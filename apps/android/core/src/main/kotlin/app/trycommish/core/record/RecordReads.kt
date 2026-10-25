package app.trycommish.core.record

import app.trycommish.api.Transport
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.RunRecord
import app.trycommish.api.models.RunRecordAnswer
import app.trycommish.api.models.RunSchedule
import app.trycommish.api.models.RunScheduleAnswer
import app.trycommish.core.board.KeptBody
import app.trycommish.core.board.RunRead
import app.trycommish.core.board.runRead
import kotlinx.serialization.Serializable

/** The record's reads (web/src/lib/server/pages/record.ts): the run's record as the nightly wrote it, and
 * every club's games with their kickoffs and states, by which a set week is not played yet, under way or
 * played at the screen's clock. Each names the ETag the phone kept, and a 304 says the kept copy stands.
 * A 401 throws [app.trycommish.api.Unauthorized]. */
interface RecordReads {
    /** GET /run/record. */
    suspend fun record(tag: String?): RunRead

    /** GET /run/schedule. */
    suspend fun schedule(tag: String?): RunRead
}

/** The record's routes through the generated client, the ETag sent as the API gave it. */
class ApiRecordReads(
    private val transport: Transport,
) : RecordReads {
    override suspend fun record(tag: String?): RunRead = transport.run().runRecord(tag).runRead()

    override suspend fun schedule(tag: String?): RunRead = transport.run().runSchedule(tag).runRead()
}

/** The record and the schedule its weeks are read by, as the phone keeps them: each answer whole with
 * the ETag the API gave it, sent back on the next read. */
@Serializable
data class RecordBodies(
    val record: KeptBody,
    val schedule: KeptBody,
)

/** The bodies decoded: what the record's model draws from. */
data class RecordRead(
    val bodies: RecordBodies,
    val record: RunRecord,
    val schedule: RunSchedule,
) {
    companion object {
        /** Decodes kept bodies; throws where one does not read. */
        fun of(bodies: RecordBodies): RecordRead =
            RecordRead(
                bodies,
                decodeEnvelope<RunRecordAnswer>(bodies.record.body).record,
                decodeEnvelope<RunScheduleAnswer>(bodies.schedule.body).schedule,
            )
    }
}
