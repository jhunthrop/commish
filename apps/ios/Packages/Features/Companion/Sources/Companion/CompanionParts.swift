import Board
import CommishCore
import CommishDesign
import SwiftUI

/// The companion's widths at 390 (the room's phone grid, Pool.svelte --pool-cols): his face, the player
/// taking the rest, Over repl, the chance.
enum CompanionColumn {
    static let face: Double = 32
    static let value: Double = 64
    static let chance: Double = 78
    static let slot: Double = 44
    static let pick: Double = 44
}

/// A player's face: his headshot, his initials while it loads or where he has none.
struct PlayerFace: View {
    let player: RoomPlayer
    var side: Double = CompanionColumn.face

    var body: some View {
        Headshot(URL(string: player.headshot), initials: Initials.of(player.name), side: side, club: player.clubMark)
    }
}

/// A panel as the web draws one (Panel.svelte): the surface, its line, the accent or the loss edge.
struct Panel<Content: View>: View {
    enum Edge {
        case plain
        case accent
        case quiet
        case loss
    }

    @Environment(\.colorScheme) private var colorScheme
    var edge: Edge = .plain
    @ViewBuilder let content: Content

    var body: some View {
        let theme = Theme(colorScheme)
        content
            .padding(Tokens.Space.s3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface)))
            .overlay(
                RoundedRectangle(cornerRadius: Tokens.Radius.md)
                    .strokeBorder(theme.color(Self.line(edge)), lineWidth: edge == .plain || edge == .quiet ? 1 : 2)
            )
            .padding(.horizontal, Tokens.Space.s3)
    }

    static func line(_ edge: Edge) -> ThemedColor {
        switch edge {
        case .plain, .quiet: Tokens.Color.line
        case .accent: Tokens.Color.accent
        case .loss: Tokens.Color.lossInk
        }
    }
}

/// A line of the small words under a head: ink 2, the small face.
struct NoteText: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String
    var ink: ThemedColor = Tokens.Color.ink2

    var body: some View {
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
            .foregroundStyle(Theme(colorScheme).color(ink))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A column head in the room's small caps (Label.svelte).
struct HeadText: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String
    var alignment: Alignment = .trailing
    var lines = 2

    var body: some View {
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .lineLimit(lines)
            .minimumScaleFactor(0.75)
            .multilineTextAlignment(alignment == .leading ? .leading : .trailing)
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink3))
            .frame(maxWidth: alignment == .leading ? .infinity : nil, alignment: alignment)
    }
}

/// A figure cell in the number face, right aligned.
struct FigureText: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String
    var width: Double
    var ink: ThemedColor = Tokens.Color.ink
    var size: Double = Tokens.TypeScale.lg

    var body: some View {
        Text(text)
            .font(Faces.font(.num, size: size, weight: .semibold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .foregroundStyle(Theme(colorScheme).color(ink))
            .frame(width: width, alignment: .trailing)
    }
}

/// His name the biggest thing in the row, his pill and club under it.
struct WhoCell: View {
    @Environment(\.colorScheme) private var colorScheme
    let player: RoomPlayer
    var extra: String?

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 3) {
            Text(player.name)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink))
            HStack(spacing: 6) {
                if player.positionRank > 0 {
                    PositionPill(player.pill)
                } else {
                    PositionPill(player.position)
                }
                Text(player.team)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                if let extra {
                    Text(extra)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                        .foregroundStyle(theme.color(Tokens.Color.ink3))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A strip of picks (PickStrip.svelte): the lead figure and its lines, then each face with his last
/// name and its lines, the newest marked; sideways where it runs past the phone.
struct PickStripView: View {
    @Environment(\.colorScheme) private var colorScheme
    let strip: PickStripModel
    let open: (SheetPlayer) -> Void
    var live = true

    var body: some View {
        let theme = Theme(colorScheme)
        Panel {
            HStack(alignment: .top, spacing: Tokens.Space.s3) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(strip.lead)
                        .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    ForEach(strip.lines, id: \.self) { line in
                        Text(line)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                            .foregroundStyle(theme.color(Tokens.Color.ink3))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(width: 92, alignment: .leading)
                if live {
                    ScrollView(.horizontal, showsIndicators: false) { faces(theme) }
                } else {
                    faces(theme).frame(minWidth: 0, maxWidth: .infinity, alignment: .leading).clipped()
                }
            }
        }
    }

    private func faces(_ theme: Theme) -> some View {
        HStack(alignment: .top, spacing: Tokens.Space.s2) {
            ForEach(strip.picks) { pick in
                VStack(spacing: 2) {
                    PlayerFace(player: pick.player, side: 36)
                        .overlay(Circle().strokeBorder(theme.color(Tokens.Color.ink), lineWidth: pick.newest ? 2 : 0))
                    Text(pick.name)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                        .lineLimit(1)
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    ForEach(Array(pick.lines.enumerated()), id: \.offset) { index, line in
                        Text(line)
                            .font(Faces.font(
                                .ui,
                                size: Tokens.TypeScale.xs,
                                weight: index > 0 && pick.strong ? .semibold : .regular
                            ))
                            .lineLimit(1)
                            .foregroundStyle(theme
                                .color(index > 0 && pick.strong ? Tokens.Color.ink : Tokens.Color.ink3))
                    }
                }
                .frame(width: 64)
                .contentShape(Rectangle())
                .onTapGesture { open(pick.player.sheetPlayer) }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)
            }
        }
        .fixedSize()
    }
}

/// A chance as the room's cell prints it (StillThereCell.svelte): the figure, its meter, what it is
/// of; or the words for none.
struct ChanceCell: View {
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
        .frame(width: CompanionColumn.chance, alignment: .trailing)
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

/// Over repl. on its round's tint (Row.svelte .heat-1 to .heat-4, .heat-neg), the Board's tile.
struct ValueCell: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String
    let heat: Heat?

    var body: some View {
        let theme = Theme(colorScheme)
        let muted = heat == nil
        Text(text)
            .font(Faces.font(
                muted ? .ui : .num,
                size: muted ? Tokens.TypeScale.xs : Tokens.TypeScale.lg,
                weight: .semibold
            ))
            .monospacedDigit()
            .lineLimit(2)
            .minimumScaleFactor(0.7)
            .multilineTextAlignment(.trailing)
            .foregroundStyle(theme.color(muted ? Tokens.Color.ink3 : Tokens.Color.ink2))
            .frame(width: CompanionColumn.value, alignment: .trailing)
            .background(alignment: .trailing) {
                if let heat, let tint = BoardRowView.tint(heat) {
                    RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                        .fill(theme.color(tint))
                        .frame(height: 26)
                        .padding(.leading, -6)
                }
            }
    }
}
