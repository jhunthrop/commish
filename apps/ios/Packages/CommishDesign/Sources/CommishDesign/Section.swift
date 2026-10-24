import SwiftUI

/// A section's head as the web draws it: the title, a quiet aside on the same line, and a stamp when the
/// section shows a saved read ("Last read Sun 3:05 pm").
public struct SectionHead: View {
    @Environment(\.colorScheme) private var colorScheme
    private let title: String
    private let aside: String?
    private let stamp: String?

    public init(_ title: String, aside: String? = nil, stamp: String? = nil) {
        self.title = title
        self.aside = aside
        self.stamp = stamp
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 2) {
            // The web's h2: the number face, uppercase (ScoreBoard.svelte, Standings.svelte).
            Text(title)
                .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            if let aside {
                Text(aside)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
            if let stamp {
                Text(stamp)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The basis: what the numbers are, said once in the small face under the screen.
public struct BasisText: View {
    @Environment(\.colorScheme) private var colorScheme
    private let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink3))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A quiet verb: the accent's text, no fill (web Quiet.svelte). The screen's one solid verb is `Verb`.
public struct QuietButton: View {
    @Environment(\.colorScheme) private var colorScheme
    private let title: String
    private let action: () -> Void

    public init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Text(title)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                .foregroundStyle(Theme(colorScheme).color(Tokens.Color.accentText))
                .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
    }
}

/// The screen's one solid verb, in the accent (web Verb.svelte).
public struct Verb: View {
    @Environment(\.colorScheme) private var colorScheme
    private let title: String
    private let action: () -> Void

    public init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Button(action: action) {
            Text(title)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                .foregroundStyle(theme.color(Tokens.Color.accentInk))
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.accent)))
        }
        .buttonStyle(.plain)
    }
}
