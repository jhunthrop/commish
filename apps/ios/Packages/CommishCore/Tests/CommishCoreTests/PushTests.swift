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

    actor API: PushAPI {
        private(set) var registered: [(String, String)] = []
        private(set) var removed: [String] = []

        func registerPush(device: String, token: String) async throws {
            registered.append((device, token))
        }

        func removePush(device: String) async throws {
            removed.append(device)
        }
    }

    nonisolated static let device = "6f1d1c52-2626-4a26-9a26-0000000000d1"
    static let token = Data([0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01, 0x02, 0x03])

    static func defaults() throws -> UserDefaults {
        try #require(UserDefaults(suiteName: "commish-push-\(UUID().uuidString)"))
    }

    @Test func signedInWithPushAllowedTheTokenRegistersAndANewOneReplacesIt() async throws {
        let api = API()
        let platform = Platform(.allowed)
        let registrar = try PushRegistrar(
            api: api,
            platform: platform,
            deviceID: { Self.device },
            defaults: Self.defaults()
        )
        await registrar.start()
        #expect(platform.registrations == 1)
        #expect(platform.asks == 0)
        await registrar.tokenArrived(Self.token)
        await registrar.tokenArrived(Data([0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11]))
        let registered = await api.registered
        #expect(registered.map(\.0) == [Self.device, Self.device])
        #expect(registered.map(\.1) == ["deadbeef00010203", "0a0b0c0d0e0f1011"])
    }

    @Test func launchNeverAsksAndSignedOutNothingRegisters() async throws {
        let api = API()
        let platform = Platform(.notAsked)
        let registrar = try PushRegistrar(api: api, platform: platform, deviceID: { nil }, defaults: Self.defaults())
        await registrar.start()
        #expect(platform.asks == 0)
        #expect(platform.registrations == 0)
        await registrar.tokenArrived(Self.token)
        #expect(await api.registered.isEmpty)
    }

    @Test func theSwitchAsksOnceThenRegistersAndAllOffTakesTheTokenOff() async throws {
        let api = API()
        let platform = Platform(.notAsked)
        let defaults = try Self.defaults()
        let registrar = PushRegistrar(api: api, platform: platform, deviceID: { Self.device }, defaults: defaults)
        #expect(await registrar.enable() == .allowed)
        #expect(platform.asks == 1)
        #expect(platform.registrations == 1)
        await registrar.disable()
        #expect(await api.removed == [Self.device])
        #expect(registrar.wanted == false)
        // Every switch off: a relaunch registers nothing, a token Apple hands over is not sent.
        let relaunched = PushRegistrar(api: api, platform: platform, deviceID: { Self.device }, defaults: defaults)
        await relaunched.start()
        await relaunched.tokenArrived(Self.token)
        #expect(platform.registrations == 1)
        #expect(await api.registered.isEmpty)
        #expect(await relaunched.enable() == .allowed)
        #expect(platform.asks == 1)
        #expect(relaunched.wanted)
    }

    @Test func aRefusedPromptRegistersNothing() async throws {
        let platform = Platform(.notAsked, answer: false)
        let registrar = try PushRegistrar(
            api: API(),
            platform: platform,
            deviceID: { Self.device },
            defaults: Self.defaults()
        )
        #expect(await registrar.enable() == .refused)
        #expect(platform.registrations == 0)
    }

    @Test func signOutTakesTheTokenOffBeforeTheDeviceIsRevoked() async throws {
        let api = API()
        let store = MemorySessionStore()
        await store.save(token: "t", deviceID: Self.device)
        let defaults = try Self.defaults()
        let registrar = PushRegistrar(
            api: api, platform: Platform(.allowed), deviceID: { await store.deviceID() }, defaults: defaults
        )
        await registrar.disable()
        let account = StubAccount(leagues: [Fixtures.league])
        let session = AppSession(
            account: account, store: store, cache: NullCache(), defaults: AppSessionTests.defaults(),
            signingOut: { await registrar.signingOut() }
        )
        await session.restore()
        await session.signOut()
        #expect(await api.removed == [Self.device, Self.device])
        #expect(await account.revoked == [Self.device])
        #expect(registrar.wanted)
    }
}
