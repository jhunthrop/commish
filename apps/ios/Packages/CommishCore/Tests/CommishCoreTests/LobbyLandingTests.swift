import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Observation
import os
import RunFixtures
import Testing

/// "Your seat" on the landing: kept across a relaunch for the signed-in device only, forgotten once its
/// room is drafted to its end or the API no longer seats the member (403, 404), kept through a lapsed
/// token (401), and redrawn the moment it is forgotten.
@MainActor
struct LobbyLandingTests {
    static let device = "device-a"

    static func landing(
        _ api: StubLobby, memory: MemoryLobbySeats, owner: String? = device,
        signedOut: @escaping @MainActor () -> Void = {}
    ) -> LobbyLandingViewModel {
        LobbyLandingViewModel(api: api, memory: memory, owner: { owner }, onSignedOut: signedOut)
    }

    @Test func aCompleteRoomsSeatIsForgottenAndJoinPosts() async throws {
        let api = StubLobby()
        await api.setComplete(true)
        let memory = MemoryLobbySeats(owner: Self.device, ["12_ppr": LobbyFixture.id])
        let landing = Self.landing(api, memory: memory)
        await landing.load()
        let card = try #require(landing.cards.first)
        #expect(card.verb == Words.Lobby.join)
        #expect(card.seat == nil)
        #expect(memory.seats(owner: Self.device).isEmpty)
        #expect(await landing.join(card.format) == LobbyFixture.id)
        #expect(await api.joins == ["12_ppr"])
    }

    @Test func theCardsRedrawWhenTheLoadForgetsASeat() async {
        let api = StubLobby()
        let memory = MemoryLobbySeats(owner: Self.device, ["12_ppr": LobbyFixture.id])
        let landing = Self.landing(api, memory: memory)
        await landing.load()
        #expect(landing.cards.first?.verb == Words.Lobby.yourSeat)
        await api.setComplete(true)
        let redrawn = Flag()
        // The seats the cards read are observed themselves, not only the list beside them.
        withObservationTracking {
            _ = landing.seated
        } onChange: {
            redrawn.raise()
        }
        await landing.load()
        #expect(redrawn.raised)
        #expect(landing.cards.first?.verb == Words.Lobby.join)
    }

    @Test func aSeatStillDraftingStaysAndOpensItsRoom() async throws {
        let api = StubLobby()
        let landing = Self.landing(api, memory: MemoryLobbySeats(owner: Self.device, ["12_ppr": LobbyFixture.id]))
        await landing.load()
        let card = try #require(landing.cards.first)
        #expect(card.verb == Words.Lobby.yourSeat)
        #expect(await landing.join(card.format) == LobbyFixture.id)
        #expect(await api.joins.isEmpty)
    }

    @Test func aLapsedTokenKeepsTheSeatAndSignsOut() async {
        let api = StubLobby()
        await api.setRefusal(401)
        var signedOut = false
        let memory = MemoryLobbySeats(owner: Self.device, ["12_ppr": LobbyFixture.id])
        let landing = Self.landing(api, memory: memory, signedOut: { signedOut = true })
        await landing.load()
        #expect(signedOut)
        #expect(landing.seated == ["12_ppr": LobbyFixture.id])
        #expect(memory.seats(owner: Self.device) == ["12_ppr": LobbyFixture.id])
    }

    @Test func aNoSeatOrGoneRoomIsForgotten() async {
        for status in [403, 404] {
            let api = StubLobby()
            await api.setRefusal(status)
            let memory = MemoryLobbySeats(owner: Self.device, ["12_ppr": LobbyFixture.id])
            let landing = Self.landing(api, memory: memory)
            await landing.load()
            #expect(landing.seated.isEmpty, "\(status)")
            #expect(memory.seats(owner: Self.device).isEmpty, "\(status)")
        }
    }

    @Test func aSignOutLeavesNoSeatForTheNextMember() async {
        let memory = MemoryLobbySeats(owner: Self.device, ["12_ppr": LobbyFixture.id])
        let api = StubLobby()
        // The next member signs in: a new paired device, so a new owner.
        let next = Self.landing(api, memory: memory, owner: "device-b")
        await next.load()
        #expect(next.seated.isEmpty)
        #expect(next.cards.first?.verb == Words.Lobby.join)
        #expect(await next.join(LobbyFormat(value1: ._12Ppr)) == LobbyFixture.id)
        #expect(await api.joins == ["12_ppr"])
        // Keeping the next member's seat dropped the first member's.
        #expect(memory.seats(owner: Self.device).isEmpty)
        // Signed out, nothing is read or kept.
        let signedOut = Self.landing(api, memory: memory, owner: nil)
        await signedOut.load()
        #expect(signedOut.seated.isEmpty)
    }

    @Test func forgettingARoomFreesItsCard() async {
        let memory = MemoryLobbySeats(owner: Self.device, ["12_ppr": "r"])
        let landing = Self.landing(StubLobby(), memory: memory)
        await landing.load()
        landing.forget(room: "r")
        #expect(landing.seated.isEmpty)
        landing.seat("s", format: LobbyFormat(value1: ._10Ppr))
        #expect(landing.seated == ["10_ppr": "s"])
        #expect(memory.seats(owner: Self.device) == ["10_ppr": "s"])
    }

    @Test func theSeatsOutliveTheViewModelInTheDefaultsForTheirOwnerOnly() throws {
        let suite = "lane229-seats-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        DefaultsLobbySeats(defaults: defaults).keep(["12_ppr": "r"], owner: "a")
        #expect(DefaultsLobbySeats(defaults: defaults).seats(owner: "a") == ["12_ppr": "r"])
        #expect(DefaultsLobbySeats(defaults: defaults).seats(owner: "b").isEmpty)
        DefaultsLobbySeats(defaults: defaults).keep([:], owner: "b")
        #expect(DefaultsLobbySeats(defaults: defaults).seats(owner: "a").isEmpty)
    }
}

/// A flag an observation's change handler raises from wherever it runs.
final class Flag: Sendable {
    private let state = OSAllocatedUnfairLock(initialState: false)

    var raised: Bool {
        state.withLock { $0 }
    }

    func raise() {
        state.withLock { $0 = true }
    }
}
