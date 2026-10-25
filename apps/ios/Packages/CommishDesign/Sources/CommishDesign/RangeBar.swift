import SwiftUI

/// An outcome range on a shared scale (the web's RangeBar.svelte): the track, the floor-to-ceiling span
/// in the strong line, the median as an ink tick, and, stacked, the two ends in words under it. Every
/// position is a percent of the bar, decided by the caller's model.
public struct RangeBar: View {
    @Environment(\.colorScheme) private var colorScheme
    let left: Double
    let width: Double
    let mid: Double
    let text: String?
    let spoken: String

    /// RangeBar.svelte's track and tick.
    private static let track: Double = 8
    private static let tick = CGSize(width: 3, height: 16)

    /// Percents of the bar; `text` the ends under it ("212.3 to 407.3"), nil for the bar alone;
    /// `spoken` what VoiceOver reads, the text by default.
    public init(left: Double, width: Double, mid: Double, text: String? = nil, spoken: String? = nil) {
        self.left = left
        self.width = width
        self.mid = mid
        self.text = text
        self.spoken = spoken ?? text ?? ""
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 4) {
            GeometryReader { proxy in
                let place = { (percent: Double) in proxy.size.width * percent / 100 }
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.color(Tokens.Color.surface2)).frame(height: Self.track)
                    Capsule().fill(theme.color(Tokens.Color.lineStrong))
                        .frame(width: max(place(width), 2), height: Self.track)
                        .offset(x: place(left))
                    RoundedRectangle(cornerRadius: 2).fill(theme.color(Tokens.Color.ink))
                        .frame(width: Self.tick.width, height: Self.tick.height)
                        .offset(x: place(mid) - Self.tick.width / 2)
                }
                .frame(maxHeight: .infinity)
            }
            .frame(height: Self.tick.height)
            if let text {
                Text(text)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .textCase(.uppercase)
                    .tracking(Tokens.TypeScale.xs * 0.06)
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: spoken))
    }
}
