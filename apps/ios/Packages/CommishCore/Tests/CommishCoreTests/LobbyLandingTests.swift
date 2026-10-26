import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// "Your seat" on the landing: kept across a relaunch in the phone's defaults, and forgotten once its
/// room is drafted to its end, so the card reads Join again and a join posts.
@MainActor
struct LobbyLandingTests {
    @Test func aCompleteRoomsSeatIsForgottenAndJoinPosts() async throws {
        let api = StubLobby()
        await api.setComplete(true)
        let landing = LobbyLandingViewModel(api: api, memory: MemoryLobbySeats(["12_ppr": LobbyFixture.id]))
        #expect(landing.cards.isEmpty)
        await landing.load()
        let card = try #require(landing.cards.first)
        #expect(card.verb == Words.Lobby.join)
        #expect(card.seat == nil)
        #expect(await landing.join(card.format) == LobbyFixture.id)
        #expect(await api.joins == ["12_ppr"])
    }

    @Test func aSeatStillDraftingStaysAndOpensItsRoom() async throws {
        let api = StubLobby()
        let landing = LobbyLandingViewModel(api: api, memory: MemoryLobbySeats(["12_ppr": LobbyFixture.id]))
        await landing.load()
        let card = try #require(landing.cards.first)
        #expect(card.verb == Words.Lobby.yourSeat)
        #expect(await landing.join(card.format) == LobbyFixture.id)
        #expect(await api.joins.isEmpty)
    }

    @Test func forgettingARoomFreesItsCard() {
        let landing = LobbyLandingViewModel(api: StubLobby(), memory: MemoryLobbySeats(["12_ppr": "r"]))
        landing.forget(room: "r")
        #expect(landing.seated.isEmpty)
        landing.seat("s", format: LobbyFormat(value1: ._10Ppr))
        #expect(landing.seated == ["10_ppr": "s"])
    }

    @Test func theSeatsOutliveTheViewModelInTheDefaults() throws {
        let suite = "lane229-seats-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let first = DefaultsLobbySeats(defaults: defaults)
        first.seats["12_ppr"] = "r"
        #expect(DefaultsLobbySeats(defaults: defaults).seats == ["12_ppr": "r"])
    }
}
