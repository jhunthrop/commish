import Foundation

/// Where a push opens the app (Lane 288): the screen its `path` names for the league it names
/// (shared/fixtures/parity/push.json, the API's payload). `/league/<id>` is the league's home,
/// `/league/<id>/start` its lineup (`?player=` the player it is about), `/league/<id>/waivers` its
/// waivers. Any other path, an absolute URL or none opens the app where it was.
public struct PushRoute: Equatable, Sendable {
    public enum Screen: String, Sendable {
        case league
        case lineup
        case waivers
    }

    public let screen: Screen
    public let league: String
    public let player: String?

    public init(screen: Screen, league: String, player: String? = nil) {
        self.screen = screen
        self.league = league
        self.player = player
    }

    /// The payload's key that names the screen.
    static let pathKey = "path"

    /// The route a push's payload names: an APNs notification's user info, or FCM's data.
    public static func of(_ payload: [AnyHashable: Any]) -> PushRoute? {
        (payload[pathKey] as? String).flatMap(of(path:))
    }

    /// The route a site path names; nil for one the app does not open from a push.
    public static func of(path: String) -> PushRoute? {
        guard path.hasPrefix("/"), !path.hasPrefix("//"),
              let parts = URLComponents(string: path), parts.scheme == nil, parts.host == nil
        else {
            return nil
        }
        let segments = parts.path.split(separator: "/").map(String.init)
        guard segments.count >= 2, segments[0] == "league", !segments[1].isEmpty else {
            return nil
        }
        let league = segments[1]
        switch segments.dropFirst(2).first {
        case nil where segments.count == 2:
            return PushRoute(screen: .league, league: league)
        case "start" where segments.count == 3:
            let player = parts.queryItems?.first { $0.name == "player" }?.value.flatMap { $0.isEmpty ? nil : $0 }
            return PushRoute(screen: .lineup, league: league, player: player)
        case "waivers" where segments.count == 3:
            return PushRoute(screen: .waivers, league: league)
        default:
            return nil
        }
    }
}
