import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The phone's five follow the league's phase exactly as the web's bar does
/// (shared/fixtures/parity/phone-rail.json, written from web/src/lib/ui/rail-order.ts).
struct PhoneRailTests {
    private struct Item: Decodable, Equatable {
        let key: String
        let label: String
    }

    private struct Rail: Decodable {
        let phases: [String: [Item]]
        let withoutLeague: [Item]
    }

    private static func rail() throws -> Rail {
        try JSONDecoder().decode(Rail.self, from: Fixtures.data("fixtures/parity/phone-rail.json"))
    }

    private static func items(_ tabs: [RailTab]) -> [Item] {
        tabs.map { Item(key: $0.key, label: $0.label) }
    }

    @Test(arguments: Components.Schemas.LeaguePhaseKnown.allCases)
    func eachPhasesFiveAreTheWebs(phase: Components.Schemas.LeaguePhaseKnown) throws {
        let web = try Self.rail()
        #expect(Self.items(PhoneRail.tabs(phase: phase, waiversOpen: true))
            == web.phases[phase == .playoffs ? "playoffs_waivers" : phase.rawValue])
        if phase == .playoffs {
            #expect(Self.items(PhoneRail.tabs(phase: phase, waiversOpen: false)) == web.phases["playoffs"])
        }
    }

    @Test func noLeagueFollowedIsTheWebsBarForNone() throws {
        #expect(try Self.items(PhoneRail.withoutLeague) == Self.rail().withoutLeague)
    }

    @Test func aPhaseThisBuildDoesNotKnowReadsAsInSeason() {
        #expect(PhoneRail.tabs(phase: nil, waiversOpen: true) == PhoneRail.tabs(phase: .inSeason, waiversOpen: true))
    }
}
