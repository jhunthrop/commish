import CommishAPI
import Foundation

/// The fixture sheet (shared/fixtures/parity/sheet.json): its rows, the web's CSV for them, the tags'
/// and the status line's cases (Lane 254), for the Core's tests and the Sheet's snapshots.
public struct SheetParity: Decodable, Sendable {
    public struct Row: Decodable, Sendable {
        public let id: String
        public let name: String
        public let position: String
        public let team: String?
        public let tier: Int?
        public let tags: [String]
        public let note: String?
    }

    public struct Fixed: Decodable, Sendable {
        public let tag: String
        public let label: String
        public let tone: String
    }

    public struct Toggle: Decodable, Sendable {
        public let tags: [String]
        public let tag: String
        public let after: [String]?
    }

    public struct Typed: Decodable, Sendable {
        public let tag: String
        public let canonical: String
        public let problem: String?
    }

    public struct Status: Decodable, Sendable {
        public let status: String
        public let problem: String?
        public let changedAt: String?
        public let players: Int
        public let words: String?
    }

    /// limits.ts SHEET_LIMITS.
    public struct Limits: Decodable, Sendable {
        public let rows: Int
        public let sheetName: Int
        public let playerId: Int
        public let playerName: Int
        public let team: Int
        public let tier: Int
        public let note: Int
        public let tags: Int
        public let tagLength: Int
        public let headshot: Int
    }

    /// A file the web's import read (csv.ts decodeCsv): the header's sentence when it could not be used,
    /// else the players kept in rank order and each skipped line's reason.
    public struct FileRead: Decodable, Sendable {
        public struct Skip: Decodable, Sendable {
            public let line: Int
            public let reason: String
        }

        public let text: String
        public let header: String?
        public let ids: [String]
        public let skipped: [Skip]
    }

    public let defaultName: String
    public let limits: Limits
    public let rows: [Row]
    public let csv: String
    public let fixedTags: [Fixed]
    public let labels: [Fixed]
    public let toggles: [Toggle]
    public let typed: [Typed]
    public let answeredAt: String
    public let statuses: [Status]
    public let reads: [FileRead]

    public static func load() throws -> SheetParity {
        let file = RunFixture.fixtures.appendingPathComponent("parity/sheet.json")
        return try JSONDecoder().decode(SheetParity.self, from: Data(contentsOf: file))
    }
}

/// The sheet's tests' clock: the parity file's answer, Oct 23 at 16:00 UTC.
public enum SheetClock {
    public static let now = APIDecoding.parseDate("2026-10-23T16:00:00Z")!
    /// The account's stamp on the fixture sheet, to the microsecond, as Postgres writes it.
    public static let stamp = APIDecoding.parseDate("2026-10-23T15:41:07.123456Z")!
    public static let sheetID = "0b7a3c9e-5d1f-4a26-9a26-000000000254"
}

/// A sheet's answer: the fixture's rows in order, stamped.
public func sheetDetail(
    _ rows: [SheetRowInput], id: String = SheetClock.sheetID, name: String = "My sheet", stamp: Date = SheetClock.stamp
) -> SheetDetail {
    let answered = rows.enumerated().map { index, row in
        SheetRowAnswer(
            playerId: row.playerId, name: row.name, position: row.position, team: row.team, headshot: row.headshot,
            rank: index + 1, tier: row.tier, tags: row.tags ?? [], note: row.note
        )
    }
    return SheetDetail(
        value1: SheetSummary(
            id: id, name: name, format: .init(value1: .ppr), rowCount: rows.count, createdAt: stamp, updatedAt: stamp
        ),
        value2: .init(rows: answered)
    )
}

/// The fixture sheet's rows as a write sends them.
public func parityRows() throws -> [SheetRowInput] {
    try SheetParity.load().rows.map {
        SheetRowInput(
            playerId: $0.id, name: $0.name, position: $0.position, team: $0.team, headshot: nil, tier: $0.tier,
            tags: $0.tags, note: $0.note
        )
    }
}

/// What the stub's import answers: the players read, the lines skipped, the rows the sheet then holds.
public struct SheetImportAnswer: Sendable {
    public let imported: Int
    public let skipped: [Components.Schemas.ImportSkip]
    public let rows: [SheetRowInput]

    public init(imported: Int, skipped: [Components.Schemas.ImportSkip], rows: [SheetRowInput]) {
        self.imported = imported
        self.skipped = skipped
        self.rows = rows
    }
}

/// The account's sheets as a stub: one sheet (or none), each write stamped a second later and recorded
/// with the stamp it was guarded by; no signal, a sheet changed on another device, or a refused import on
/// request.
public actor SheetStub: SheetsAPI {
    public private(set) var detail: SheetDetail?
    public private(set) var writes: [(rows: [SheetRowInput], guarded: Date?)] = []
    public private(set) var reads = 0
    public private(set) var imports: [String] = []
    public private(set) var created: [[SheetRowInput]] = []
    public private(set) var deleted: [String] = []
    private var offline = false
    private var changedElsewhere = false
    private var importAnswer: SheetImportAnswer?
    private var importRefusal: APIError?
    private var exportFile = ("My sheet.csv", Data())
    private var refusesToken = false

    public init(_ detail: SheetDetail?) {
        self.detail = detail
    }

    public func set(offline: Bool) {
        self.offline = offline
    }

    public func set(changedElsewhere: Bool) {
        self.changedElsewhere = changedElsewhere
    }

    public func set(importAnswer: SheetImportAnswer?, refusal: APIError? = nil) {
        self.importAnswer = importAnswer
        importRefusal = refusal
    }

    public func set(export name: String, _ data: Data) {
        exportFile = (name, data)
    }

    /// Another device's write: his tags and note as it left them, the sheet stamped later.
    public func editElsewhere(_ playerID: String, tags: [String], note: String?) {
        guard let current = detail else {
            return
        }
        let rows = current.value2.rows.map(Self.input).map { row in
            row.playerId == playerID
                ? SheetRowInput(
                    playerId: row.playerId, name: row.name, position: row.position, team: row.team,
                    headshot: row.headshot, tier: row.tier, tags: tags, note: note
                )
                : row
        }
        detail = sheetDetail(rows, id: current.value1.id, stamp: current.value1.updatedAt.addingTimeInterval(60))
    }

    public func set(refusesToken: Bool) {
        self.refusesToken = refusesToken
    }

    private func reach() throws {
        if refusesToken {
            throw APIError.status(401)
        }
        if offline {
            throw URLError(.notConnectedToInternet)
        }
    }

    public func sheets() async throws -> [SheetSummary] {
        try reach()
        return detail.map { [$0.value1] } ?? []
    }

    public func sheet(id _: String) async throws -> SheetDetail {
        try reach()
        reads += 1
        changedElsewhere = false
        guard let detail else {
            throw APIError.envelope(code: "not_found", message: "Not found")
        }
        return detail
    }

    public func createSheet(
        name: String, format _: Components.Schemas.BoardFormatKnown, rows: [SheetRowInput]
    ) async throws -> SheetDetail {
        try reach()
        created.append(rows)
        let made = sheetDetail(rows, name: name, stamp: SheetClock.now)
        detail = made
        return made
    }

    public func deleteSheet(id: String) async throws {
        try reach()
        deleted.append(id)
        detail = nil
    }

    public func replaceRows(id: String, rows: [SheetRowInput], ifUpdatedAt: Date?) async throws -> SheetDetail {
        try reach()
        writes.append((rows, ifUpdatedAt))
        guard let current = detail else {
            throw APIError.envelope(code: "not_found", message: "Not found")
        }
        if changedElsewhere || (ifUpdatedAt != nil && ifUpdatedAt != current.value1.updatedAt) {
            // The account's copy moved on: another device's write stamped it later.
            detail = sheetDetail(
                current.value2.rows.map(Self.input), id: id, stamp: current.value1.updatedAt.addingTimeInterval(30)
            )
            throw APIError.envelope(code: "conflict", message: "This sheet changed on another device")
        }
        let next = sheetDetail(rows, id: id, stamp: current.value1.updatedAt.addingTimeInterval(1))
        detail = next
        return next
    }

    public func importSheet(id: String, csv: String) async throws -> SheetImportResult {
        try reach()
        imports.append(csv)
        if let importRefusal {
            throw importRefusal
        }
        let answer = importAnswer ?? SheetImportAnswer(imported: 0, skipped: [], rows: [])
        let sheet = sheetDetail(answer.rows, id: id, stamp: SheetClock.now.addingTimeInterval(5))
        detail = sheet
        return SheetImportResult(imported: answer.imported, skipped: answer.skipped, sheet: sheet)
    }

    public func exportSheet(id: String) async throws -> ExportLink {
        try reach()
        let expires = SheetClock.now.addingTimeInterval(7 * 86400)
        return ExportLink(
            value1: .init(
                id: "e1", sheetId: id, format: .init(value1: .csv), fileName: exportFile.0,
                bytes: Int64(exportFile.1.count), createdAt: SheetClock.now, expiresAt: expires
            ),
            value2: .init(url: "https://files.example/exports/e1.csv", urlExpiresAt: SheetClock.now)
        )
    }

    public func download(_: URL) async throws -> Data {
        try reach()
        return exportFile.1
    }

    static func input(_ row: SheetRowAnswer) -> SheetRowInput {
        SheetRowInput(
            playerId: row.playerId, name: row.name, position: row.position, team: row.team, headshot: row.headshot,
            tier: row.tier, tags: row.tags, note: row.note
        )
    }
}
