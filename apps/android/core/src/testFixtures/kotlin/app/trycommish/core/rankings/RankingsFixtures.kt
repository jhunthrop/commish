package app.trycommish.core.rankings

import app.trycommish.api.Unauthorized
import app.trycommish.core.board.RunRead
import app.trycommish.core.record.RecordReads
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.net.UnknownHostException

/** The order's answers the fixture API gave with no league (shared/fixtures/inseason/order-*.json, Lane
 * 194), the iOS RankingsFixture's: our order at a clock for every position and a search, the kickers' and
 * defenses' week. */
object RankingsFixtures {
    /** Saturday noon and Sunday 18:56Z, as the files name them. */
    const val WEEK = "2026-10-17T17-00-00Z"
    const val SUNDAY = "2026-10-18T18-56-00Z"

    private val root = File(requireNotNull(System.getProperty("fixtures")))

    /** The order's answer for a read at a clock: `part` as the file names it ("", "-QB", "-q-wa"). */
    fun order(
        part: String,
        clock: String = WEEK,
    ): String = File(root, "inseason/order$part-$clock.json").readText()

    /** The kickers' or defenses' week at a clock. */
    fun weekOrder(
        position: WeekPosition,
        clock: String = WEEK,
    ): String = File(root, "inseason/order-week-${position.name}-$clock.json").readText()

    /** The file part of a read: its position and its search, as export-fixtures.ts names it. */
    fun part(query: OrderQuery): String = query.position?.let { "-${it.name}" }.orEmpty() + query.search?.let { "-q-$it" }.orEmpty()

    /** A parity file the web's readers wrote. */
    fun parity(name: String): String = File(root, "parity/$name.json").readText()
}

/** The order's routes over the fixture's answers at a clock: each read answered by the file its query
 * names (any limit reads the file's hundred), every read failing with no signal while [offline], or
 * refused while [refused]. It keeps each query and week read. */
class StubRankings(
    private val clock: String = RankingsFixtures.WEEK,
    var offline: Boolean = false,
    var refused: Boolean = false,
    /** A read this says fails is answered as no signal: the reads never read before, in a test. */
    var fails: (OrderQuery) -> Boolean = { false },
) : RankingsReads {
    val queries = mutableListOf<OrderQuery>()
    val weeks = mutableListOf<WeekPosition>()

    override suspend fun order(query: OrderQuery): String {
        check()
        queries += query
        if (fails(query)) throw UnknownHostException("api.test")
        return RankingsFixtures.order(RankingsFixtures.part(query), clock)
    }

    override suspend fun weekOrder(position: WeekPosition): String {
        check()
        weeks += position
        return RankingsFixtures.weekOrder(position, clock)
    }

    private fun check() {
        if (refused) throw Unauthorized()
        if (offline) throw UnknownHostException("api.test")
    }
}

/** The run's record as GET /run/record answers it: the contract run's own, or a record fixture
 * (shared/fixtures/record), the iOS RecordFixture's. */
enum class RecordFixture(
    private val path: String,
) {
    /** The contract run's record, before the weekly and draft records. */
    Own("run/runs/2026-10-21T12-ros/record.json"),
    Waiting("record/waiting.json"),
    Upcoming("record/upcoming.json"),
    Set("record/set.json"),
    Graded("record/graded.json"),
    Published("record/published.json"),
    ;

    /** The ETag the API would give the file: its run and its name. */
    val tag: String get() = "W/\"$RUN/$path\""

    fun answer(): String = envelope("record", File(root, path).readText())

    companion object {
        const val RUN = "2026-10-21T12-ros"
        private val root = File(requireNotNull(System.getProperty("fixtures")))

        /** The contract run's schedule, which every fixture record's weeks are read by. */
        const val SCHEDULE_TAG = "W/\"$RUN/schedule.json\""

        fun scheduleAnswer(): String = envelope("schedule", File(root, "run/runs/$RUN/schedule.json").readText())

        /** A fixture by the parity file's name of it. */
        fun of(file: String): RecordFixture = entries.firstOrNull { file.endsWith(it.path) } ?: Own

        private fun envelope(
            field: String,
            json: String,
        ): String =
            JsonObject(
                mapOf(
                    "ok" to JsonPrimitive(true),
                    "data" to JsonObject(mapOf("run_id" to JsonPrimitive(RUN), field to Json.parseToJsonElement(json))),
                    "error" to JsonNull,
                    "request_id" to JsonPrimitive("fixture"),
                ),
            ).toString()
    }
}

/** The record's routes over a record fixture, as the API answers them: each file with its ETag, unchanged
 * (304) when the read names it, every read failing with no signal while [offline]. It keeps every ETag
 * named and counts the 304s. */
class StubRecord(
    var fixture: RecordFixture,
    var offline: Boolean = false,
) : RecordReads {
    val tags = mutableListOf<String?>()
    var unchanged = 0
        private set

    override suspend fun record(tag: String?): RunRead = read(tag, fixture.tag) { fixture.answer() }

    override suspend fun schedule(tag: String?): RunRead = read(tag, RecordFixture.SCHEDULE_TAG) { RecordFixture.scheduleAnswer() }

    private fun read(
        tag: String?,
        current: String,
        body: () -> String,
    ): RunRead {
        if (offline) throw UnknownHostException("api.test")
        tags += tag
        if (tag == current) {
            unchanged += 1
            return RunRead.Unchanged(current)
        }
        return RunRead.Fresh(body(), current)
    }
}
