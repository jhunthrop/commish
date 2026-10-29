import CommishCore
import CommishDesign
import SwiftUI

/// The verdict's box score as a phone draws it (TradeBug.svelte under 760 px, Lanes 268 and 277): the
/// heads once, then one row per side: You or With over the team's name whole and its room, this week's
/// Proj before to after with its change, the gain a week before to after with its change and a short bar
/// against the other side's, and the rest-of-season change; who would not take it is the answer line's
/// and the pin's, as the web's phone says it.
struct TradeBugView: View {
    @Environment(\.colorScheme) private var colorScheme
    let bug: TradeBug

    /// The team's column, the web's 7.5rem at a phone's type.
    static let who: Double = 96
    /// The rest-of-season column, its head in two short lines.
    static let rest: Double = 58

    var body: some View {
        let theme = Theme(colorScheme)
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 6, verticalSpacing: 0) {
            GridRow(alignment: .bottom) {
                Color.clear.frame(width: Self.who, height: 1)
                    .accessibilityHidden(true)
                head(Words.Trades.weekHead, theme: theme)
                head(Words.Trades.gainHead, theme: theme)
                head(Words.Trades.restHead, theme: theme)
                    .frame(width: Self.rest, alignment: .leading)
            }
            .padding(.bottom, 2)
            row(bug.yours, theme: theme)
            Rectangle().fill(theme.color(Tokens.Color.line)).frame(height: 1)
                .gridCellUnsizedAxes(.horizontal)
            row(bug.theirs, theme: theme)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Tokens.Space.s2)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface)))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.lineStrong)))
        .accessibilityElement(children: .combine)
    }

    private func row(_ side: TradeBugSide, theme: Theme) -> some View {
        GridRow {
            who(side, theme: theme)
            swing(Swing.week(side.figures), bar: nil, theme: theme)
            swing(Swing.season(side.figures), bar: side.bar, theme: theme)
            if side.rest.text.isEmpty {
                Color.clear.frame(width: 1, height: 1)
            } else {
                chip(side.rest.text, tone: side.rest.tone, theme: theme)
            }
        }
        .padding(.vertical, 4)
    }

    /// "YOU" or "WITH" over the team's name, whole on a second line where it is long, and its room.
    private func who(_ side: TradeBugSide, theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(side.label)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(side.mine ? Tokens.Color.accentText : Tokens.Color.ink3))
            Text(side.name)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .fixedSize(horizontal: false, vertical: true)
            if !side.room.isEmpty {
                Text(side.room)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
        }
        .frame(width: Self.who, alignment: .leading)
    }

    /// "98.9 to 109.0 +10.1": before quiet, after strong, the change in its chip; the gain's bar under.
    private func swing(_ swing: Swing, bar: Double?, theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(swing.before)
                    .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                Text(Words.Trades.to)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                Text(swing.after)
                    .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                chip(swing.change, tone: swing.tone, theme: theme)
            }
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            if let bar {
                GainBar(share: bar, tone: swing.tone)
            }
        }
    }

    /// A change in its tone's chip: "+5.3" on the gain's ground, "−9.6" on the loss's.
    private func chip(_ words: String, tone: Tone, theme: Theme) -> some View {
        Text(words)
            .font(Faces.font(.num, size: Tokens.TypeScale.xs, weight: .bold))
            .monospacedDigit()
            .lineLimit(1)
            .foregroundStyle(theme.color(ink(tone)))
            .padding(.horizontal, 3)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.sm).fill(ground(tone, theme: theme)))
    }

    private func ink(_ tone: Tone) -> ThemedColor {
        switch tone {
        case .gain: Tokens.Color.gainInk
        case .loss: Tokens.Color.lossInk
        case .even: Tokens.Color.ink2
        }
    }

    private func ground(_ tone: Tone, theme: Theme) -> Color {
        switch tone {
        case .gain: theme.color(Tokens.Color.gainBg)
        case .loss: theme.color(Tokens.Color.lossBg)
        case .even: .clear
        }
    }

    private func head(_ words: String, theme: Theme) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .foregroundStyle(theme.color(Tokens.Color.ink3))
            .lineLimit(2)
            .minimumScaleFactor(0.85)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A side's gain a week as a short bar, the longer side full, in the gain's or the loss's ink.
struct GainBar: View {
    @Environment(\.colorScheme) private var colorScheme
    let share: Double
    let tone: Tone

    var body: some View {
        let theme = Theme(colorScheme)
        Capsule()
            .fill(theme.color(Tokens.Color.line))
            .frame(width: 40, height: 4)
            .overlay(alignment: .leading) {
                Capsule()
                    .fill(theme.color(fill))
                    .frame(width: 40 * min(max(share, 0), 1), height: 4)
            }
            .accessibilityHidden(true)
    }

    private var fill: ThemedColor {
        switch tone {
        case .gain: Tokens.Color.gainInk
        case .loss: Tokens.Color.lossInk
        case .even: Tokens.Color.ink3
        }
    }
}

/// One figure of a side before and after the trade, with its change and its ink.
private struct Swing {
    let before: String
    let after: String
    let change: String
    let tone: Tone

    static func week(_ figures: TradeFigures) -> Swing {
        Swing(
            before: figures.projBefore, after: figures.projAfter, change: figures.projChange, tone: figures.projTone
        )
    }

    static func season(_ figures: TradeFigures) -> Swing {
        Swing(
            before: figures.seasonBefore, after: figures.seasonAfter, change: figures.seasonChange,
            tone: figures.seasonTone
        )
    }
}
