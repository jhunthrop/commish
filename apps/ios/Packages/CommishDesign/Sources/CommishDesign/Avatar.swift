import SwiftUI

/// A team's or a player's face where no image is drawn: their initials in a circle, the member's own
/// in the accent (web TeamAvatar.svelte and Face.svelte). On the lit board it takes the board's colours.
/// A club (`club`, a defense's face, B245) is the same circle: its abbreviation on its colour from the
/// shared table (`Tokens.Club`), our own drawing, never a team logo; a club the table does not know
/// keeps the plain circle with its abbreviation.
public struct Avatar: View {
    @Environment(\.colorScheme) private var colorScheme
    private let letters: String
    private let side: Double
    private let mine: Bool
    private let board: Bool
    private let chip: ClubColor?

    /// `club`, where given, is drawn in place of `letters`, in its colours.
    public init(_ letters: String, side: Double, mine: Bool = false, board: Bool = false, club: String? = nil) {
        self.letters = club ?? letters
        self.side = side
        self.mine = mine
        self.board = board
        chip = club.flatMap { Tokens.Club.colors[$0] }
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
        if let chip {
            return (ThemedColor(light: chip.fill, dark: chip.fill), ThemedColor(light: chip.ink, dark: chip.ink))
        }
        return switch (mine, board) {
        case (true, true): (Tokens.Color.scoreboardNum, Tokens.Color.scoreboardNumInk)
        case (true, false): (Tokens.Color.accent, Tokens.Color.accentInk)
        case (false, true): (Tokens.Color.scoreboard2, Tokens.Color.scoreboardInk)
        case (false, false): (Tokens.Color.surface2, Tokens.Color.ink2)
        }
    }
}
