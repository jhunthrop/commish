import CommishCore
import CommishDesign
import SwiftUI

/// Our ideas (TradeBuilder's .ideas at 390, Lanes 260, 268, B271): the head over a row of two-line cards
/// that scrolls sideways from the Best card, the best three, and "N more" at the head's end; once every idea shows they
/// stack in place, the Best card first. A card loads its trade into the ticks, pressed while the ticks
/// hold it; a team the finder lists no trade with keeps its place, dashed, nothing to press.
struct TradeIdeasView: View {
    @Environment(\.colorScheme) private var colorScheme
    let builder: TradeBuilderModel
    let actions: TradeActions
    /// Drawn still, for a snapshot, which draws no scroll view: the row from its Best card, cut at the
    /// edge as a phone first shows it.
    var still = false

    /// The web's card width on a phone, min(22rem, 86vw), at the phone's own width.
    static let cardWidth: Double = 300
    /// A card's two lines with their padding, the still row's height.
    static let stillHeight: Double = 44

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
                // An overlay sizes nothing, so the row runs past the edge without widening the screen.
                Color.clear
                    .frame(maxWidth: .infinity, minHeight: Self.stillHeight, maxHeight: Self.stillHeight)
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

    private var places: some View {
        ForEach(builder.ideas) { place in
            switch place {
            case let .idea(preset):
                IdeaCard(preset: preset, pressed: builder.pressed == preset.id, wide: builder.more == nil) {
                    actions.idea(preset.id)
                }
            case let .none(line):
                NoIdeaCard(line: line, wide: builder.more == nil)
            }
        }
    }
}

/// One idea's card: "Best", "With Max_Jensen10" and both gains on its first line, the deal on its second.
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
                    Text(preset.with)
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                        .lineLimit(1)
                    Spacer(minLength: Tokens.Space.s1)
                    Text(preset.gains)
                        .monospacedDigit()
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                        .lineLimit(1)
                        .layoutPriority(1)
                }
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                Text(preset.deal)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .fixedSize(horizontal: false, vertical: true)
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
        .accessibilityLabel([preset.mark, preset.with, preset.deal, preset.gains].compactMap(\.self)
            .joined(separator: ", "))
        .accessibilityAddTraits(pressed ? [.isButton, .isSelected] : .isButton)
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
                .lineLimit(1)
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
