import Foundation

/// A link the site's association file hands to the app (web/scripts/well-known.ts APP_LINK_PATHS), as
/// the app routes it: the sign-in return to the sign-in flow, a player's page to his screen. A link on
/// another site, or a path the app does not route yet, is nil, which the app leaves alone.
public enum AppLink: Equatable, Sendable {
    case signIn
    case player(slug: String)

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
        return nil
    }
}
