@testable import CommishCore
import Foundation
import Testing

/// The site's mock links open the mock in the app (web links.ts, nav.ts MOCK_SETUP), and the bar's Mock
/// draft tabs are the setup.
struct MockLinkTests {
    @Test func theSetupAndASharedDraftOpenInTheApp() {
        let site = SiteLinks.origin
        #expect(AppLink.of(site.appendingPathComponent("mock/new")) == .mock(.mockSetup(from: nil)))
        #expect(AppLink.of(site.appendingPathComponent("mock")) == .mock(.mockSetup(from: nil)))
        #expect(AppLink.of(SiteLinks.mockSetup) == .mock(.mockSetup(from: nil)))
        #expect(AppLink.of(MockRoomViewModel.shareLink("abc")) == .mock(.sharedMock(code: "abc")))
        #expect(AppLink.of(site.appendingPathComponent("mock/some-id")) == nil)
    }

    @Test func aLinksSavedLeagueOpensTheSetupOnIt() throws {
        let link = try #require(URL(string: "https://trycommish.app/mock/new?league=saved-1"))
        #expect(AppLink.of(link) == .mock(.mockSetup(from: nil, league: "saved-1")))
        let empty = try #require(URL(string: "https://trycommish.app/mock/new?league="))
        #expect(AppLink.of(empty) == .mock(.mockSetup(from: nil)))
    }

    @Test func theBarsMockDraftTabsAreTheSetup() {
        #expect(PhoneRail.isMock("mock"))
        #expect(PhoneRail.isMock("mock_late"))
        #expect(!PhoneRail.isMock("board"))
    }
}
