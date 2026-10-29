import CommishCore
import CommishDesign
import SwiftUI

/// Our ideas (TradeBuilder's .ideas at 390, Lanes 260, 268, 290, B271): the head over a row of cards that
/// scrolls sideways from its first, the first three, and "N more" at the head's end; once every idea
/// shows they stack in place. The host's newest offer heads the row, then Best. A card loads its trade
/// into the ticks, pressed while the ticks hold it; an offer the builder cannot hold and a team the finder
/// lists no trade with keep their place, dashed, nothing to press.
struct TradeIdeasView: View {
    @Environment(\.colorScheme) private var colorScheme
    let builder: TradeBuilderModel
    let actions: TradeActions
    /// Drawn still, for a snapshot, which draws no scroll view: the row from its Best card, cut at the
    /// edge as a phone first shows it.
    var still = false

    /// The web's card width on a phone, min(22rem, 86vw), at the phone's own width.
    static let cardWidth: Double = 300

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .center) {
                Text(builder.ideasHead)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(Tokens.TypeScale.xs * 0.06)
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: Tokens.Space.s2)
                // The rest of the ideas a tap away, on the head's line so a phone always shows it.
                if let more = builder.more {
                    MoreButton(words: more, action: actions.more)
                }
            }
            if builder.more == nil {
                VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                    places
                }
            } else if still {
                // An overlay sizes nothing, so the row runs past the edge without widening the screen; the
                // first card, hidden, gives the row its height.
                first
                    .hidden()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .topLeading) {
                        HStack(alignment: .top, spacing: Tokens.Space.s2) {
                            places
                        }
                        .fixedSize()
                    }
                    .clipped()
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: Tokens.Space.s2) {
                        places
                    }
                    .padding(2)
                }
                .padding(-2)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(builder.ideasHead)
    }

    /// The Best card alone, which sizes the still row.
    @ViewBuilder
    private var first: some View {
        if let place = builder.ideas.first {
            card(place)
        }
    }

    private var places: some View {
        ForEach(builder.ideas) { place in
            card(place)
        }
    }

    @ViewBuilder
    private func card(_ place: IdeaPlace) -> some View {
        switch place {
        case let .offer(offer):
            OfferCard(offer: offer, pressed: builder.pressed == offer.id, wide: builder.more == nil) {
                actions.idea(offer.id)
            }
        case let .idea(preset):
            IdeaCard(preset: preset, pressed: builder.pressed == preset.id, wide: builder.more == nil) {
                actions.idea(preset.id)
            }
        case let .none(line):
            NoIdeaCard(line: line, wide: builder.more == nil)
        }
    }
}

/// One idea's card: "Best" and both gains on its first line, "With Max_Jensen10" whole on its own line
/// (a long team name wraps, never cut), the deal under it with what it fills at its end (Lane 290).
struct IdeaCard: View {
    @Environment(\.colorScheme) private var colorScheme
    let preset: TradePreset
    let pressed: Bool
    /// Every idea shows: the card takes the row's width.
    let wide: Bool
    let load: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Button(action: load) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if let mark = preset.mark {
                        Text(mark)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                            .textCase(.uppercase)
                            .foregroundStyle(theme.color(Tokens.Color.accentText))
                    }
                    Spacer(minLength: Tokens.Space.s1)
                    Text(preset.gains)
                        .monospacedDigit()
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                }
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                Text(preset.with)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .fixedSize(horizontal: false, vertical: true)
                DealLine(deal: preset.deal, fact: preset.fills, factInk: Tokens.Color.accentText)
            }
            .frame(width: wide ? nil : TradeIdeasView.cardWidth, alignment: .leading)
            .frame(maxWidth: wide ? .infinity : nil, minHeight: 38, alignment: .leading)
            .padding(.horizontal, Tokens.Space.s3)
            .padding(.vertical, 3)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface)))
            .overlay(
                RoundedRectangle(cornerRadius: Tokens.Radius.md)
                    .strokeBorder(
                        theme.color(pressed ? Tokens.Color.accent : Tokens.Color.line),
                        lineWidth: pressed ? 2 : 1
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        }
        .buttonStyle(.plain)
        .accessibilityLabel([preset.mark, preset.with, preset.deal, preset.fills, preset.gains].compactMap(\.self)
            .joined(separator: ", "))
        .accessibilityAddTraits(pressed ? [.isButton, .isSelected] : .isButton)
    }
}

/// The deal and its fact at the line's end (what it fills, when an offer lapses, or where to answer it),
/// the fact wrapping under the deal where the two do not fit.
struct DealLine: View {
    @Environment(\.colorScheme) private var colorScheme
    let deal: String
    let fact: String?
    var factInk = Tokens.Color.ink2

    var body: some View {
        let theme = Theme(colorScheme)
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                dealText(theme)
                Spacer(minLength: Tokens.Space.s1)
                factText(theme)
            }
            VStack(alignment: .leading, spacing: 0) {
                dealText(theme).fixedSize(horizontal: false, vertical: true)
                factText(theme)
            }
        }
    }

    private func dealText(_ theme: Theme) -> some View {
        Text(deal)
            .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
            .foregroundStyle(theme.color(Tokens.Color.ink))
    }

    @ViewBuilder
    private func factText(_ theme: Theme) -> some View {
        if let fact {
            Text(fact)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                .foregroundStyle(theme.color(factInk))
        }
    }
}

/// A trade offered to the member on the host (Lane 290): "Offered to you" marked, "With Muttdogs", then
/// give for get with its expiry at the line's end. One the builder can hold loads its ticks like an idea;
/// one it cannot is dashed, nothing to press, and says where to answer it. Nothing is sent to the host.
struct OfferCard: View {
    @Environment(\.colorScheme) private var colorScheme
    let offer: OfferPreset
    let pressed: Bool
    let wide: Bool
    let load: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        let shape = RoundedRectangle(cornerRadius: Tokens.Radius.md)
        let label = [offer.label, offer.with, offer.deal, offer.fact].compactMap(\.self).joined(separator: ", ")
        if offer.picks == nil {
            face(theme)
                .overlay(shape.strokeBorder(
                    theme.color(Tokens.Color.line), style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                ))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(label)
        } else {
            Button(action: load) {
                face(theme)
                    .background(shape.fill(theme.color(Tokens.Color.surface)))
                    .overlay(shape.strokeBorder(
                        theme.color(pressed ? Tokens.Color.accent : Tokens.Color.line), lineWidth: pressed ? 2 : 1
                    ))
                    .contentShape(shape)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            .accessibilityAddTraits(pressed ? [.isButton, .isSelected] : .isButton)
        }
    }

    private func face(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(offer.label)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.accentText))
            Text(offer.with)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .fixedSize(horizontal: false, vertical: true)
            DealLine(deal: offer.deal, fact: offer.fact)
        }
        .frame(width: wide ? nil : TradeIdeasView.cardWidth, alignment: .leading)
        .frame(maxWidth: wide ? .infinity : nil, minHeight: 38, alignment: .leading)
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, 3)
    }
}

/// A team with no idea (B271): its card's two lines, quiet and dashed, nothing to press.
struct NoIdeaCard: View {
    @Environment(\.colorScheme) private var colorScheme
    let line: NoIdeaLine
    let wide: Bool

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 0) {
            Text(line.with)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                .fixedSize(horizontal: false, vertical: true)
            Text(line.note)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
        }
        .foregroundStyle(theme.color(Tokens.Color.ink2))
        .frame(width: wide ? nil : TradeIdeasView.cardWidth, alignment: .leading)
        .frame(maxWidth: wide ? .infinity : nil, minHeight: 38, alignment: .leading)
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, 3)
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .strokeBorder(theme.color(Tokens.Color.line), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        )
        .accessibilityElement(children: .combine)
    }
}

/// "8 more": every idea in place.
struct MoreButton: View {
    @Environment(\.colorScheme) private var colorScheme
    let words: String
    let action: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Button(action: action) {
            Text(words)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                .foregroundStyle(theme.color(Tokens.Color.accentText))
                .padding(.horizontal, Tokens.Space.s2)
                .frame(minHeight: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
