import CommishAPI

/// A platform in the words the screens place it with (Lane 310): its name, where a move is made on it
/// (`placed`, "on ESPN"), the lead of a read's stamp ("ESPN 4 min ago") and its own page of a kind ("ESPN trades").
/// A real platform's words are `of(_:)`, so every screen says exactly what it said before. The store
/// graphics draw a neutral platform from shared/store/store-host.json through the same parameter, so no
/// platform is named in a store shot; the shipped apps never build one.
public struct HostWords: Equatable, Sendable {
    /// Where `own(_:)` puts the kind of page in the pattern.
    public static let noun = "{noun}"

    public let name: String
    public let placed: String
    public let stamp: String
    private let ownPattern: String

    public init(name: String, placed: String, stamp: String, own: String) {
        self.name = name
        self.placed = placed
        self.stamp = stamp
        ownPattern = own
    }

    /// A real platform: names.ts hostWords, placed with "on".
    public static func of(_ host: Components.Schemas.LeagueHost) -> HostWords {
        named(ValueWords.platform(host))
    }

    /// A platform by its name: "ESPN", "on ESPN", "ESPN", "ESPN {noun}".
    public static func named(_ name: String) -> HostWords {
        HostWords(name: name, placed: "on \(name)", stamp: name, own: "\(name) \(noun)")
    }

    /// The platform's own page of a kind: "ESPN trades", "ESPN waivers".
    public func own(_ kind: String) -> String {
        ownPattern.replacingOccurrences(of: Self.noun, with: kind)
    }
}
