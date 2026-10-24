import CommishAPI
import Foundation
import Testing

/// The generated types read the shared fixtures exactly as the API sends them, and still read them
/// with a field the API adds later (the additive rule).
struct FixtureDecodeTests {
    @Test func leagueSyncDecodesFromTheSharedFixture() throws {
        let sync = try Fixture.leagueSync()
        #expect(sync.name == "S.U.C.K. - Severely Underrated Carolina Keepers")
        #expect(sync.host == .ffpc)
        #expect(sync.teams.count == 12)
        #expect(sync.me == 1)
    }

    @Test func leagueSyncToleratesAFieldTheAPIAddsLater() throws {
        let added = try Fixture.withExtraField(Fixture.leagueSyncFile)
        let sync = try APIDecoding.envelopeData(Components.Schemas.LeagueSync.self, from: added)
        #expect(sync.teams.count == 12)
    }

    @Test func scoreboardDecodesAtEveryFixtureClock() throws {
        for file in Fixture.scoreboardFiles {
            let board = try APIDecoding.envelopeData(
                Components.Schemas.Scoreboard.self,
                from: Fixture.data(file)
            )
            #expect(board.week == 6, "\(file)")
            #expect(board.games.count == 6, "\(file)")
        }
    }

    @Test func scoreboardToleratesAFieldTheAPIAddsLater() throws {
        let file = try #require(Fixture.scoreboardFiles.first)
        let board = try APIDecoding.envelopeData(
            Components.Schemas.Scoreboard.self,
            from: Fixture.withExtraField(file)
        )
        #expect(board.games.isEmpty == false)
    }

    @Test func anErrorEnvelopeReadsAsTheAPIError() throws {
        let body = Data(
            #"{"ok":false,"data":null,"error":{"code":"not_found","message":"No such league."},"request_id":"r1"}"#
                .utf8
        )
        #expect(throws: APIError.envelope(code: "not_found", message: "No such league.")) {
            _ = try APIDecoding.envelopeData(Components.Schemas.LeagueSync.self, from: body)
        }
    }
}

enum Fixture {
    static let league = "6f1d1c52-2626-4a26-9a26-000000000026"
    static let leagueSyncFile = "leagues-attached-\(league).json"
    static let scoreboardFiles = [
        "2026-10-16T02-00-00Z", "2026-10-17T17-00-00Z", "2026-10-18T18-56-00Z",
        "2026-10-19T16-00-00Z", "2026-10-20T00-40-00Z", "2026-10-20T17-00-00Z",
    ].map { "scoreboard-\(league)-\($0).json" }

    /// shared/fixtures/inseason, found from this file's place in the repository.
    static let folder = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appendingPathComponent("../../../../../../shared/fixtures/inseason")
        .standardized

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: folder.appendingPathComponent(name))
    }

    static func leagueSync() throws -> Components.Schemas.LeagueSync {
        try APIDecoding.envelopeData(Components.Schemas.LeagueSync.self, from: data(leagueSyncFile))
    }

    /// The file with a field no schema names added to its payload.
    static func withExtraField(_ name: String) throws -> Data {
        var envelope = try #require(JSONSerialization.jsonObject(with: data(name)) as? [String: Any])
        var payload = try #require(envelope["data"] as? [String: Any])
        payload["a_field_from_a_later_api"] = ["nested": true]
        envelope["data"] = payload
        return try JSONSerialization.data(withJSONObject: envelope)
    }
}
