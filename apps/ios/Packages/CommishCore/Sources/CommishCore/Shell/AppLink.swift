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
        return reference(parts, query: URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [])
            .map(AppLink.reference)
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
