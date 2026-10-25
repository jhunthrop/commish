import CommishCore
import CommishDesign
import SwiftUI

/// The check's scoreboard on the lit board (TradeBug.svelte as a phone stacks it): the two sides side
/// by side, each with You or With and the team, this week's Proj and the rest-of-season Gain each
/// before, after and its change, and its room; the answer's sentence and the API's line under the
/// board.
struct TradeBugView: View {
    @Environment(\.colorScheme) private var colorScheme
    let bug: TradeCheckBug

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            HStack(alignment: .top, spacing: 0) {
                half(bug.yours, theme: theme)
                Rectangle().fill(theme.color(Tokens.Color.scoreboardLine)).frame(width: 1)
                half(bug.theirs, theme: theme)
            }
            .fixedSize(horizontal: false, vertical: true)
            .foregroundStyle(theme.color(Tokens.Color.scoreboardInk))
            .background(theme.color(Tokens.Color.scoreboard))
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            .accessibilityElement(children: .combine)
            Text(bug.sentence)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .fixedSize(horizontal: false, vertical: true)
            BasisText(bug.basis)
        }
    }

    private func half(_ side: TradeBugSide, theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            HStack(spacing: Tokens.Space.s2) {
                Avatar(side.initials, side: 26, mine: side.mine, board: true)
                VStack(alignment: .leading, spacing: 0) {
                    label(side.label, theme: theme)
                    Text(side.name)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .bold))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            figure(Words.Trades.weekHead, Swing.week(side.figures), theme: theme)
            figure(Words.Trades.gainHead, Swing.season(side.figures), theme: theme)
            VStack(alignment: .leading, spacing: 0) {
                label(Words.Trades.room, theme: theme)
                Text(side.room)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Tokens.Space.s3)
    }

    /// "THIS WEEK, PROJ" over "98.9 to 109.0 +10.1": before quiet, after strong, the change in its ink.
    private func figure(_ head: String, _ swing: Swing, theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            label(head, theme: theme)
            (Text(swing.before).foregroundStyle(theme.color(Tokens.Color.scoreboardInk2))
                + Text(verbatim: " \(Words.Trades.to) ").font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                .foregroundStyle(theme.color(Tokens.Color.scoreboardInk2))
                + Text(swing.after).bold()
                + Text(verbatim: " \(swing.change)").bold().foregroundStyle(ink(swing.tone, theme: theme)))
                .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .medium))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private func ink(_ tone: Tone, theme: Theme) -> Color {
        switch tone {
        case .gain: theme.color(Tokens.Color.scoreboardNum)
        case .loss: theme.color(Tokens.Color.lossInk)
        case .even: theme.color(Tokens.Color.scoreboardInk)
        }
    }

    private func label(_ words: String, theme: Theme) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .lineLimit(1)
            .foregroundStyle(theme.color(Tokens.Color.scoreboardInk2))
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
