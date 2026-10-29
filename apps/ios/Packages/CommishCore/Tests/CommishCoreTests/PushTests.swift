import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// Push on the phone (Lane 288): each payload the API sends opens the screen its path names
/// (shared/fixtures/parity/push.json, held to the API's senders by its own test), and the registrar
/// registers the device token on launch signed in and when Apple hands a new one over, takes it off
/// when every switch goes off and at sign out, and never asks the permission itself at launch.
@MainActor
struct PushTests {
    struct Parity: Decodable {
        struct Case: Decodable {
            struct Route: Decodable {
                let screen: String
                let league: String
                let player: String?
            }

            let name: String
            let route: Route?
        }

        let cases: [Case]
    }

    /// The fixture's cases, each with its APNs body as the app delegate's user info.
    static func cases() throws -> [(Parity.Case, [AnyHashable: Any])] {
        let data = try Fixtures.data("fixtures/parity/push.json")
        let parity = try JSONDecoder().decode(Parity.self, from: data)
        let raw = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let bodies = try #require(raw["cases"] as? [[String: Any]]).map { $0["apns"] as? [AnyHashable: Any] ?? [:] }
        return Array(zip(parity.cases, bodies))
    }

    @Test func everyPayloadOpensTheScreenItsPathNames() throws {
        let cases = try Self.cases()
        #expect(cases.count >= 7)
        for (item, userInfo) in cases {
            let route = PushRoute.of(userInfo)
            #expect(route?.screen.rawValue == item.route?.screen, "\(item.name)")
            #expect(route?.league == item.route?.league, "\(item.name)")
            #expect(route?.player == item.route?.player, "\(item.name)")
        }
    }

    /// The shell's routing of a tap (review M1): a fixture case whose league the member follows opens its
    /// screen; the same case with the league no longer followed, and a case with no route, open the
    /// league list.
    @Test func aTapOpensAFollowedLeaguesScreenElseTheLeagueList() throws {
        let cases = try Self.cases()
        let lineup = try #require(cases.first { $0.0.route?.screen == "lineup" })
        let route = try #require(PushRoute.of(lineup.1))
        #expect(PushRoute.destination(route, following: [route.league]) == .league(route))
        #expect(PushRoute.destination(route, following: ["6f1d1c52-2626-4a26-9a26-000000000099"]) == .leagueList)
        let unknown = try #require(cases.first { $0.0.route == nil })
        #expect(PushRoute.destination(PushRoute.of(unknown.1), following: [route.league]) == .leagueList)
    }

    final class Platform: PushPlatform {
        var granted: PushPermission
        let answer: Bool
        var asks = 0
        var registrations = 0

        init(_ granted: PushPermission, answer: Bool = true) {
            self.granted = granted
            self.answer = answer
        }

        func permission() async -> PushPermission {
            granted
        }

        func ask() async -> Bool {
            asks += 1
            granted = answer ? .allowed : .refused
            return answer
        }

        func register() {
            registrations += 1
        }
    }

    /// The push routes, each call recorded in `calls` ("put <device> <token>", "delete <device>"); a test
    /// can fail removals as with no signal, or refuse the next registrations with the API's 409.
    actor API: PushAPI {
        private(set) var calls: [String] = []
        private var offline = false
        private var conflicts = 0

        func goOffline(_ isOffline: Bool) {
            offline = isOffline
        }

        func refuse(times: Int) {
            conflicts = times
        }

        var registered: [String] {
            calls.filter { $0.hasPrefix("put") }
        }

        var removed: [String] {
            calls.filter { $0.hasPrefix("delete") }
        }

        func registerPush(device: String, token: String) async throws {
            calls.append("put \(device) \(token)")
            if conflicts > 0 {
                conflicts -= 1
                throw APIError.envelope(code: "conflict", message: "That token is another account's.")
            }
        }

        func removePush(device: String) async throws {
            if offline {
                throw URLError(.notConnectedToInternet)
            }
            calls.append("delete \(device)")
        }
    }

    nonisolated static let device = "6f1d1c52-2626-4a26-9a26-0000000000d1"
    nonisolated static let earlier = "6f1d1c52-2626-4a26-9a26-0000000000d9"
    static let token = Data([0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01, 0x02, 0x03])
    static let hex = "deadbeef00010203"

    @MainActor
    struct Phone {
        let api = API()
        let pendingAPI = API()
        let session = MemorySessionStore()
        let pending = MemorySessionStore()
        let platform: Platform
        let defaults: UserDefaults

        init(_ granted: PushPermission, answer: Bool = true) throws {
            platform = Platform(granted, answer: answer)
            defaults = try #require(UserDefaults(suiteName: "commish-push-\(UUID().uuidString)"))
        }

        func registrar() -> PushRegistrar {
            PushRegistrar(
                api: api, platform: platform, session: session,
                pending: PendingRemoval(store: pending, api: pendingAPI), defaults: defaults
            )
        }

        func signIn() async {
            await session.save(token: "t", deviceID: PushTests.device)
        }
    }

    @Test func signedInWithPushAllowedTheTokenRegistersAndANewOneReplacesIt() async throws {
        let phone = try Phone(.allowed)
        await phone.signIn()
        let registrar = phone.registrar()
        await registrar.start()
        #expect(phone.platform.registrations == 1)
        #expect(phone.platform.asks == 0)
        await registrar.tokenArrived(Self.token)
        await registrar.tokenArrived(Data([0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11]))
        #expect(await phone.api.registered == ["put \(Self.device) \(Self.hex)", "put \(Self.device) 0a0b0c0d0e0f1011"])
    }

    @Test func launchNeverAsksAndSignedOutNothingRegisters() async throws {
        let phone = try Phone(.notAsked)
        let registrar = phone.registrar()
        await registrar.start()
        #expect(phone.platform.asks == 0)
        #expect(phone.platform.registrations == 0)
        await registrar.tokenArrived(Self.token)
        #expect(await phone.api.registered.isEmpty)
    }

    @Test func theSwitchAsksOnceThenRegistersAndAllOffTakesTheTokenOff() async throws {
        let phone = try Phone(.notAsked)
        await phone.signIn()
        let registrar = phone.registrar()
        #expect(await registrar.enable() == .allowed)
        #expect(phone.platform.asks == 1)
        #expect(phone.platform.registrations == 1)
        await registrar.disable()
        #expect(await phone.api.removed == ["delete \(Self.device)"])
        #expect(registrar.wanted == false)
        // Every switch off: a relaunch registers nothing, a token Apple hands over is not sent.
        let relaunched = phone.registrar()
        await relaunched.start()
        await relaunched.tokenArrived(Self.token)
        #expect(phone.platform.registrations == 1)
        #expect(await phone.api.registered.isEmpty)
        #expect(await relaunched.enable() == .allowed)
        #expect(phone.platform.asks == 1)
        #expect(relaunched.wanted)
    }

    @Test func aRefusedPromptRegistersNothing() async throws {
        let phone = try Phone(.notAsked, answer: false)
        await phone.signIn()
        #expect(await phone.registrar().enable() == .refused)
        #expect(phone.platform.registrations == 0)
    }

    @Test func signOutTakesTheTokenOffBeforeTheDeviceIsRevoked() async throws {
        let phone = try Phone(.allowed)
        await phone.signIn()
        let registrar = phone.registrar()
        await registrar.disable()
        let account = StubAccount(leagues: [Fixtures.league])
        let session = AppSession(
            account: account, store: phone.session, cache: NullCache(), defaults: AppSessionTests.defaults(),
            signingOut: { await registrar.signingOut() }
        )
        await session.restore()
        await session.signOut()
        #expect(await phone.api.removed == ["delete \(Self.device)", "delete \(Self.device)"])
        #expect(await account.revoked == [Self.device])
        #expect(registrar.wanted)
        #expect(await phone.pending.deviceID() == nil)
    }

    /// Security M1: a sign out without signal keeps the removal, with the signed-out device's token, and
    /// the next launch takes the token off with it before anything registers.
    @Test func aFailedRemovalAtSignOutIsFinishedAtTheNextLaunchFirst() async throws {
        let phone = try Phone(.allowed)
        await phone.signIn()
        await phone.api.goOffline(true)
        await phone.registrar().signingOut()
        #expect(await phone.pending.deviceID() == Self.device)
        #expect(await phone.pending.token() == "t")
        await phone.session.clear()

        await phone.registrar().launched()
        #expect(await phone.pendingAPI.removed == ["delete \(Self.device)"])
        #expect(await phone.pending.deviceID() == nil)

        // Kept again (still no signal there), then finished before the next sign-in's registration.
        await phone.pending.save(token: "old", deviceID: Self.earlier)
        await phone.pendingAPI.goOffline(true)
        await phone.registrar().launched()
        #expect(await phone.pending.deviceID() == Self.earlier)
        await phone.pendingAPI.goOffline(false)
        await phone.signIn()
        let registrar = phone.registrar()
        await registrar.tokenArrived(Self.token)
        #expect(await phone.pendingAPI.removed.last == "delete \(Self.earlier)")
        #expect(await phone.pending.deviceID() == nil)
        #expect(await phone.api.registered == ["put \(Self.device) \(Self.hex)"])
    }

    /// Security M1: a token the API says another account's device holds tries the kept removal, then
    /// registers once more, and never loops.
    @Test func aTokenAnotherAccountHoldsRemovesThenRegistersOnce() async throws {
        let phone = try Phone(.allowed)
        await phone.signIn()
        let registrar = phone.registrar()
        // Refused every time: one more registration, never a loop.
        await phone.api.refuse(times: 5)
        await registrar.tokenArrived(Self.token)
        #expect(await phone.api.registered.count == 2)
        // A kept removal is tried first, then the 409's one more registration goes through.
        await phone.api.refuse(times: 1)
        await phone.pending.save(token: "old", deviceID: Self.earlier)
        await registrar.tokenArrived(Self.token)
        #expect(await phone.pendingAPI.removed == ["delete \(Self.earlier)"])
        #expect(await phone.pending.deviceID() == nil)
        #expect(await phone.api.registered.count == 4)
    }
}
