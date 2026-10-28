import CommishCore
import CommishDesign
import SwiftUI

/// The builder's scoreboard on the lit board as a phone stacks it (TradeBug.svelte under 760 px): the
/// member's half over theirs, each with You or With and the team, this week's Proj and the
/// rest-of-season Gain each before, after and its change; the room and the verb left to the builder's
/// line and its pin, as the web's phone leaves them.
struct TradeBugView: View {
    @Environment(\.colorScheme) private var colorScheme
    let bug: TradeBug

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: 0) {
            half(bug.yours, theme: theme)
            Rectangle().fill(theme.color(Tokens.Color.scoreboardLine)).frame(height: 1)
            half(bug.theirs, theme: theme)
        }
        .foregroundStyle(theme.color(Tokens.Color.scoreboardInk))
        .background(theme.color(Tokens.Color.scoreboard))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .accessibilityElement(children: .combine)
    }

    private func half(_ side: TradeBugSide, theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            HStack(spacing: Tokens.Space.s2) {
                Avatar(side.initials, side: 26, mine: side.mine, board: true)
                VStack(alignment: .leading, spacing: 0) {
                    label(side.label, theme: theme)
                    Text(side.name)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .bold))
                        .lineLimit(1)
                }
            }
            HStack(alignment: .top, spacing: Tokens.Space.s4) {
                figure(Words.Trades.weekHead, Swing.week(side.figures), theme: theme)
                figure(Words.Trades.gainHead, Swing.season(side.figures), theme: theme)
                if !side.rest.text.isEmpty {
                    rest(side.rest, theme: theme)
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s2)
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

    /// "REST OF SEASON" over "−14.4" in its ink (TradeBug.svelte's phone cell, Lane 277); who would not
    /// take it is the builder's line and its pin, as the web's phone says it.
    private func rest(_ rest: TradeRest, theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            label(Words.Trades.restHead, theme: theme)
            Text(rest.text)
                .bold()
                .foregroundStyle(ink(rest.tone, theme: theme))
                .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .medium))
                .monospacedDigit()
                .lineLimit(1)
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
