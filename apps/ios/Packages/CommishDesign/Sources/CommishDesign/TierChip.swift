import SwiftUI

/// ui/tier.ts: a tier's shade on the one ink ramp and the text on it, seven steps, a tier past the last
/// sharing its lightest. The Board's bands and the cheat sheet's chips draw from it.
public enum TierRamp {
    /// tierColor: the seven steps (TIER_HUES).
    static let shades = [
        Tokens.Color.tier1, Tokens.Color.tier2, Tokens.Color.tier3, Tokens.Color.tier4, Tokens.Color.tier5,
        Tokens.Color.tier6, Tokens.Color.tier7,
    ]
    /// tierInk: the text on each step.
    static let inks = [
        Tokens.Color.tierInk1, Tokens.Color.tierInk2, Tokens.Color.tierInk3, Tokens.Color.tierInk4,
        Tokens.Color.tierInk5, Tokens.Color.tierInk6, Tokens.Color.tierInk7,
    ]

    public static func shade(_ tier: Int) -> ThemedColor {
        shades[step(tier)]
    }

    public static func ink(_ tier: Int) -> ThemedColor {
        inks[step(tier)]
    }

    /// The tier's step on the ramp, zero-based, the last for every tier past it.
    private static func step(_ tier: Int) -> Int {
        min(max(tier, 1), shades.count) - 1
    }
}

/// A tier in a row (TierChip.svelte): "T3" on the tier's shade.
public struct TierChip: View {
    @Environment(\.colorScheme) private var colorScheme
    private let tier: Int

    public init(_ tier: Int) {
        self.tier = tier
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Text("T\(tier)")
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
            .tracking(Tokens.TypeScale.xs * 0.04)
            .foregroundStyle(theme.color(TierRamp.ink(tier)))
            .padding(.horizontal, 7)
            .frame(height: 20)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.sm).fill(theme.color(TierRamp.shade(tier))))
    }
}
