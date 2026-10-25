import CommishCore
import CommishDesign
import SwiftUI

/// The Trades' decision as a strip (TradeStrip.svelte at 390): the week, how many trades are worth
/// proposing and the platform's reason, then each card with the other team, both sides, both gains, the
/// need it fills, its week, the drop, and its verb: the first card's solid and marked Best, every other
/// card's the same words quiet. The stamp of a saved read under the title.
struct TradeStripView: View {
    @Environment(\.colorScheme) private var colorScheme
    let strip: TradesStrip
    let verb: String
    let page: URL?
    let stamp: String?
    let copied: [String: CopiedLine]
    let press: (String) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            head(theme)
            ForEach(strip.cards) { card in
                TradeCardView(card: card, verb: verb, page: page, copied: copied[card.id]) { press(card.id) }
            }
        }
        .padding(Tokens.Space.s4)
        .background(theme.color(Tokens.Color.surface))
        .overlay(alignment: .leading) {
            Rectangle().fill(theme.color(Tokens.Color.accent)).frame(width: 4)
        }
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.line)))
        .accessibilityElement(children: .contain)
    }

    private func head(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(strip.week)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                .textCase(.uppercase)
                .tracking(Tokens.TypeScale.xs * 0.08)
                .foregroundStyle(theme.color(Tokens.Color.accentText))
            Text(strip.title)
                .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                .textCase(.uppercase)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            if let stamp {
                StampText(stamp)
            }
            if let reason = strip.reason {
                Text(reason)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// One card: "Best", the team's face and "with Max_Jensen10", "Rodgers for Skattebo and Strong", "+5.7 a
/// week for your lineup, +0.7 for theirs", the need, the week, the drop, the verb and its line.
struct TradeCardView: View {
    @Environment(\.colorScheme) private var colorScheme
    let card: StripCard
    let verb: String
    let page: URL?
    let copied: CopiedLine?
    let press: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            HStack(spacing: Tokens.Space.s2) {
                if let mark = card.mark {
                    Text(mark)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                        .textCase(.uppercase)
                        .tracking(Tokens.TypeScale.xs * 0.08)
                        .foregroundStyle(theme.color(Tokens.Color.accentText))
                }
                Avatar(card.initials, side: 24)
                (Text(verbatim: "\(TradesWords.with) ").foregroundStyle(theme.color(Tokens.Color.ink2))
                    + Text(card.team).bold())
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .lineLimit(1)
            }
            (Text(card.give).bold() + Text(verbatim: " \(TradesWords.forWord) ") + Text(card.get).bold())
                .font(Faces.font(.ui, size: Tokens.TypeScale.md))
                .fixedSize(horizontal: false, vertical: true)
            gains(theme)
            ForEach(lines, id: \.self) { line in
                Text(line)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .fixedSize(horizontal: false, vertical: true)
            }
            action
                .padding(.top, Tokens.Space.s1)
            if let copied {
                CopiedText(line: copied, page: page)
            }
        }
        .foregroundStyle(theme.color(Tokens.Color.ink))
        .padding(Tokens.Space.s3)
        .background(theme.color(Tokens.Color.bg))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.line)))
    }

    /// The need, the week and the drop with its sentence, each a line where the card has it.
    private var lines: [String] {
        [card.need, card.week, card.drop, card.dropReason].compactMap(\.self)
    }

    /// "+5.7 a week for your lineup, +0.7 for theirs": the member's gain in the accent's ink.
    private func gains(_ theme: Theme) -> some View {
        let figure = { (words: String, mine: Bool) in
            Text(words)
                .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                .foregroundStyle(theme.color(mine ? Tokens.Color.gainInk : Tokens.Color.ink))
        }
        let words = { (said: String) in
            Text(verbatim: " \(said)").font(Faces.font(.ui, size: Tokens.TypeScale.xs))
        }
        return (figure(card.mine, true) + words("\(Words.Trades.aWeekForYou), ")
            + figure(card.theirs, false) + words(Words.Trades.forTheirs))
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var action: some View {
        if card.lead {
            Verb(verb, enabled: page != nil, action: press)
        } else {
            QuietButton(verb, action: press)
                .frame(maxWidth: .infinity)
                .overlay(
                    RoundedRectangle(cornerRadius: Tokens.Radius.md)
                        .strokeBorder(Theme(colorScheme).color(Tokens.Color.lineStrong))
                )
                .disabled(page == nil)
        }
    }
}
