package app.trycommish.core.sheet

import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.ExportFormat
import app.trycommish.api.models.ExportLink
import app.trycommish.api.models.ImportSkip
import app.trycommish.api.models.Sheet
import app.trycommish.api.models.SheetDetail
import app.trycommish.api.models.SheetImportResult
import app.trycommish.api.models.SheetRow
import app.trycommish.api.models.SheetRowInput
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.net.UnknownHostException
import java.time.Instant
import java.util.UUID

/** The fixture sheet (shared/fixtures/parity/sheet.json, written by shared/scripts/sheet-parity.ts): its rows,
 * the web's CSV for them, the tags', the status line's and the file reads' cases (Lane 254), for the core's
 * tests and the Sheet's snapshots. */
data class SheetParity(
    val defaultName: String,
    val limits: Limits,
    val rows: List<Row>,
    val csv: String,
    val fixedTags: List<Fixed>,
    val labels: List<Fixed>,
    val toggles: List<Toggle>,
    val typed: List<Typed>,
    val answeredAt: String,
    val statuses: List<Status>,
    val reads: List<FileRead>,
) {
    data class Row(
        val id: String,
        val name: String,
        val position: String,
        val team: String? = null,
        val tier: Int? = null,
        val tags: List<String>,
        val note: String? = null,
    )

    data class Fixed(
        val tag: String,
        val label: String,
        val tone: String,
    )

    data class Toggle(
        val tags: List<String>,
        val tag: String,
        val after: List<String>? = null,
    )

    data class Typed(
        val tag: String,
        val canonical: String,
        val problem: String? = null,
    )

    data class Status(
        val status: String,
        val problem: String? = null,
        val changedAt: String? = null,
        val players: Int,
        val words: String? = null,
    )

    /** limits.ts SHEET_LIMITS. */
    data class Limits(
        val rows: Int,
        val sheetName: Int,
        val playerId: Int,
        val playerName: Int,
        val team: Int,
        val tier: Int,
        val note: Int,
        val tags: Int,
        val tagLength: Int,
        val headshot: Int,
    )

    /** A file the web's import read (csv.ts decodeCsv): the header's sentence when it could not be used, else
     * the players kept in rank order and each skipped line's reason. */
    data class FileRead(
        val text: String,
        val header: String? = null,
        val ids: List<String>,
        val skipped: List<Skipped>,
    )

    data class Skipped(
        val line: Int,
        val reason: String,
    )

    companion object {
        /** The file read by hand: the fixtures' source set has no serialization plugin. */
        fun load(): SheetParity {
            val json = Json.parseToJsonElement(File(System.getProperty("fixtures"), "parity/sheet.json").readText()).jsonObject
            val limits = json.obj("limits")
            return SheetParity(
                defaultName = json.text("defaultName"),
                limits =
                    Limits(
                        limits.int("rows"),
                        limits.int("sheetName"),
                        limits.int("playerId"),
                        limits.int("playerName"),
                        limits.int("team"),
                        limits.int("tier"),
                        limits.int("note"),
                        limits.int("tags"),
                        limits.int("tagLength"),
                        limits.int("headshot"),
                    ),
                rows =
                    json.list("rows").map {
                        Row(
                            it.text("id"),
                            it.text("name"),
                            it.text("position"),
                            it.textOrNull("team"),
                            it.intOrNull("tier"),
                            it.texts("tags"),
                            it.textOrNull("note"),
                        )
                    },
                csv = json.text("csv"),
                fixedTags = json.list("fixedTags").map(::fixed),
                labels = json.list("labels").map(::fixed),
                toggles = json.list("toggles").map { Toggle(it.texts("tags"), it.text("tag"), it.textsOrNull("after")) },
                typed = json.list("typed").map { Typed(it.text("tag"), it.text("canonical"), it.textOrNull("problem")) },
                answeredAt = json.text("answeredAt"),
                statuses =
                    json.list("statuses").map {
                        Status(
                            it.text("status"),
                            it.textOrNull("problem"),
                            it.textOrNull("changedAt"),
                            it.int("players"),
                            it.textOrNull("words"),
                        )
                    },
                reads =
                    json.list("reads").map { read ->
                        FileRead(
                            read.text("text"),
                            read.textOrNull("header"),
                            read.texts("ids"),
                            read.list("skipped").map { Skipped(it.int("line"), it.text("reason")) },
                        )
                    },
            )
        }

        private fun fixed(it: JsonObject): Fixed = Fixed(it.text("tag"), it.text("label"), it.text("tone"))

        private fun JsonObject.obj(key: String): JsonObject = getValue(key).jsonObject

        private fun JsonObject.list(key: String): List<JsonObject> = getValue(key).jsonArray.map { it.jsonObject }

        private fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content

        private fun JsonObject.textOrNull(key: String): String? = (get(key) as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content

        private fun JsonObject.int(key: String): Int = getValue(key).jsonPrimitive.int

        private fun JsonObject.intOrNull(key: String): Int? = (get(key) as? JsonPrimitive)?.intOrNull

        private fun JsonObject.texts(key: String): List<String> = getValue(key).jsonArray.map { it.jsonPrimitive.content }

        private fun JsonObject.textsOrNull(key: String): List<String>? = (get(key) as? JsonArray)?.map { it.jsonPrimitive.content }
    }
}

/** The sheet's tests' clock: the parity file's answer, Oct 23 at 16:00 UTC. */
object SheetClock {
    val now: Instant = Instant.parse("2026-10-23T16:00:00Z")

    /** The account's stamp on the fixture sheet, to the microsecond, as Postgres writes it. */
    const val STAMP = "2026-10-23T15:41:07.123456Z"
    const val SHEET_ID = "0b7a3c9e-5d1f-4a26-9a26-000000000254"

    /** A stamp moved on by `seconds`, written as the API writes it. */
    fun later(
        stamp: String,
        seconds: Long,
    ): String = Instant.parse(stamp).plusSeconds(seconds).toString()
}

/** A sheet's answer: the rows in order, stamped. */
fun sheetDetail(
    rows: List<SheetRowInput>,
    id: String = SheetClock.SHEET_ID,
    name: String = "My sheet",
    stamp: String = SheetClock.STAMP,
): SheetDetail =
    SheetDetail(
        id = UUID.fromString(id),
        name = name,
        format = BoardFormat.ppr,
        rowCount = rows.size,
        createdAt = stamp,
        updatedAt = stamp,
        rows =
            rows.mapIndexed { index, row ->
                SheetRow(row.playerId, row.name, row.position, row.team, row.headshot, index + 1, row.tier, row.tags.orEmpty(), row.note)
            },
    )

/** The fixture sheet's rows as a write sends them. */
fun parityRows(): List<SheetRowInput> =
    SheetParity.load().rows.map { SheetRowInput(it.id, it.name, it.position, it.team, null, it.tier, it.tags, it.note) }

/** A row as the account answered it, as a write sends it back. */
fun SheetRow.input(): SheetRowInput = SheetRowInput(playerId, name, position, team, headshot, tier, tags, note)

/** What the stub's import answers: the players read, the rows skipped, the rows the sheet then holds. */
data class SheetImportAnswer(
    val imported: Int,
    val skipped: List<ImportSkip>,
    val rows: List<SheetRowInput>,
)

/**
 * The account's sheets as a stub (the iOS SheetStub): one sheet or none, each write stamped a second later
 * and recorded with the stamp it was guarded by; no signal, a sheet changed on another device, a refused
 * token, or an import's answer or refusal on request.
 */
class SheetStub(
    var detail: SheetDetail?,
) : SheetReads {
    val writes = mutableListOf<Pair<List<SheetRowInput>, String?>>()
    var reads = 0
    val imports = mutableListOf<String>()
    val created = mutableListOf<List<SheetRowInput>>()
    val deleted = mutableListOf<String>()
    var offline = false
    var changedElsewhere = false
    var refusesToken = false
    var importAnswer: SheetImportAnswer? = null
    var importRefusal: Exception? = null
    var exportFile: Pair<String, ByteArray> = "My sheet.csv" to ByteArray(0)

    /** Another device's write: his tags and note as it left them, the sheet stamped a minute later. */
    fun editElsewhere(
        playerId: String,
        tags: List<String>,
        note: String?,
    ) {
        val current = detail ?: return
        val rows = current.rows.map { it.input() }.map { if (it.playerId == playerId) it.copy(tags = tags, note = note) else it }
        detail = sheetDetail(rows, current.id.toString(), stamp = SheetClock.later(current.updatedAt, MINUTE))
    }

    private fun reach() {
        if (refusesToken) throw Unauthorized()
        if (offline) throw UnknownHostException("api.test")
    }

    override suspend fun sheets(): List<Sheet> {
        reach()
        return listOfNotNull(detail?.let { Sheet(it.id, it.name, it.format, it.rowCount, it.createdAt, it.updatedAt) })
    }

    override suspend fun sheet(id: String): SheetDetail {
        reach()
        reads++
        changedElsewhere = false
        return detail ?: throw ApiFailure(NOT_FOUND, "not_found", "Not found")
    }

    override suspend fun create(
        name: String,
        format: BoardFormat,
        rows: List<SheetRowInput>,
    ): SheetDetail {
        reach()
        created += rows
        return sheetDetail(rows, name = name, stamp = SheetClock.now.toString()).also { detail = it }
    }

    override suspend fun delete(id: String) {
        reach()
        deleted += id
        detail = null
    }

    override suspend fun replaceRows(
        id: String,
        rows: List<SheetRowInput>,
        ifUpdatedAt: String?,
    ): SheetDetail {
        reach()
        writes += rows to ifUpdatedAt
        val current = detail ?: throw ApiFailure(NOT_FOUND, "not_found", "Not found")
        if (changedElsewhere || (ifUpdatedAt != null && ifUpdatedAt != current.updatedAt)) {
            // The account's copy moved on: another device's write stamped it later.
            detail = sheetDetail(current.rows.map { it.input() }, id, stamp = SheetClock.later(current.updatedAt, CONFLICT_SECONDS))
            throw ApiFailure(CONFLICT, "conflict", "This sheet changed on another device")
        }
        return sheetDetail(rows, id, stamp = SheetClock.later(current.updatedAt, 1)).also { detail = it }
    }

    override suspend fun import(
        id: String,
        csv: String,
    ): SheetImportResult {
        reach()
        imports += csv
        importRefusal?.let { throw it }
        val answer = importAnswer ?: SheetImportAnswer(0, emptyList(), emptyList())
        val sheet = sheetDetail(answer.rows, id, stamp = SheetClock.now.plusSeconds(IMPORT_SECONDS).toString())
        detail = sheet
        return SheetImportResult(answer.imported, answer.skipped, sheet)
    }

    override suspend fun export(id: String): ExportLink {
        reach()
        val now = SheetClock.now.toString()
        return ExportLink(
            id = UUID.fromString(EXPORT_ID),
            sheetId = UUID.fromString(id),
            format = ExportFormat.csv,
            fileName = exportFile.first,
            bytes = exportFile.second.size.toLong(),
            createdAt = now,
            expiresAt = now,
            url = "https://files.example/exports/e1.csv",
            urlExpiresAt = now,
        )
    }

    override suspend fun download(url: String): ByteArray {
        reach()
        return exportFile.second
    }

    private companion object {
        const val NOT_FOUND = 404
        const val CONFLICT = 409
        const val MINUTE = 60L
        const val CONFLICT_SECONDS = 30L
        const val IMPORT_SECONDS = 5L
        const val EXPORT_ID = "6f1d1c52-2626-4a26-9a26-000000000e01"
    }
}
