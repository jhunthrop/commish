import Foundation
import OpenAPIRuntime

public typealias SheetSummary = Components.Schemas.Sheet
public typealias SheetDetail = Components.Schemas.SheetDetail
public typealias SheetRowAnswer = Components.Schemas.SheetRow
public typealias SheetRowInput = Components.Schemas.SheetRowInput
public typealias SheetImportResult = Components.Schemas.SheetImportResult
public typealias ExportLink = Components.Schemas.ExportLink

/// The cheat sheet's reads and writes (web/src/lib/sheet/remote.ts, the account's sheets): the list to
/// find the one to open, a sheet with its rows, a new sheet, every row written in one guarded request,
/// a CSV import that replaces the rows, an export written as a file with a signed link, and the file
/// itself fetched from that link. The seam the view model's tests replace with a stub.
public protocol SheetsAPI: Sendable {
    /// GET /sheets: the account's sheets, the most recently changed first.
    func sheets() async throws -> [SheetSummary]
    /// GET /sheets/{id}: the sheet with every row in rank order.
    func sheet(id: String) async throws -> SheetDetail
    /// POST /sheets: a new sheet with its rows.
    func createSheet(name: String, format: Components.Schemas.BoardFormatKnown, rows: [SheetRowInput])
        async throws -> SheetDetail
    /// DELETE /sheets/{id}.
    func deleteSheet(id: String) async throws
    /// PUT /sheets/{id}/rows: every row in order; with `ifUpdatedAt`, nothing is written and the answer is
    /// a conflict when the sheet changed since.
    func replaceRows(id: String, rows: [SheetRowInput], ifUpdatedAt: Date?) async throws -> SheetDetail
    /// POST /sheets/{id}/import: the rows replaced from a CSV, and the lines skipped with their reasons.
    func importSheet(id: String, csv: String) async throws -> SheetImportResult
    /// POST /sheets/{id}/exports: the sheet written as a CSV file, with a link to it.
    func exportSheet(id: String) async throws -> ExportLink
    /// The export's file from its signed link.
    func download(_ url: URL) async throws -> Data
}

extension APIClient: SheetsAPI {
    /// The most sheets one read lists (remote.ts SHEETS_PER_PAGE).
    static let sheetsPerPage = 50

    public func sheets() async throws -> [SheetSummary] {
        let query = Operations.ListSheets.Input.Query(perPage: Self.sheetsPerPage)
        switch try await Self.unwrapped({ try await client.listSheets(query: query) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func sheet(id: String) async throws -> SheetDetail {
        switch try await Self.unwrapped({ try await client.getSheet(path: .init(id: id)) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .notFound(answer):
            throw try Self.refusal(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func createSheet(
        name: String, format: Components.Schemas.BoardFormatKnown, rows: [SheetRowInput]
    ) async throws -> SheetDetail {
        let body = Components.Schemas.SheetCreate(name: name, format: .init(value1: format), rows: rows)
        switch try await Self.unwrapped({ try await client.createSheet(body: .json(body)) }) {
        case let .created(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer):
            throw try Self.refusal(answer.body.json)
        case let .forbidden(answer):
            throw try Self.refusal(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func deleteSheet(id: String) async throws {
        switch try await Self.unwrapped({ try await client.deleteSheet(path: .init(id: id)) }) {
        case .ok:
            return
        case let .notFound(answer):
            throw try Self.refusal(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func replaceRows(id: String, rows: [SheetRowInput], ifUpdatedAt: Date?) async throws -> SheetDetail {
        let body = Components.Schemas.SheetRowsReplace(rows: rows, ifUpdatedAt: ifUpdatedAt)
        let output = try await Self.unwrapped {
            try await client.replaceSheetRows(path: .init(id: id), body: .json(body))
        }
        switch output {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer):
            throw try Self.refusal(answer.body.json)
        case let .notFound(answer):
            throw try Self.refusal(answer.body.json)
        case let .conflict(answer):
            throw try Self.refusal(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func importSheet(id: String, csv: String) async throws -> SheetImportResult {
        let output = try await Self.unwrapped {
            try await client.importSheet(path: .init(id: id), body: .csv(HTTPBody(csv)))
        }
        switch output {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer):
            throw try Self.refusal(answer.body.json)
        case let .notFound(answer):
            throw try Self.refusal(answer.body.json)
        case let .serviceUnavailable(answer):
            throw try Self.refusal(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func exportSheet(id: String) async throws -> ExportLink {
        let body = Components.Schemas.ExportCreate(format: .init(value1: .csv))
        let output = try await Self.unwrapped {
            try await client.exportSheet(path: .init(id: id), body: .json(body))
        }
        switch output {
        case let .created(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .notFound(answer):
            throw try Self.refusal(answer.body.json)
        case let .serviceUnavailable(answer):
            throw try Self.refusal(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func download(_ url: URL) async throws -> Data {
        let (data, response) = try await Transport.session.data(from: url)
        if let http = response as? HTTPURLResponse, !(200 ..< 300).contains(http.statusCode) {
            throw APIError.status(http.statusCode)
        }
        return data
    }

    /// The API's refusal in its own words: an invalid request's sentence for the field it names (a CSV
    /// whose first line is not the sheet's: "The first line must name rank, player_id, name and
    /// position"), else the envelope's sentence.
    static func refusal(_ envelope: Components.Schemas.Envelope) -> APIError {
        guard let error = envelope.error?.value1 else {
            return .emptyEnvelope
        }
        let fields = error.fields?.additionalProperties ?? [:]
        guard let field = fields.keys.min(), let sentence = fields[field] else {
            return .envelope(code: error.code, message: error.message)
        }
        return .envelope(code: error.code, message: sentence)
    }
}
