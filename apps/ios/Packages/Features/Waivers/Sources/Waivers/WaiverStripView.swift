import CommishCore
import CommishDesign
import SwiftUI

/// The Waivers decision as a strip (web PickupStrip.svelte at 390): the week and the count of pickups
/// worth making, what they add to the lineup, then a card for each (his slot, Best over the first of
/// more than one, the move, why its drop is the one named, this week's Proj gain and the season's). A
/// card tapped is the one the pinned verb acts on. The stamp of a saved read under the title.
struct WaiverStripView: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: WaiverModel
    let stamp: String?
    let chosen: String?
    let choose: (String) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            HStack(alignment: .top, spacing: Tokens.Space.s3) {
                head(theme)
                Spacer(minLength: 0)
                sum(theme)
            }
            ForEach(model.cards) { card in
                CardView(card: card, chosen: card.key == chosen) { choose(card.key) }
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
                .font(Faces.font(
                    .num,
                    size: model.cards.isEmpty ? Tokens.TypeScale.lg : Tokens.TypeScale.xl,
                    weight: .bold
                ))
                .textCase(.uppercase)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(model.cards.isEmpty ? Tokens.Color.ink2 : Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            if let stamp {
                Text(stamp)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
            }
        }
    }

    @ViewBuilder
    private func sum(_ theme: Theme) -> some View {
        if let sum = model.sum {
            VStack(alignment: .trailing, spacing: 2) {
                Text(sum.figure)
                    .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
                (Text(verbatim: "\(sum.words), ").foregroundStyle(theme.color(Tokens.Color.ink3))
                    + Text(sum.gain).bold().foregroundStyle(theme.color(Tokens.Color.gainInk)))
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// One card: his slot, the move with Best over the first, why its drop is named, the gains. The chosen
/// card is outlined in the accent.
private struct CardView: View {
    @Environment(\.colorScheme) private var colorScheme
    let card: PickupCard
    let chosen: Bool
    let choose: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Button(action: choose) {
            HStack(alignment: .center, spacing: Tokens.Space.s3) {
                Text(card.slot)
                    .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(theme.color(Tokens.Color.surface2)))
                VStack(alignment: .leading, spacing: 2) {
                    if let mark = card.mark {
                        Text(mark)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                            .textCase(.uppercase)
                            .tracking(Tokens.TypeScale.xs * 0.08)
                            .foregroundStyle(theme.color(Tokens.Color.accentText))
                    }
                    (Text(card.move).bold().foregroundStyle(theme.color(Tokens.Color.ink))
                        + Text(verbatim: card.why.map { " \($0)" } ?? "")
                        .foregroundStyle(theme.color(Tokens.Color.ink2)))
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(card.gains)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                        .monospacedDigit()
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(Tokens.Space.s3)
            .background(theme.color(chosen ? Tokens.Color.accentWash : Tokens.Color.surface))
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .strokeBorder(theme.color(chosen ? Tokens.Color.accent : Tokens.Color.line)))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}
