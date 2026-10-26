import Foundation

/// A link the site's association file hands to the app (web/scripts/well-known.ts APP_LINK_PATHS), as
/// the app routes it: the sign-in return to the sign-in flow, a player's page to his screen. A link on
/// another site, or a path the app does not route yet, is nil, which the app leaves alone.
public enum AppLink: Equatable, Sendable {
    case signIn
    case player(slug: String)
    /// A reference page the app draws (ADP, compare, the clubs, a club, the schedule), pushed where it
    /// is tapped: the site's links between those pages open them in the app.
    case reference(ShellRoute)
    /// The live-draft companion: its start page (/companion/new, `?replay=1` for the development
    /// replay, as the web reads it) or a followed draft (/companion/<id>).
    case companion(ShellRoute)
    /// The mock room: its setup (/mock, /mock/new) or a shared draft by its code (/mock/share/<code>).
    case mock(ShellRoute)

    public static func of(_ url: URL) -> AppLink? {
        guard url.scheme == SiteLinks.origin.scheme, url.host() == SiteLinks.origin.host() else {
            return nil
        }
        if url.path() == SignInRoute.returnTo.path() {
            return .signIn
        }
        let parts = url.pathComponents.filter { $0 != "/" }
        if parts.count == 2, parts[0] == "players", !parts[1].isEmpty {
            return .player(slug: parts[1])
        }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if parts.count == 2, parts[0] == "companion", !parts[1].isEmpty {
            let replay = query.first { $0.name == "replay" }?.value == "1"
            return .companion(parts[1] == "new" ? .companionNew(replay: replay) : .companion(id: parts[1]))
        }
        if parts.first == "mock" {
            let league = query.first { $0.name == "league" }?.value.flatMap { $0.isEmpty ? nil : $0 }
            return mock(parts, league: league).map(AppLink.mock)
        }
        return reference(parts, query: query).map(AppLink.reference)
    }

    /// The mock room's pages by their site paths (web links.ts, nav.ts MOCK_SETUP): /mock and /mock/new
    /// the setup (on the saved league `?league=` names), /mock/share/<code> a shared draft. A room by its
    /// id is the account's on the site.
    private static func mock(_ parts: [String], league: String?) -> ShellRoute? {
        switch parts.count {
        case 1: .mockSetup(from: nil, league: league)
        case 2 where parts[1] == "new": .mockSetup(from: nil, league: league)
        case 3 where parts[1] == "share" && !parts[2].isEmpty: .sharedMock(code: parts[2])
        default: nil
        }
    }

    /// The reference pages by their site paths (web links.ts): /adp/<format>, /compare?a=&b=, /clubs,
    /// /clubs/<abbr>, /schedule.
    private static func reference(_ parts: [String], query: [URLQueryItem]) -> ShellRoute? {
        let named = { (name: String) in query.first { $0.name == name }?.value.flatMap { $0.isEmpty ? nil : $0 } }
        switch (parts.first, parts.count) {
        case ("adp", 2): return .adp(format: parts[1])
        case ("compare", 1): return .compare(first: named("a"), second: named("b"))
        case ("clubs", 1): return .clubs
        case ("clubs", 2): return .club(abbr: parts[1])
        case ("schedule", 1): return .schedule
        default: return nil
        }
    }
}
