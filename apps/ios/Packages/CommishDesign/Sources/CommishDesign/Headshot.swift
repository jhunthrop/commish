import SwiftUI

/// A player's face (web Face.svelte): his headshot in a circle, his initials (Avatar) while it loads,
/// when it cannot (no signal), and where he has none. A defense's face (`club`, B245) is its club's
/// chip, and no image is asked for: the apps draw no team logo.
public struct Headshot: View {
    private let url: URL?
    private let initials: String
    private let side: Double
    private let club: String?

    public init(_ url: URL?, initials: String, side: Double, club: String? = nil) {
        self.url = url
        self.initials = initials
        self.side = side
        self.club = club
    }

    public var body: some View {
        if let club {
            Avatar(initials, side: side, club: club)
        } else {
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFill()
                } else {
                    Avatar(initials, side: side)
                }
            }
            .frame(width: side, height: side)
            .clipShape(Circle())
            .accessibilityHidden(true)
        }
    }
}
