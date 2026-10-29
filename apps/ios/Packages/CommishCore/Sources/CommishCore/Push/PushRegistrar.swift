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

/// This phone's push registration (spec §5.3, Lane 288): the APNs device token on its own device
/// (PUT /devices/{id}/push) whenever Apple hands one over while push is wanted (each launch signed in,
/// and after the Account's switch asks), taken off when every switch goes off and at sign out. Whether
/// push is wanted is kept on the phone, so a launch after every switch went off registers nothing; it
/// starts wanted, so a phone that allowed push registers on its first launch signed in. The permission
/// is never asked here at launch: only the Account's switch asks.
@MainActor
public final class PushRegistrar: PushControl {
    static let offKey = "app.trycommish.push.off"
    nonisolated static let log = Logger(subsystem: "app.trycommish.ios", category: "push")

    private let api: any PushAPI
    private let platform: any PushPlatform
    private let deviceID: @Sendable () async -> String?
    private let defaults: UserDefaults

    public init(
        api: any PushAPI, platform: any PushPlatform, deviceID: @escaping @Sendable () async -> String?,
        defaults: UserDefaults = .standard
    ) {
        self.api = api
        self.platform = platform
        self.deviceID = deviceID
        self.defaults = defaults
    }

    /// Whether this phone wants pushes: true until every switch goes off here.
    public var wanted: Bool {
        !defaults.bool(forKey: Self.offKey)
    }

    /// Signed in (at launch, or a sign-in just finished): a phone that allowed push and wants it asks
    /// Apple for its token, which registers when it arrives. Never shows the prompt.
    public func start() async {
        guard wanted, await platform.permission() == .allowed else {
            return
        }
        platform.register()
    }

    /// Apple handed over the device token (each launch, and whenever it changes): registered on this
    /// phone's device while push is wanted and the phone is signed in.
    public func tokenArrived(_ token: Data) async {
        guard wanted, let device = await deviceID() else {
            return
        }
        do {
            try await api.registerPush(device: device, token: Self.hex(token))
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
        await remove()
    }

    /// The phone signs out: its token comes off the account before the device is revoked, and the next
    /// account on this phone starts wanting push again.
    public func signingOut() async {
        await remove()
        defaults.removeObject(forKey: Self.offKey)
    }

    private func remove() async {
        guard let device = await deviceID() else {
            return
        }
        do {
            try await api.removePush(device: device)
        } catch {
            Self.log.error("push removal failed: \(String(describing: error), privacy: .public)")
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
