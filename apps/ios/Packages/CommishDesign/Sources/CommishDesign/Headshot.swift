import SwiftUI

/// A player's face (web Face.svelte): his headshot in a circle, his initials (Avatar) while it loads,
/// when it cannot (no signal), and where he has none.
public struct Headshot: View {
    private let url: URL?
    private let initials: String
    private let side: Double

    public init(_ url: URL?, initials: String, side: Double) {
        self.url = url
        self.initials = initials
        self.side = side
    }

    public var body: some View {
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
