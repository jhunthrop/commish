import AuthenticationServices
@testable import Commish
import CommishAPI
import CommishCore
import CommishDesign
import Foundation
import Shell
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
        let phases = Components.Schemas.LeaguePhaseKnown.allCases
        let tabs = phases.flatMap { PhoneRail.tabs(phase: $0, waiversOpen: false) }
            + SitePhase.allCases.flatMap { PhoneRail.withoutLeague(season: $0) } + [PhoneRail.account]
        for tab in tabs {
            #expect(TabSymbols.symbol(tab.key) != "circle", "\(tab.key)")
        }
    }

    @Test func iOSRegistersTheThreeFaces() {
        #expect(Faces.registered == [.ui, .num, .read])
    }

    /// B168: the sign-in sheet keeps and shares no cookie, so after Sign out the next Sign in shows
    /// the WorkOS form rather than returning as the person signed in before.
    @Test @MainActor func theSignInSheetIsEphemeral() throws {
        let url = try #require(URL(string: "http://localhost:8080/auth/login"))
        let sheet = SignInFlow.sheet(url: url) { _, _ in }
        #expect(sheet.prefersEphemeralWebBrowserSession)
    }
}
