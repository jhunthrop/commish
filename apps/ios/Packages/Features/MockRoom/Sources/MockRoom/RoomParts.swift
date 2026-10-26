import Board
import CommishCore
import CommishDesign
import SwiftUI

/// The room's widths at 390 (the room's phone grid, Pool.svelte --pool-cols): his face, the player
/// taking the rest, Over repl, the chance.
enum RoomColumn {
    static let face: Double = 32
    static let value: Double = 64
    static let chance: Double = 78
    static let slot: Double = 44
    static let pick: Double = 44
}

/// A panel as the web draws one (Panel.svelte): the surface, its line, the accent edge or a quiet one.
struct RoomPanel<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    var accent = false
    @ViewBuilder let content: Content

    var body: some View {
        let theme = Theme(colorScheme)
        content
            .padding(Tokens.Space.s3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface)))
            .overlay(
                RoundedRectangle(cornerRadius: Tokens.Radius.md)
                    .strokeBorder(
                        theme.color(accent ? Tokens.Color.accent : Tokens.Color.line),
                        lineWidth: accent ? 2 : 1
                    )
            )
            .padding(.horizontal, Tokens.Space.s3)
    }
}

/// A column head in the room's small caps (Label.svelte).
struct Head: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String
    var alignment: Alignment = .trailing

    var body: some View {
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .lineLimit(2)
            .minimumScaleFactor(0.75)
            .multilineTextAlignment(alignment == .leading ? .leading : .trailing)
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink3))
            .frame(maxWidth: alignment == .leading ? .infinity : nil, alignment: alignment)
    }
}

/// A player's face, his name the biggest thing in the row, his pill and club under it.
struct Who: View {
    @Environment(\.colorScheme) private var colorScheme
    let player: RoomPlayer
    var face = RoomColumn.face

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 6) {
            Headshot(
                URL(string: player.headshot),
                initials: Initials.of(player.name),
                side: face,
                club: player.clubMark
            )
            VStack(alignment: .leading, spacing: 3) {
                Text(player.name)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                HStack(spacing: 6) {
                    PositionPill(player.positionRank > 0 ? player.pill : player.position)
                    Text(player.team)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                        .textCase(.uppercase)
                        .foregroundStyle(theme.color(Tokens.Color.ink3))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A figure in the number face, right aligned at its column's width.
struct Figure: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String
    var width: Double
    var ink: ThemedColor = Tokens.Color.ink
    var size: Double = Tokens.TypeScale.lg

    var body: some View {
        Text(text)
            .font(Faces.font(.num, size: size, weight: .semibold))
            .monospacedDigit()
            .lineLimit(2)
            .minimumScaleFactor(0.7)
            .multilineTextAlignment(.trailing)
            .foregroundStyle(Theme(colorScheme).color(ink))
            .frame(width: width, alignment: .trailing)
    }
}

/// Over repl. on its round's tint (Row.svelte .heat-1 to .heat-4, .heat-neg), the Board's tile.
struct Value: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String
    let heat: Heat?

    var body: some View {
        let theme = Theme(colorScheme)
        Figure(
            text: text, width: RoomColumn.value, ink: heat == nil ? Tokens.Color.ink3 : Tokens.Color.ink2,
            size: heat == nil ? Tokens.TypeScale.xs : Tokens.TypeScale.lg
        )
        .background(alignment: .trailing) {
            if let heat, let tint = BoardRowView.tint(heat) {
                RoundedRectangle(cornerRadius: Tokens.Radius.sm).fill(theme.color(tint)).frame(height: 26)
                    .padding(.leading, -6)
            }
        }
    }
}

/// A chance as the room's cell prints it (StillThereCell.svelte): the figure, its meter, what it is
/// of; or the words for none.
struct Chance: View {
    @Environment(\.colorScheme) private var colorScheme
    let chance: String?
    let label: String
    let missing: String

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .trailing, spacing: 2) {
            if let chance {
                Text(chance)
                    .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                GeometryReader { box in
                    ZStack(alignment: .leading) {
                        Capsule().fill(theme.color(Tokens.Color.surface2))
                        Capsule().fill(theme.color(Tokens.Color.accent))
                            .frame(width: box.size.width * Self.share(chance))
                    }
                }
                .frame(height: 4)
                Text(label)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .lineLimit(2)
                    .multilineTextAlignment(.trailing)
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            } else {
                Text(missing)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
        }
        .frame(width: RoomColumn.chance, alignment: .trailing)
    }

    /// The meter's share from the printed chance: "<1%" is 0, ">99%" is 1.
    static func share(_ chance: String) -> Double {
        if chance.hasPrefix("<") {
            return 0
        }
        if chance.hasPrefix(">") {
            return 1
        }
        return (Double(chance.dropLast()) ?? 0) / 100
    }
}

/// A line of the small words: ink 2, the small face.
struct Note: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String

    var body: some View {
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink2))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A fact strip (FactStrip.svelte): label under value, words in the words' face.
struct Cells: View {
    @Environment(\.colorScheme) private var colorScheme
    let cells: [MockCell]
    var spacing = Tokens.Space.s4

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .bottom, spacing: spacing) {
            ForEach(cells) { cell in
                VStack(alignment: .leading, spacing: 1) {
                    Text(cell.value)
                        .font(cell.word
                            ? Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold)
                            : Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    Head(text: cell.label, alignment: .leading).fixedSize()
                }
                .fixedSize()
            }
        }
    }
}
