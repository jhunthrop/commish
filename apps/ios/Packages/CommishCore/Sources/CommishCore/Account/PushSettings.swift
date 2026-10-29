import CommishAPI
import Foundation

/// A kind of push the account can turn on or off (spec 2026-10-24-native-mobile-apps-design §5.3): the
/// Thursday read, a starter's status change, waivers clearing.
public enum PushKind: String, CaseIterable, Sendable {
    case thursday
    case status
    case waivers
}

/// The push switches and quiet hours, minutes after midnight on the phone's clock, as the account holds
/// them (GET and PATCH /me `notifications`, Lane 262). Every kind is on and quiet hours run 23:00 to 08:00
/// until the member changes them (§5.3's defaults, and an API that sends none).
public struct PushSettings: Equatable, Sendable {
    public let off: Set<PushKind>
    public let quietFrom: Int
    public let quietTo: Int

    public static let standard = PushSettings(off: [], quietFrom: 23 * 60, quietTo: 8 * 60)
    static let minutesInADay = 24 * 60
    private static let minutesInAnHour = 60

    public init(off: Set<PushKind>, quietFrom: Int, quietTo: Int) {
        self.off = off
        self.quietFrom = Self.clamped(quietFrom)
        self.quietTo = Self.clamped(quietTo)
    }

    /// The account's settings; an API that sends none is the standard settings.
    public init(_ answer: NotificationSettingsAnswer?) {
        guard let answer else {
            self = .standard
            return
        }
        let kinds = answer.kinds
        let isOn: [PushKind: Bool] = [
            .thursday: kinds.weekReads,
            .status: kinds.starterStatus,
            .waivers: kinds.waiverClaims,
        ]
        self.init(
            off: Set(PushKind.allCases.filter { isOn[$0] == false }),
            quietFrom: Self.minutes(answer.quietStart) ?? Self.standard.quietFrom,
            quietTo: Self.minutes(answer.quietEnd) ?? Self.standard.quietTo
        )
    }

    public func on(_ kind: PushKind) -> Bool {
        !off.contains(kind)
    }

    /// Whether any kind is on: with none, the phone takes its token off.
    public var anyOn: Bool {
        off.count < PushKind.allCases.count
    }

    /// These settings with every kind off, as the switches draw while the phone may not show a push.
    public var allOff: PushSettings {
        PushSettings(off: Set(PushKind.allCases), quietFrom: quietFrom, quietTo: quietTo)
    }

    /// These settings with one kind turned on or off.
    public func with(_ kind: PushKind, isOn: Bool) -> PushSettings {
        PushSettings(off: isOn ? off.subtracting([kind]) : off.union([kind]), quietFrom: quietFrom, quietTo: quietTo)
    }

    /// These settings with new quiet hours.
    public func with(quietFrom: Int, quietTo: Int) -> PushSettings {
        PushSettings(off: off, quietFrom: quietFrom, quietTo: quietTo)
    }

    /// The whole of these settings as PATCH /me writes them, quiet hours in `zone`, the phone's own.
    public func change(zone: TimeZone) -> NotificationSettingsChange {
        NotificationSettingsChange(
            timeZone: zone.identifier,
            quietStart: Self.clock(quietFrom),
            quietEnd: Self.clock(quietTo),
            kinds: .init(starterStatus: on(.status), weekReads: on(.thursday), waiverClaims: on(.waivers))
        )
    }

    /// "HH:MM" from minutes after midnight.
    static func clock(_ minutes: Int) -> String {
        String(format: "%02d:%02d", minutes / minutesInAnHour, minutes % minutesInAnHour)
    }

    /// Minutes after midnight from "HH:MM"; nil for anything else.
    static func minutes(_ clock: String) -> Int? {
        let parts = clock.split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0 ..< 24).contains(hour), (0 ..< minutesInAnHour).contains(minute)
        else {
            return nil
        }
        return hour * minutesInAnHour + minute
    }

    private static func clamped(_ minutes: Int) -> Int {
        ((minutes % minutesInADay) + minutesInADay) % minutesInADay
    }
}
