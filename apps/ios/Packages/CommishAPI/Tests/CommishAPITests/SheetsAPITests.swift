import CommishAPI
import Foundation
import OpenAPIRuntime
import RunFixtures
import Testing

/// The import's refusal through the generated client (Lane 297): each parity refusal's error, as the
/// API's handler is held to sending it, is thrown as ``SheetImportRefused`` with the API's sentence and
/// every skipped line, an empty list when no line said why; a 400 without skipped lines (a header the
/// import cannot use, or an API from before Lane 297) stays the refusal in its own words.
struct SheetsAPITests {
    private static let base = URL(string: "http://localhost:8080")!

    private static func client(_ body: Data) -> APIClient {
        APIClient(client: Client(
            serverURL: base, configuration: Configuration(dateTranscoder: APIDateTranscoder()),
            transport: AnswerTransport(status: .badRequest, body: body)
        ))
    }

    /// The parity file's refusals, each error as JSON in the envelope the API sends.
    private static func refusalBodies() throws -> [Data] {
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("../../../../../../shared/fixtures/parity/sheet.json")
            .standardized
        let parity = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        let refusals = try #require(parity["refusals"] as? [[String: Any]])
        return try refusals.map { refusal in
            let error = try #require(refusal["error"])
            let envelope: [String: Any] = ["ok": false, "data": NSNull(), "error": error, "request_id": "r"]
            return try JSONSerialization.data(withJSONObject: envelope)
        }
    }

    @Test func aRefusalOfABodyThatReadsNoPlayerCarriesItsSkippedLines() async throws {
        let parity = try SheetParity.load()
        let bodies = try Self.refusalBodies()
        #expect(parity.refusals.count == bodies.count)
        #expect(parity.refusals.contains { !$0.error.skipped.isEmpty }, "a refusal with rows")
        #expect(parity.refusals.contains { $0.error.skipped.isEmpty }, "a refusal without rows")
        for (refusal, body) in zip(parity.refusals, bodies) {
            let sent: SheetImportBody = refusal.csv ? .csv(refusal.text) : .names(refusal.text)
            await #expect(throws: refusal.refused) {
                try await Self.client(body).importSheet(id: SheetClock.sheetID, body: sent)
            }
        }
    }

    @Test func aRefusalWithoutSkippedLinesIsTheAPIsSentence() async throws {
        let sentence = "The first row must name rank, player_id, name and position"
        let error = #"{"code":"invalid","message":"Some of that did not check out","fields":{"body":"\#(sentence)"}}"#
        let body = Data(#"{"ok":false,"data":null,"error":\#(error),"request_id":"r"}"#.utf8)
        await #expect(throws: APIError.envelope(code: "invalid", message: sentence)) {
            try await Self.client(body).importSheet(id: SheetClock.sheetID, body: .names("Gibbs"))
        }
    }
}
