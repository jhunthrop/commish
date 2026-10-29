import CommishAPI
import Foundation
import os

/// Whether the phone lets Commish show a push: not asked yet, allowed, or refused (in Settings).
public enum PushPermission: Sendable, Equatable {
    case notAsked
    case allowed
    case refused
}

/// The phone's side of push: its permission, the system prompt, and asking Apple for the device token
/// (which arrives later at the app delegate, then `PushRegistrar.tokenArrived`). The app's is
/// UNUserNotificationCenter and UIApplication; a test's records the calls.
@MainActor
public protocol PushPlatform: AnyObject {
    func permission() async -> PushPermission
    /// The system prompt, shown once: whether the member allowed it.
    func ask() async -> Bool
    /// Asks Apple for this install's device token.
    func register()
}

/// What the Account's switches ask of push: the permission, turning push on (asking first when the
/// phone has not been asked) and off.
@MainActor
public protocol PushControl: AnyObject {
    func permission() async -> PushPermission
    /// Push on for this phone: the system prompt if it was never shown, then the token registered once
    /// allowed. Answers the permission it ended on.
    func enable() async -> PushPermission
    /// Push off for this phone: its token taken off the account.
    func disable() async
}

/// A removal the phone could not finish at sign out (no signal): the signed-out device's id and token kept
/// in their own Keychain item, and the client that takes the token off with that token (Lane 288 security
/// M1). Until it is done, the previous member's pushes would keep arriving here.
public struct PendingRemoval: Sendable {
    let store: any SessionStore
    let api: any PushAPI

    public init(store: any SessionStore, api: any PushAPI) {
        self.store = store
        self.api = api
    }
}

/// This phone's push registration (spec §5.3, Lane 288): the APNs device token on its own device
/// (PUT /devices/{id}/push) whenever Apple hands one over while push is wanted and allowed (each launch
/// signed in, and after the Account's switch asks), taken off when every switch goes off and at sign
/// out. Whether push is wanted is kept on the phone, so a launch after every switch went off registers
/// nothing; it starts wanted, so a phone that allowed push registers on its first launch signed in. The
/// permission is never asked here at launch: only the Account's switch asks. A removal that failed at
/// sign out is kept and tried again at the next launch before any registration, and a registration the
/// API refuses because another account's device holds the token tries that removal, then once more.
@MainActor
public final class PushRegistrar: PushControl {
    static let offKey = "app.trycommish.push.off"
    nonisolated static let log = Logger(subsystem: "app.trycommish.ios", category: "push")
    /// The API's code for a token another account's device holds (devices/push.go ErrTokenTaken).
    static let conflict = "conflict"
    /// The API's code for a device that is gone.
    static let notFound = "not_found"

    private let api: any PushAPI
    private let platform: any PushPlatform
    private let session: any SessionStore
    private let pending: PendingRemoval
    private let defaults: UserDefaults

    public init(
        api: any PushAPI, platform: any PushPlatform, session: any SessionStore, pending: PendingRemoval,
        defaults: UserDefaults = .standard
    ) {
        self.api = api
        self.platform = platform
        self.session = session
        self.pending = pending
        self.defaults = defaults
    }

    /// Whether this phone wants pushes: true until every switch goes off here.
    public var wanted: Bool {
        !defaults.bool(forKey: Self.offKey)
    }

    /// At launch, signed in or not: a removal left from a sign out without signal is tried again.
    public func launched() async {
        await finishPendingRemoval()
    }

    /// Signed in (at launch, or a sign-in just finished): a phone that allowed push and wants it asks
    /// Apple for its token, which registers when it arrives. Never shows the prompt.
    public func start() async {
        await finishPendingRemoval()
        guard wanted, await platform.permission() == .allowed else {
            return
        }
        platform.register()
    }

    /// Apple handed over the device token (each launch, and whenever it changes): registered on this
    /// phone's device while push is wanted and allowed and the phone is signed in, after any removal left
    /// from a sign out. A token another account's device holds tries that removal and registers once more.
    public func tokenArrived(_ token: Data) async {
        await finishPendingRemoval()
        guard wanted, await platform.permission() == .allowed, let device = await session.deviceID() else {
            return
        }
        let hex = Self.hex(token)
        do {
            try await api.registerPush(device: device, token: hex)
        } catch APIError.envelope(Self.conflict, _) {
            await finishPendingRemoval()
            await registerOnce(device: device, token: hex)
        } catch {
            Self.log.error("push registration failed: \(String(describing: error), privacy: .public)")
        }
    }

    public func permission() async -> PushPermission {
        await platform.permission()
    }

    public func enable() async -> PushPermission {
        var permission = await platform.permission()
        if permission == .notAsked {
            permission = await platform.ask() ? .allowed : .refused
        }
        guard permission == .allowed else {
            return permission
        }
        defaults.set(false, forKey: Self.offKey)
        platform.register()
        return permission
    }

    public func disable() async {
        defaults.set(true, forKey: Self.offKey)
        guard let device = await session.deviceID() else {
            return
        }
        _ = await remove(device: device, with: api)
    }

    /// The phone signs out: its token comes off the account before the device is revoked, and the next
    /// account on this phone starts wanting push again. Without signal the removal is kept, with this
    /// device's token, for the next launch.
    public func signingOut() async {
        defaults.removeObject(forKey: Self.offKey)
        guard let device = await session.deviceID() else {
            return
        }
        if await remove(device: device, with: api) {
            return
        }
        guard let token = await session.token() else {
            return
        }
        do {
            try await pending.store.save(token: token, deviceID: device)
        } catch {
            Self.log.error("push removal not kept: \(String(describing: error), privacy: .public)")
        }
    }

    /// The removal a sign out could not finish, with the signed-out device's own token; done once the API
    /// takes it or says the device is gone (its token refused, or no such device).
    func finishPendingRemoval() async {
        guard let device = await pending.store.deviceID() else {
            return
        }
        if await remove(device: device, with: pending.api) {
            await pending.store.clear()
        }
    }

    private func registerOnce(device: String, token: String) async {
        do {
            try await api.registerPush(device: device, token: token)
        } catch {
            Self.log.error("push registration failed again: \(String(describing: error), privacy: .public)")
        }
    }

    /// Whether the device's token is off the account: taken off, or the device is gone already.
    private func remove(device: String, with client: any PushAPI) async -> Bool {
        do {
            try await client.removePush(device: device)
            return true
        } catch where APIError.signsOut(error) {
            return true
        } catch APIError.envelope(Self.notFound, _) {
            return true
        } catch {
            Self.log.error("push removal failed: \(String(describing: error), privacy: .public)")
            return false
        }
    }

    /// The device token as the API takes it: lowercase hex.
    static func hex(_ token: Data) -> String {
        token.map { String(format: "%02x", $0) }.joined()
    }
}

/// Push that answers a fixed permission and counts its calls, for a test or a snapshot: `enable`
/// answers `asked` when the phone was never asked.
@MainActor
public final class StaticPush: PushControl {
    public private(set) var current: PushPermission
    private let asked: PushPermission
    public private(set) var enabled = 0
    public private(set) var disabled = 0

    public init(_ permission: PushPermission = .allowed, asked: PushPermission = .allowed) {
        current = permission
        self.asked = asked
    }

    public func permission() async -> PushPermission {
        current
    }

    public func enable() async -> PushPermission {
        enabled += 1
        if current == .notAsked {
            current = asked
        }
        return current
    }

    public func disable() async {
        disabled += 1
    }
}
