import CommishCore
import CommishDesign
import SwiftUI

/// One roster row of the trade builder (web BoxLine with its pick, the tight row at 390, the Lineup's
/// height and type): the tick that picks him for the trade, his face and name with his club and his game
/// under it (Avg and Last stay at a desk, Lane 268), Proj and his rest-of-season points a game. A picked
/// row is lit in the accent, the member's drop in the loss's ink; a player no trade takes has an empty
/// tick.
public struct PickRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    private let cells: RowCells
    private let tick: PickTick
    private let actions: RowActions
    private let toggle: () -> Void

    public init(cells: RowCells, tick: PickTick, actions: RowActions, toggle: @escaping () -> Void) {
        self.cells = cells
        self.tick = tick
        self.actions = actions
        self.toggle = toggle
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .center, spacing: 0) {
            tickCell(theme)
                .frame(width: Column.slot, alignment: .leading)
            PlayerCell(
                cells: cells, sheetPlayer: cells.sheetPlayer, evidence: nil, facts: false, open: actions.open
            )
            .frame(maxWidth: .infinity, alignment: .leading)
            Figure(text: cells.proj, width: Column.proj, muted: cells.proj == Words.Box.none)
            Figure(text: cells.season, width: Column.season, muted: cells.season == Words.Box.none)
        }
        .padding(.horizontal, Tokens.Space.s2)
        .padding(.vertical, 6)
        .background(background(theme))
        .overlay(alignment: .leading) { edge(theme) }
        .overlay(alignment: .bottom) { Hairline() }
    }

    @ViewBuilder
    private func tickCell(_ theme: Theme) -> some View {
        switch tick {
        case .drop:
            Text(Words.Box.drop)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.lossInk))
        case .none:
            RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                .strokeBorder(theme.color(Tokens.Color.line), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                .frame(width: 24, height: 24)
                .accessibilityHidden(true)
        case .picked, .open:
            Button(action: toggle) {
                ZStack {
                    RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                        .fill(theme.color(picked ? Tokens.Color.accent : Tokens.Color.surface))
                    RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                        .strokeBorder(theme.color(picked ? Tokens.Color.accent : Tokens.Color.lineStrong))
                    if picked {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(theme.color(Tokens.Color.accentInk))
                    }
                }
                .frame(width: 24, height: 24)
                .frame(width: 44, height: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(tick == .open(disabled: true))
            .opacity(tick == .open(disabled: true) ? 0.4 : 1)
            .accessibilityLabel([Words.Box.pick, cells.row.name].joined(separator: " "))
            .accessibilityAddTraits(picked ? .isSelected : [])
        }
    }

    private var picked: Bool {
        tick == .picked
    }

    private func background(_ theme: Theme) -> Color {
        switch tick {
        case .picked: theme.mix(Tokens.Color.accent, 8, into: Tokens.Color.surface)
        case .drop: theme.mix(Tokens.Color.lossInk, 7, into: Tokens.Color.surface)
        case .open, .none: theme.color(Tokens.Color.surface)
        }
    }

    @ViewBuilder
    private func edge(_ theme: Theme) -> some View {
        switch tick {
        case .picked: Rectangle().fill(theme.color(Tokens.Color.accent)).frame(width: 3)
        case .drop: Rectangle().fill(theme.color(Tokens.Color.lossInk)).frame(width: 3)
        case .open, .none: EmptyView()
        }
    }
}
