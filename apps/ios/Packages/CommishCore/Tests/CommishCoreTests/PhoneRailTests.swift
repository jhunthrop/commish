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
        let withoutLeagueBySeason: [String: [Item]]
        let account: Item
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

    /// With no league followed the bar's phase is the site's (GET /season), as the web's railShown.
    @Test(arguments: SitePhase.allCases)
    func noLeagueFollowedFollowsTheSitesSeason(season: SitePhase) throws {
        #expect(try Self.items(PhoneRail.withoutLeague(season: season))
            == Self.rail().withoutLeagueBySeason[season.rawValue])
    }

    /// An API from before GET /season, or a season this build does not know: the season's bar.
    @Test func noSeasonReadIsInSeason() {
        #expect(PhoneRail.withoutLeague(season: nil) == PhoneRail.withoutLeague(season: .inSeason))
    }

    @Test func theAccountsWayInIsTheWebs() throws {
        #expect(try Self.items([PhoneRail.account]) == [Self.rail().account])
    }

    /// The board is reached as the web's rail reaches it, no tab of its own: Board before the draft, on
    /// draft day and after the season; Rest of season in season with no league; in season with a
    /// league the phone's five carry neither (the web's wide rail alone does).
    @Test func theBoardIsReachedByTheWebsBoardAndRestOfSeasonItems() {
        let boards = { (tabs: [RailTab]) in tabs.compactMap { PhoneRail.boardInSeason($0.key) } }
        #expect(boards(PhoneRail.tabs(phase: .preDraft, waiversOpen: false)) == [false])
        #expect(boards(PhoneRail.tabs(phase: .draftDay, waiversOpen: false)) == [false])
        #expect(boards(PhoneRail.tabs(phase: .offseason, waiversOpen: false)) == [false])
        #expect(boards(PhoneRail.withoutLeague) == [true])
        #expect(boards(PhoneRail.tabs(phase: .inSeason, waiversOpen: true)).isEmpty)
        #expect(PhoneRail.tabs(phase: .preDraft, waiversOpen: false).count == 5)
    }

    @Test func aPhaseThisBuildDoesNotKnowReadsAsInSeason() {
        #expect(PhoneRail.tabs(phase: nil, waiversOpen: true) == PhoneRail.tabs(phase: .inSeason, waiversOpen: true))
    }
}
