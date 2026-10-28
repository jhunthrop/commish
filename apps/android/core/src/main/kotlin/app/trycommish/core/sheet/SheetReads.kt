package app.trycommish.core.sheet

import app.trycommish.api.Transport
import app.trycommish.api.bodyText
import app.trycommish.api.data
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.ExportCreate
import app.trycommish.api.models.ExportFormat
import app.trycommish.api.models.ExportLink
import app.trycommish.api.models.Sheet
import app.trycommish.api.models.SheetCreate
import app.trycommish.api.models.SheetDetail
import app.trycommish.api.models.SheetImportResult
import app.trycommish.api.models.SheetRowInput
import app.trycommish.api.models.SheetRowsReplace
import kotlinx.serialization.json.JsonElement
import java.util.UUID

/**
 * The cheat sheet's reads and writes (web/src/lib/sheet/remote.ts, the iOS SheetsAPI): the list to find the
 * one to open, a sheet with its rows, a new sheet, every row written in one guarded request, an import of a
 * CSV or a list of names that replaces the rows, an export written as a file with a signed link, and the
 * file itself fetched from that link. A 401 throws [app.trycommish.api.Unauthorized]; a refusal throws [app.trycommish.api.ApiFailure]
 * with the API's sentence; no signal throws an [java.io.IOException].
 */
interface SheetReads {
    /** GET /sheets: the account's sheets, the most recently changed first. */
    suspend fun sheets(): List<Sheet>

    /** GET /sheets/{id}: the sheet with every row in rank order. */
    suspend fun sheet(id: String): SheetDetail

    /** POST /sheets: a new sheet with its rows. */
    suspend fun create(
        name: String,
        format: BoardFormat,
        rows: List<SheetRowInput>,
    ): SheetDetail

    /** DELETE /sheets/{id}. */
    suspend fun delete(id: String)

    /** PUT /sheets/{id}/rows: every row in order; with `ifUpdatedAt` (the stamp as it was read, to the
     * microsecond), nothing is written and the answer is a conflict when the sheet changed since. */
    suspend fun replaceRows(
        id: String,
        rows: List<SheetRowInput>,
        ifUpdatedAt: String?,
    ): SheetDetail

    /** POST /sheets/{id}/import: the rows replaced from a CSV or a list of names, and the lines skipped with
     * their reasons. A body that reads to no player is refused (400, its sentence) and the sheet kept. */
    suspend fun import(
        id: String,
        body: SheetImportBody,
    ): SheetImportResult

    /** POST /sheets/{id}/exports: the sheet written as a CSV file, with a link to it. */
    suspend fun export(id: String): ExportLink

    /** The export's file from its signed link. */
    suspend fun download(url: String): ByteArray
}

/** What an import sends (the iOS SheetImportBody): the sheet's CSV, typed text/csv, or a list of names in the
 * drafter's order, typed text/plain, which the API reads against the board of the sheet's format. */
sealed interface SheetImportBody {
    val text: String

    data class Csv(
        override val text: String,
    ) : SheetImportBody

    data class Names(
        override val text: String,
    ) : SheetImportBody
}

/** The sheets' routes through the generated client. */
class ApiSheetReads(
    private val transport: Transport,
) : SheetReads {
    override suspend fun sheets(): List<Sheet> = transport.sheets().listSheets(1, SHEETS_PER_PAGE).data()

    override suspend fun sheet(id: String): SheetDetail = transport.sheets().getSheet(UUID.fromString(id)).data()

    override suspend fun create(
        name: String,
        format: BoardFormat,
        rows: List<SheetRowInput>,
    ): SheetDetail = transport.sheets().createSheet(SheetCreate(name, format, rows)).data()

    /** The answer's data is null when it is done, so only a refusal is read: its envelope's sentence. */
    override suspend fun delete(id: String) {
        val answer = transport.sheets().deleteSheet(UUID.fromString(id))
        val body = answer.bodyText()
        if (answer.status !in HTTP_SUCCESS) decodeEnvelope<JsonElement>(body, answer.status)
    }

    override suspend fun replaceRows(
        id: String,
        rows: List<SheetRowInput>,
        ifUpdatedAt: String?,
    ): SheetDetail = transport.sheets().replaceSheetRows(UUID.fromString(id), SheetRowsReplace(rows, ifUpdatedAt = ifUpdatedAt)).data()

    override suspend fun import(
        id: String,
        body: SheetImportBody,
    ): SheetImportResult =
        when (body) {
            is SheetImportBody.Csv -> transport.sheets().importSheet(UUID.fromString(id), body.text).data()
            is SheetImportBody.Names -> transport.sheets().importNames(UUID.fromString(id), body.text).data()
        }

    override suspend fun export(id: String): ExportLink =
        transport.exports().exportSheet(UUID.fromString(id), ExportCreate(ExportFormat.csv)).data()

    override suspend fun download(url: String): ByteArray = transport.download(url)

    private companion object {
        /** The most sheets one read lists (remote.ts SHEETS_PER_PAGE). */
        const val SHEETS_PER_PAGE = 50
        val HTTP_SUCCESS = 200..299
    }
}
