import CommishCore
import CommishDesign
import SwiftUI

/// The facts before the season (Fact.svelte): where drafters take him, his value over a pickup's with
/// its round's tint, and his floor, median and ceiling.
public struct PageFacts: View {
    let facts: PlayerPageModel.Facts

    public init(facts: PlayerPageModel.Facts) {
        self.facts = facts
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            FactRow(fact: facts.drafters, tint: nil)
            FactRow(fact: facts.overReplacement, tint: Self.tint(facts.heat))
            if let outcomes = facts.outcomes {
                OutcomesRow(outcomes: outcomes)
            }
        }
        .overlay(alignment: .bottom) { Hairline() }
    }

    static func tint(_ heat: Heat) -> ThemedColor? {
        switch heat {
        case .round(1): Tokens.Color.heat1
        case .round(2): Tokens.Color.heat2
        case .round(3): Tokens.Color.heat3
        case .round: Tokens.Color.heat4
        case .below: Tokens.Color.heatNeg
        case .none: nil
        }
    }
}

/// One fact: its label, its figure (tinted where the board tints it) and the sentence under it.
struct FactRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let fact: PlayerPageModel.Fact
    let tint: ThemedColor?

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            SmallHead(fact.label)
            HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s1) {
                Text(fact.figure)
                    .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .padding(.horizontal, tint == nil ? 0 : Tokens.Space.s1)
                    .background(tint.map { RoundedRectangle(cornerRadius: Tokens.Radius.sm).fill(theme.color($0)) })
                if let unit = fact.unit {
                    Text(unit)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                        .foregroundStyle(theme.color(Tokens.Color.ink3))
                }
            }
            Text(fact.words)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, Tokens.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Hairline() }
        .accessibilityElement(children: .combine)
    }
}

/// A small uppercase head over a figure or a list (Label.svelte).
struct SmallHead: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink3))
    }
}

/// Floor, median and ceiling as the web's outcome bar: the range from his low case to his high case
/// with the median marked, each figure under its place.
struct OutcomesRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let outcomes: PlayerPageModel.Outcomes

    var body: some View {
        let theme = Theme(colorScheme)
        let span = max(outcomes.ceiling - outcomes.floor, 1)
        let median = (outcomes.median - outcomes.floor) / span
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            SmallHead(outcomes.label)
            GeometryReader { space in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.color(Tokens.Color.surface2)).frame(height: 8)
                    Capsule().fill(theme.color(Tokens.Color.ink2)).frame(width: 3, height: 16)
                        .offset(x: max(0, min(space.size.width - 3, space.size.width * median - 1.5)))
                }
                .frame(maxHeight: .infinity)
            }
            .frame(height: 16)
            HStack {
                Text(Formatting.fixed(outcomes.floor))
                Spacer()
                Text(Formatting.fixed(outcomes.median))
                Spacer()
                Text(Formatting.fixed(outcomes.ceiling))
            }
            .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
            .foregroundStyle(theme.color(Tokens.Color.ink))
            Text(outcomes.caption)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, Tokens.Space.s3)
        .overlay(alignment: .top) { Hairline() }
        .accessibilityElement(children: .combine)
    }
}
