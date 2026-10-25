import Foundation

/// The web's number and time formats (web/src/lib/format/number.ts and clock.ts), ported so a figure
/// reads the same on the phone as on the site. Every time takes its zone: nothing reads the device's.
public enum Formatting {
    /// `value.toFixed(decimals)` as JavaScript gives it: the exact binary value rounded, a tie up.
    public static func fixed(_ value: Double, _ decimals: Int = 1) -> String {
        let digits = String(format: "%.40f", abs(value))
        let parts = digits.split(separator: ".", maxSplits: 1).map(String.init)
        var whole = Array(parts[0])
        var fraction = Array(parts.count > 1 ? parts[1] : "")
        let next = fraction.count > decimals ? fraction[decimals] : "0"
        fraction = Array(fraction.prefix(decimals))
        if next >= "5" {
            var digits = whole + fraction
            var index = digits.count - 1
            while index >= 0 {
                if digits[index] == "9" {
                    digits[index] = "0"
                    index -= 1
                } else {
                    digits[index] = Character(String((digits[index].wholeNumberValue ?? 0) + 1))
                    break
                }
            }
            if index < 0 {
                digits.insert("1", at: 0)
            }
            whole = Array(digits.prefix(digits.count - decimals))
            fraction = Array(digits.suffix(decimals))
        }
        let text = decimals > 0 ? "\(String(whole)).\(String(fraction))" : String(whole)
        // JavaScript keeps the sign of a negative that rounds to zero: "-0.0".
        return value < 0 ? "-\(text)" : text
    }

    /// A number as JavaScript's `String(n)` writes it: "0.5", "1", "-2".
    public static func number(_ value: Double) -> String {
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }

    /// A count as `toLocaleString('en-US')` writes it: "1,000".
    public static func grouped(_ value: Int) -> String {
        value.formatted(.number.grouping(.automatic).locale(Locale(identifier: "en_US")))
    }

    /// number.ts count: a figure as a reader reads a count, whole and grouped, "1,467".
    public static func count(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// "$1,000".
    public static func dollars(_ value: Int) -> String {
        "$\(grouped(value))"
    }

    /// "1st", "2nd", "3rd", "11th", "23rd".
    public static func ordinal(_ value: Int) -> String {
        let tens = value % 100
        if (11 ... 13).contains(tens) {
            return "\(value)th"
        }
        switch value % 10 {
        case 1: return "\(value)st"
        case 2: return "\(value)nd"
        case 3: return "\(value)rd"
        default: return "\(value)th"
        }
    }

    /// "1 player", "9 players".
    public static func plural(_ count: Int, _ one: String, _ many: String? = nil) -> String {
        "\(count) \(count == 1 ? one : many ?? "\(one)s")"
    }

    /// "Sun 1:00 pm": an instant on the member's clock, as the web's weekdayTime writes it.
    public static func weekdayTime(_ date: Date, zone: TimeZone) -> String {
        format(date, "EEE h:mm a", zone: zone)
    }

    /// "Thursday": an instant's day on the member's clock, as the web's weekdayName writes it.
    public static func weekdayName(_ date: Date, zone: TimeZone) -> String {
        format(date, "EEEE", zone: zone)
    }

    /// "7:00 pm": a time of day on the member's clock, as the web's timeOfDay.
    public static func timeOfDay(_ date: Date, zone: TimeZone) -> String {
        format(date, "h:mm a", zone: zone)
    }

    /// "Oct 21": a day on the member's clock, as the web's shortDay.
    public static func shortDay(_ date: Date, zone: TimeZone) -> String {
        format(date, "MMM d", zone: zone)
    }

    /// "October 21": a day with its month in words, as the web's monthDayLabel.
    public static func monthDay(_ date: Date, zone: TimeZone) -> String {
        format(date, "MMMM d", zone: zone)
    }

    /// Whether two instants fall on the same calendar day on the member's clock (the web's sameDay).
    public static func sameDay(_ lhs: Date, _ rhs: Date, zone: TimeZone) -> Bool {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.isDate(lhs, inSameDayAs: rhs)
    }

    private static func format(_ date: Date, _ pattern: String, zone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = pattern
        formatter.amSymbol = "am"
        formatter.pmSymbol = "pm"
        return formatter.string(from: date)
    }

    /// "CT": the zone's generic short name after a time, the same in summer and winter (clock.ts
    /// zoneShort); the zone's id where none is named.
    public static func zoneShort(_ zone: TimeZone) -> String {
        zone.localizedName(for: .shortGeneric, locale: Locale(identifier: "en_US")) ?? zone.identifier
    }

    /// "Sun 3:25 pm CT": a kickoff with its zone (clock.ts kickoffAt).
    public static func kickoffAt(_ date: Date, zone: TimeZone) -> String {
        "\(weekdayTime(date, zone: zone)) \(zoneShort(zone))"
    }

    /// "Wed Oct 21, 11:12 am CT": the player page's one stamp format (clock.ts stampAt), as the nightly's
    /// week read caption says its write.
    public static func stampAt(_ date: Date, zone: TimeZone) -> String {
        let day = format(date, "EEE", zone: zone)
        return "\(day) \(shortDay(date, zone: zone)), \(timeOfDay(date, zone: zone)) \(zoneShort(zone))"
    }

    /// The zone's short name, "Central" for Central Time, as the web's zoneWord says it.
    public static func zoneWord(_ zone: TimeZone) -> String {
        let name = zone.localizedName(for: .generic, locale: Locale(identifier: "en_US")) ?? zone.identifier
        let suffix = " Time"
        return name.hasSuffix(suffix) && !name.dropLast(suffix.count).contains(" ")
            ? String(name.dropLast(suffix.count))
            : name
    }
}
