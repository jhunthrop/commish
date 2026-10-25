import CommishCore
import CommishDesign
import SwiftUI

/// The phone's column widths (board-columns.ts, the phone band): his face, the player taking the rest,
/// then the view's figures.
enum BoardColumn {
    static let face: Double = 32
    static let projected: Double = 62
    static let overReplacement: Double = 58
    static let gap: Double = 44
    static let draftOrder: Double = 64
    static let adp: Double = 56

    /// Each figure column's width, in the order the view's heads name them.
    static func widths(_ columns: BoardColumns) -> [Double] {
        switch columns {
        case let .ranked(gap): [projected, overReplacement] + (gap ? [Self.gap] : [])
        case .draftOrder: [draftOrder, adp]
        }
    }
}

/// The column heads, said once over the rows: Player, then the view's figures.
struct BoardHeadRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let columns: BoardColumns

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 6) {
            head(Words.Box.player).frame(maxWidth: .infinity, alignment: .leading)
            ForEach(Array(zip(columns.heads, BoardColumn.widths(columns))), id: \.0) { words, width in
                head(words).frame(width: width, alignment: .trailing)
            }
        }
        .padding(.horizontal, Tokens.Space.s2)
        .frame(minHeight: 34)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .bottom) { Hairline() }
        .accessibilityHidden(true)
    }

    private func head(_ words: String) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .lineLimit(2)
            .minimumScaleFactor(0.75)
            .allowsTightening(true)
            .multilineTextAlignment(.trailing)
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink3))
    }
}

/// A head inside the table over a run of rows: a position's players on a season-long list.
struct BoardSectionHead: View {
    @Environment(\.colorScheme) private var colorScheme
    let title: String

    var body: some View {
        let theme = Theme(colorScheme)
        Text(title)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .fixedSize(horizontal: false, vertical: true)
            .foregroundStyle(theme.color(Tokens.Color.ink3))
            .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
            .padding(.horizontal, Tokens.Space.s3)
            .padding(.vertical, Tokens.Space.s2)
            .background(theme.color(Tokens.Color.bg))
            .overlay(alignment: .bottom) { Hairline() }
            .accessibilityAddTraits(.isHeader)
    }
}

/// One player's row (web Row.svelte at 390): his face, his name the biggest thing, his position pill
/// with his number there, his club and bye, his status chip; then Projected, the row's one big figure,
/// Over repl. and the Gap in its tone, or a kicker's or a defense's draft order and ADP. The whole row
/// opens the player sheet where the site has a page for him.
struct BoardRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let row: BoardRow
    let columns: BoardColumns
    let open: (SheetPlayer) -> Void

    var body: some View {
        if let player = row.sheetPlayer {
            Button { open(player) } label: { line }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityHint(Words.Shelf.fullPage)
        } else {
            line.accessibilityElement(children: .combine)
        }
    }

    private var line: some View {
        let theme = Theme(colorScheme)
        return HStack(alignment: .center, spacing: 6) {
            Headshot(row.headshot, initials: row.initials, side: BoardColumn.face)
            who(theme).frame(maxWidth: .infinity, alignment: .leading)
            figures(theme)
        }
        .padding(.horizontal, Tokens.Space.s2)
        .padding(.vertical, 6)
        .frame(minHeight: 52)
        .background(theme.color(Tokens.Color.surface))
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) { Hairline() }
    }

    private func who(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(row.name)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink))
            HStack(spacing: 6) {
                PositionPill(row.pill)
                Text(row.club).modifier(Small(theme: theme))
                if let bye = row.bye {
                    Text(bye).modifier(Small(theme: theme))
                }
            }
            if let status = row.status {
                Pill(status.mark, tone: status.sits ? .loss : .quiet)
            }
        }
    }

    @ViewBuilder
    private func figures(_ theme: Theme) -> some View {
        switch columns {
        case let .ranked(gap):
            Text(row.projected)
                .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .foregroundStyle(theme.color(row.projected == Words.Box.none ? Tokens.Color.ink3 : Tokens.Color.ink))
                .frame(width: BoardColumn.projected, alignment: .trailing)
            figure(row.overReplacement, width: BoardColumn.overReplacement, ink: Tokens.Color.ink2, theme: theme)
                .background(alignment: .trailing) {
                    // Below replacement, the rose tile (ui/heat.ts heat-neg).
                    if row.belowReplacement {
                        RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                            .fill(theme.color(Tokens.Color.heatNeg))
                            .frame(height: 26)
                            .padding(.leading, -6)
                    }
                }
            if gap {
                figure(row.gap, width: BoardColumn.gap, ink: gapInk, theme: theme)
            }
        case .draftOrder:
            figure(row.draftOrder, width: BoardColumn.draftOrder, ink: Tokens.Color.ink, theme: theme)
            figure(row.adp, width: BoardColumn.adp, ink: Tokens.Color.ink2, theme: theme)
        }
    }

    private func figure(_ text: String, width: Double, ink: ThemedColor, theme: Theme) -> some View {
        Text(text)
            .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .semibold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .foregroundStyle(theme.color(text == Words.Box.none ? Tokens.Color.ink3 : ink))
            .frame(width: width, alignment: .trailing)
    }

    /// The Gap's tone (gap-picks.ts): plus green, minus rose, zero neither.
    private var gapInk: ThemedColor {
        switch row.gapTone {
        case .gain?: Tokens.Color.gainInk
        case .loss?: Tokens.Color.lossInk
        case .even?, nil: Tokens.Color.ink2
        }
    }
}

/// His club and bye in the row's small caps (Row.svelte .club and .phone-bye).
private struct Small: ViewModifier {
    let theme: Theme

    func body(content: Content) -> some View {
        content
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .tracking(Tokens.TypeScale.xs * 0.06)
            .textCase(.uppercase)
            .foregroundStyle(theme.color(Tokens.Color.ink3))
    }
}
