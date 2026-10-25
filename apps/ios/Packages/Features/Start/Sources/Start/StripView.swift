import CommishCore
import CommishDesign
import SwiftUI

/// The Lineup's decision as a strip (web LineupStrip.svelte at 390): the week and the count of
/// changes, the figure the swaps add to the lineup as the platform holds it, each spot no one can play
/// and each swap as a chip, and the API's miss line across the foot. The stamp of a saved read under
/// the title.
struct StripView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    let model: StartModel
    let stamp: String?

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            HStack(alignment: .top, spacing: Tokens.Space.s3) {
                head(theme)
                Spacer(minLength: 0)
                sum(theme)
            }
            if !model.chips.isEmpty {
                FlowRow(spacing: 3) {
                    ForEach(model.chips) { chip in
                        ChipView(chip: chip)
                    }
                }
            }
            if let missed = model.missed {
                VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                    Rectangle().fill(theme.color(Tokens.Color.line)).frame(height: 1)
                    Text(missed)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                        .fixedSize(horizontal: false, vertical: true)
                }
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
        .accessibilityLabel(model.decision)
    }

    private func head(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(model.week)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                .textCase(.uppercase)
                .tracking(Tokens.TypeScale.xs * 0.08)
                .foregroundStyle(theme.color(Tokens.Color.accentText))
            Text(model.title)
                .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                .textCase(.uppercase)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            if let stamp {
                Text(stamp)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
            }
        }
    }

    private func sum(_ theme: Theme) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            if let sum = model.sum {
                Text(sum.figure)
                    .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
                Text(sumWords(sum, theme: theme))
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
                if let final = sum.final {
                    Text(final)
                        .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                }
            }
            if let done = model.done {
                Text(done)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                    .multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button { openURL(SiteLinks.record) } label: {
                Text(Words.Lineup.pastWeeks)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .underline()
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                    .multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
        }
        .frame(maxWidth: 180, alignment: .trailing)
    }

    /// "Proj with them, 74.7 as set on FFPC, +24.2": the gain in the gain's ink.
    private func sumWords(_ sum: StripSum, theme: Theme) -> AttributedString {
        var words = AttributedString(sum.words)
        words.foregroundColor = theme.color(Tokens.Color.ink3)
        guard let gain = sum.gain else {
            return words
        }
        var comma = AttributedString(", ")
        comma.foregroundColor = theme.color(Tokens.Color.ink3)
        var figure = AttributedString(gain)
        figure.foregroundColor = theme.color(Tokens.Color.gainInk)
        figure.font = Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold)
        return words + comma + figure
    }
}

/// A chip: a spot no one can play in the loss's ink, or a swap as the phone names it, the slot then
/// who comes in (the bench row's arrow names who goes out).
struct ChipView: View {
    @Environment(\.colorScheme) private var colorScheme
    let chip: StripChip

    var body: some View {
        let theme = Theme(colorScheme)
        switch chip {
        case let .idle(words):
            Text(words)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                .foregroundStyle(theme.color(Tokens.Color.lossInk))
                .padding(.horizontal, Tokens.Space.s2)
                .frame(height: 24)
                .background(Capsule().fill(theme.color(Tokens.Color.bg)))
                .overlay(Capsule().strokeBorder(theme.mix(Tokens.Color.lossInk, 40, into: Tokens.Color.bg)))
        case let .swap(swap):
            HStack(spacing: 6) {
                Text(swap.slot)
                    .font(Faces.font(.num, size: Tokens.TypeScale.xs, weight: .bold))
                    .frame(minWidth: 28, minHeight: 18)
                    .padding(.horizontal, 4)
                    .background(Capsule().fill(theme.color(Tokens.Color.surface2)))
                MoveMark(starts: true, side: 16)
                Text([swap.into, Words.Lineup.swapIn].joined(separator: " "))
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
            }
            .foregroundStyle(theme.color(Tokens.Color.ink))
            .padding(.leading, 3)
            .padding(.trailing, Tokens.Space.s2)
            .frame(height: 24)
            .background(Capsule().fill(theme.color(Tokens.Color.bg)))
            .overlay(Capsule().strokeBorder(theme.color(Tokens.Color.lineStrong)))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(StartWords.swap(swap))
        }
    }
}
