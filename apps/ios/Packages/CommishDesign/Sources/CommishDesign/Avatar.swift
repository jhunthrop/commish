import SwiftUI

/// A team's or a player's face where no image is drawn: their initials in a circle, the member's own
/// in the accent (web TeamAvatar.svelte and Face.svelte). On the lit board it takes the board's colours.
public struct Avatar: View {
    @Environment(\.colorScheme) private var colorScheme
    private let letters: String
    private let side: Double
    private let mine: Bool
    private let board: Bool

    public init(_ letters: String, side: Double, mine: Bool = false, board: Bool = false) {
        self.letters = letters
        self.side = side
        self.mine = mine
        self.board = board
    }

    /// The letters' size as a share of the circle (web/src/lib/ui/initials.ts INITIALS_SCALE).
    static let scale = 0.38

    public var body: some View {
        let theme = Theme(colorScheme)
        let (fill, ink) = colors
        Text(letters)
            .font(Faces.font(.ui, size: side * Self.scale, weight: .semibold))
            .foregroundStyle(theme.color(ink))
            .frame(width: side, height: side)
            .background(Circle().fill(theme.color(fill)))
            .accessibilityHidden(true)
    }

    private var colors: (ThemedColor, ThemedColor) {
        switch (mine, board) {
        case (true, true): (Tokens.Color.scoreboardNum, Tokens.Color.scoreboardNumInk)
        case (true, false): (Tokens.Color.accent, Tokens.Color.accentInk)
        case (false, true): (Tokens.Color.scoreboard2, Tokens.Color.scoreboardInk)
        case (false, false): (Tokens.Color.surface2, Tokens.Color.ink2)
        }
    }
}
