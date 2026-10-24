import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// A value the API adds after this build reaches the model as a neutral word, never a crash or a code.
struct UnknownValueTests {
    private func sync(_ change: (inout [String: Any]) -> Void) throws -> LeagueSync {
        let file = "fixtures/inseason/leagues-attached-\(Fixtures.league).json"
        var envelope = try #require(JSONSerialization.jsonObject(with: Fixtures.data(file)) as? [String: Any])
        var payload = try #require(envelope["data"] as? [String: Any])
        change(&payload)
        envelope["data"] = payload
        return try APIDecoding.envelopeData(LeagueSync.self, from: JSONSerialization.data(withJSONObject: envelope))
    }

    @Test func aPlatformThisBuildDoesNotKnowIsNamedByTheAPIsOwnWord() throws {
        let league = try sync { $0["host"] = "flea_flicker" }
        let home = LeagueHomeModel(
            sync: league, scoreboard: nil, now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone
        )
        #expect(home.platform == "Flea flicker")
        #expect(home.lineup?.setOn == "As set on Flea flicker")
        #expect(home.standings.rows.count == 12)
    }

    @Test func aMoveOrRuleThisBuildDoesNotKnowIsSaidNeutrally() throws {
        let league = try sync { payload in
            var moves = payload["moves"] as? [[String: Any]] ?? []
            moves[0]["kind"] = "commissioner_edit"
            payload["moves"] = moves
            var terms = payload["terms"] as? [String: Any] ?? [:]
            terms["tiebreak"] = "coin_flip"
            payload["terms"] = terms
        }
        let home = LeagueHomeModel(
            sync: league, scoreboard: nil, now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone
        )
        #expect(home.moves.rows.first?.kind == "Commissioner edit")
        // A tiebreak this build cannot name is said as none stated.
        #expect(home.standings.basis.contains("then points for, as FFPC lists them"))
    }

    @Test func anEmptyUnknownSaysNothing() {
        #expect(PortedWords.unknown(nil) == nil)
        #expect(PortedWords.unknown("") == nil)
    }
}
