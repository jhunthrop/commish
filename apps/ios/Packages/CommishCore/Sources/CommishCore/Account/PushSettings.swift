import Foundation

/// A kind of push the account can turn on or off (spec 2026-10-24-native-mobile-apps-design §5.3): the
/// Thursday read, a starter's status change, waivers clearing.
public enum PushKind: String, CaseIterable, Codable, Sendable {
    case thursday
    case status
    case waivers
}

/// The push switches and quiet hours, minutes after midnight on the phone's clock. Every kind is on and
/// quiet hours run 23:00 to 08:00 until the member changes them (§5.3's defaults).
public struct PushSettings: Codable, Equatable, Sendable {
    public let off: Set<PushKind>
    public let quietFrom: Int
    public let quietTo: Int

    public static let standard = PushSettings(off: [], quietFrom: 23 * 60, quietTo: 8 * 60)
    static let minutesInADay = 24 * 60

    public init(off: Set<PushKind>, quietFrom: Int, quietTo: Int) {
        self.off = off
        self.quietFrom = Self.clamped(quietFrom)
        self.quietTo = Self.clamped(quietTo)
    }

    public func on(_ kind: PushKind) -> Bool {
        !off.contains(kind)
    }

    /// These settings with one kind turned on or off.
    public func with(_ kind: PushKind, isOn: Bool) -> PushSettings {
        PushSettings(off: isOn ? off.subtracting([kind]) : off.union([kind]), quietFrom: quietFrom, quietTo: quietTo)
    }

    /// These settings with new quiet hours.
    public func with(quietFrom: Int, quietTo: Int) -> PushSettings {
        PushSettings(off: off, quietFrom: quietFrom, quietTo: quietTo)
    }

    private static func clamped(_ minutes: Int) -> Int {
        ((minutes % minutesInADay) + minutesInADay) % minutesInADay
    }
}

/// Where the switches are kept. The account does not carry them yet (GET and PATCH /me have no push
/// fields), so the app keeps them on the phone and the screen says so; once the API carries them a
/// store that writes PATCH /me takes this one's place.
@MainActor
public protocol PushStore: AnyObject {
    func load() -> PushSettings
    func save(_ settings: PushSettings)
}

/// The switches in the phone's defaults, as JSON under one key; a value that will not read is the
/// standard settings.
@MainActor
public final class DevicePushStore: PushStore {
    static let key = "app.trycommish.push"
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() -> PushSettings {
        guard let data = defaults.data(forKey: Self.key),
              let settings = try? JSONDecoder().decode(PushSettings.self, from: data)
        else {
            return .standard
        }
        return settings
    }

    public func save(_ settings: PushSettings) {
        guard let data = try? JSONEncoder().encode(settings) else {
            return
        }
        defaults.set(data, forKey: Self.key)
    }
}

/// The switches in memory, for a test or a snapshot.
@MainActor
public final class MemoryPushStore: PushStore {
    private var settings: PushSettings

    public init(_ settings: PushSettings = .standard) {
        self.settings = settings
    }

    public func load() -> PushSettings {
        settings
    }

    public func save(_ settings: PushSettings) {
        self.settings = settings
    }
}
