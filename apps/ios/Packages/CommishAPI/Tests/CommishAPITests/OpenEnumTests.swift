import CommishAPI
import Foundation
import Testing

/// Every schema enum is open (apps/ios/scripts/gen-openapi.ts): a value the API adds after this build
/// decodes as an unknown string, and the rest of the answer still reads.
struct OpenEnumTests {
    @Test func aPlatformThisBuildDoesNotKnowStillReadsTheLeague() throws {
        let data = try Fixture.replacing(Fixture.leagueSyncFile) { payload in
            payload["host"] = "fleaflicker"
            var roster = payload["roster"] as? [[String: Any]] ?? []
            roster[0]["slot"] = "practice_squad"
            payload["roster"] = roster
        }
        let sync = try APIDecoding.envelopeData(LeagueSync.self, from: data)
        #expect(sync.host.value1 == nil)
        #expect(sync.host.value2 == "fleaflicker")
        #expect(sync.roster.first?.slot.value1 == nil)
        #expect(sync.roster.first?.slot.value2 == "practice_squad")
        #expect(sync.teams.count == 12)
    }

    @Test func aKnownPlatformReadsAsItself() throws {
        #expect(try Fixture.leagueSync().host.value1 == .ffpc)
    }

    @Test func aDeviceScopeThisBuildDoesNotKnowStillReadsTheDevice() throws {
        let body = Data(#"""
        {"ok":true,"data":{"handle":null,"device":{"id":"d-1","name":"x","kind":"watch",
        "scopes":["session","league:write","draft:admin"],"created_at":"2026-10-24T00:00:00Z","last_used_at":null}},
        "error":null,"request_id":"r"}
        """#.utf8)
        let me = try APIDecoding.envelopeData(Components.Schemas.DeviceMe.self, from: body)
        #expect(me.device.scopes.map(\.value1) == [.session, .league_colon_write, nil])
        #expect(me.device.scopes.last?.value2 == "draft:admin")
        #expect(me.device.kind?.value1 == nil)
    }
}

extension Fixture {
    /// The fixture with its payload changed by `change`.
    static func replacing(_ name: String, _ change: (inout [String: Any]) -> Void) throws -> Data {
        var envelope = try #require(JSONSerialization.jsonObject(with: data(name)) as? [String: Any])
        var payload = try #require(envelope["data"] as? [String: Any])
        change(&payload)
        envelope["data"] = payload
        return try JSONSerialization.data(withJSONObject: envelope)
    }
}
