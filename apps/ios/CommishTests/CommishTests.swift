@testable import Commish
import Foundation
import Testing

struct CommishTests {
    @Test func theBuildsAPIBaseURLIsRead() {
        #expect(AppEnvironment.baseURL(in: ["CommishAPIBaseURL": "http://localhost:8080"])?.port == 8080)
        #expect(AppEnvironment.baseURL(in: [:]) == nil)
        #expect(AppEnvironment.baseURL(in: ["CommishAPIBaseURL": "$(API_BASE_URL)"]) == nil)
    }

    @Test func theFiveTabsAreTheWebsInSeasonOrder() {
        #expect(Tab.allCases.map(\.title) == ["League", "Lineup", "Matchup", "Waivers", "Trades"])
    }

    @Test func theAppBuildCarriesAnAPIBaseURL() {
        #expect(AppEnvironment.baseURL(in: Bundle.main.infoDictionary ?? [:]) != nil)
    }
}
