import CommishCore
import CommishDesign
import SwiftUI

/// A tier's band over its rows, as the web's TierStrip draws it at 390: a row's height, the tier's
/// number once on its shade of the one ink ramp, its name and count, and the drop to the next tier in
/// the row's figure size (or the last tier's words), on the band's wash with the shade under it.
struct TierStripView: View {
    @Environment(\.colorScheme) private var colorScheme
    let band: TierBand

    /// tokens.css --tier-wash: how much of the tier's shade tints its band, light and dark.
    static let wash = (light: 9.0, dark: 16.0)
    /// The strip's column and the band's least height at 390 (TierStrip.svelte).
    static let strip: Double = 36
    static let height: Double = 40
    /// The rule under the band.
    static let rule: Double = 2

    var body: some View {
        let theme = Theme(colorScheme)
        let shade = Self.shade(band.tier)
        HStack(spacing: Tokens.Space.s2) {
            Text(String(band.tier))
                .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(theme.color(Self.ink(band.tier)))
                .frame(width: Self.strip)
                .frame(maxHeight: .infinity)
                .background(theme.color(shade))
            HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s2) {
                Text(band.name)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                Text(band.count).modifier(Quiet(theme: theme))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if let drop = band.drop {
                    Text(drop)
                        .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                }
                Text(band.dropWords).modifier(Quiet(theme: theme))
            }
            .padding(.trailing, Tokens.Space.s2)
        }
        .frame(minHeight: Self.height)
        .fixedSize(horizontal: false, vertical: true)
        .background(theme.mix(shade, colorScheme == .dark ? Self.wash.dark : Self.wash.light, into: Tokens.Color.bg))
        .overlay(alignment: .bottom) {
            Rectangle().fill(theme.color(shade)).frame(height: Self.rule)
        }
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: Tokens.Radius.md, topTrailingRadius: Tokens.Radius.md))
        .padding(.top, Tokens.Space.s4)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    /// ui/tier.ts tierColor: seven steps of the one ink ramp (TIER_HUES), a tier past the last sharing
    /// its lightest.
    static let shades = [
        Tokens.Color.tier1, Tokens.Color.tier2, Tokens.Color.tier3, Tokens.Color.tier4, Tokens.Color.tier5,
        Tokens.Color.tier6, Tokens.Color.tier7,
    ]
    /// ui/tier.ts tierInk: the text on each step.
    static let inks = [
        Tokens.Color.tierInk1, Tokens.Color.tierInk2, Tokens.Color.tierInk3, Tokens.Color.tierInk4,
        Tokens.Color.tierInk5, Tokens.Color.tierInk6, Tokens.Color.tierInk7,
    ]

    static func shade(_ tier: Int) -> ThemedColor {
        shades[step(tier)]
    }

    static func ink(_ tier: Int) -> ThemedColor {
        inks[step(tier)]
    }

    /// The tier's step on the ramp, zero-based, the last for every tier past it.
    private static func step(_ tier: Int) -> Int {
        min(max(tier, 1), shades.count) - 1
    }
}

/// The band's quieter words: its count and the drop's unit.
private struct Quiet: ViewModifier {
    let theme: Theme

    func body(content: Content) -> some View {
        content
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .medium))
            .lineLimit(1)
            .foregroundStyle(theme.color(Tokens.Color.ink2))
    }
}
