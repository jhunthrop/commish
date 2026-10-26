import CommishCore
import CommishDesign
import SwiftUI

/// The wall (Wall.svelte at 390): its title and how many rounds it shows, then a grid that scrolls
/// sideways, each seat's name across the top (the drafter's in the accent) and each round's picks seat
/// by seat: his face, position and club, his last name; the drafter's own on the accent's wash with its
/// edge; the pick on the clock dashed in the accent with whose it is.
public struct WallView: View {
    @Environment(\.colorScheme) private var colorScheme
    let wall: RoomWall
    let open: (SheetPlayer) -> Void
    var live = true

    public init(wall: RoomWall, open: @escaping (SheetPlayer) -> Void, live: Bool = true) {
        self.wall = wall
        self.open = open
        self.live = live
    }

    /// Wall.svelte's widths: the round's column, a team's (a cell's min-width), a cell's least height,
    /// the face, the drafter's edge.
    enum Size {
        static let round: Double = 24
        static let team: Double = 96
        static let cell: Double = 54
        static let face: Double = 22
        static let edge: Double = 3
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s3) {
                SectionHead(wall.title)
                HeadText(text: wall.label, alignment: .leading, lines: 1)
            }
            .padding(.horizontal, Tokens.Space.s3)
            Group {
                if live {
                    ScrollView(.horizontal, showsIndicators: false) { grid(theme) }
                } else {
                    grid(theme).frame(minWidth: 0, maxWidth: .infinity, alignment: .leading).clipped()
                }
            }
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface)))
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.line)))
            .padding(.horizontal, Tokens.Space.s3)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(wall.title))
    }

    private func grid(_ theme: Theme) -> some View {
        Grid(horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow(alignment: .bottom) {
                Color.clear.frame(width: Size.round, height: 1)
                ForEach(Array(wall.names.enumerated()), id: \.offset) { index, name in
                    Text(name)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                        .textCase(.uppercase)
                        .foregroundStyle(theme
                            .color(index + 1 == wall.you ? Tokens.Color.accentText : Tokens.Color.ink3))
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, 8)
                        .padding(.horizontal, 6)
                        .frame(width: Size.team, alignment: .leading)
                }
            }
            .overlay(alignment: .bottom) { Hairline() }
            ForEach(Array(wall.rows.enumerated()), id: \.offset) { index, row in
                GridRow {
                    Text(String(index + 1))
                        .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                        .foregroundStyle(theme.color(Tokens.Color.ink3))
                        .frame(width: Size.round)
                        .frame(maxHeight: .infinity)
                    ForEach(row) { cell in
                        cellView(cell, theme: theme)
                    }
                }
                .overlay(alignment: .bottom) { Hairline() }
            }
        }
        .fixedSize()
    }

    @ViewBuilder
    private func cellView(_ cell: WallCell, theme: Theme) -> some View {
        if let player = cell.player {
            WallBox(fill: cell.mine ? Tokens.Color.accentWash : nil) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 5) {
                        PlayerFace(player: player, side: Size.face)
                        Text(cell.line ?? "")
                            .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                            .lineLimit(1)
                            .foregroundStyle(theme.color(Tokens.Color.ink3))
                    }
                    Text(cell.name ?? "")
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .overlay(alignment: .leading) {
                if cell.mine {
                    Rectangle().fill(theme.color(Tokens.Color.accent)).frame(width: Size.edge)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { open(player.sheetPlayer) }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
        } else if let now = cell.now {
            WallBox(fill: Tokens.Color.accentWash) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(now.words)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .bold))
                    Text(now.pick)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .medium))
                }
                .foregroundStyle(theme.color(Tokens.Color.accentText))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 2)
                    .strokeBorder(theme.color(Tokens.Color.accent), style: StrokeStyle(lineWidth: 2, dash: [5, 3]))
                    .padding(4)
            }
        } else {
            WallBox(fill: nil) { Color.clear }
        }
    }
}

/// One cell's box on the wall: a team's width, at least a cell's height, its fill, the line on its left.
private struct WallBox<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    let fill: ThemedColor?
    @ViewBuilder let content: Content

    var body: some View {
        let theme = Theme(colorScheme)
        content
            .padding(6)
            .frame(width: WallView.Size.team, alignment: .leading)
            .frame(minHeight: WallView.Size.cell, maxHeight: .infinity)
            .background(fill.map { theme.color($0) } ?? Color.clear)
            .overlay(alignment: .leading) { Rectangle().fill(theme.color(Tokens.Color.line)).frame(width: 1) }
    }
}
