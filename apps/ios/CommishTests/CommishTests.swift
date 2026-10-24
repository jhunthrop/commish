@testable import Commish
import CommishAPI
import CommishCore
import CommishDesign
import Foundation
import Testing

/// What only the app on a simulator can say: its build settings, its tabs' glyphs, and that iOS
/// itself registers the bundled WOFF2 faces (the package tests prove it on macOS only).
struct CommishTests {
    @Test func theBuildsAPIBaseURLIsRead() {
        #expect(AppEnvironment.baseURL(in: ["CommishAPIBaseURL": "http://localhost:8080"])?.port == 8080)
        #expect(AppEnvironment.baseURL(in: [:]) == nil)
        #expect(AppEnvironment.baseURL(in: ["CommishAPIBaseURL": "$(API_BASE_URL)"]) == nil)
    }

    @Test func theAppBuildCarriesAnAPIBaseURL() {
        #expect(AppEnvironment.baseURL(in: Bundle.main.infoDictionary ?? [:]) != nil)
    }

    @Test func everyTabOfEveryPhaseHasItsGlyph() {
        let phases: [Components.Schemas.LeaguePhaseKnown?] = Components.Schemas.LeaguePhaseKnown.allCases + [nil]
        let tabs = phases.flatMap { PhoneRail.tabs(phase: $0, waiversOpen: false) } + PhoneRail.withoutLeague
        for tab in tabs {
            #expect(RootTabs.symbol(tab.key) != "circle", "\(tab.key)")
        }
    }

    @Test func iOSRegistersTheThreeFaces() {
        #expect(Faces.registered == [.ui, .num, .read])
    }
}
