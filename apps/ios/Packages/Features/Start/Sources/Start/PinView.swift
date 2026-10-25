import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// What the pin's controls do.
struct PinActions {
    let press: () -> Void
    let confirm: () -> Void
    let close: () -> Void
}

/// The screen's one verb pinned above the bar (web PinnedVerb.svelte and Screen.svelte's pin): full
/// width, on the page's raised shadow, the line under it; while the move is open its confirmation
/// stands in the verb's place, so one verb shows.
struct PinView: View {
    @Environment(\.colorScheme) private var colorScheme
    let pin: StartPin
    let actions: PinActions

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: Tokens.Space.s1) {
            if let panel = pin.panel {
                MovePanelView(panel: panel, actions: actions)
            } else {
                if let verb = pin.verb {
                    Verb(verb, enabled: pin.enabled, action: actions.press)
                }
                ForEach(Array(pin.foot.enumerated()), id: \.offset) { _, line in
                    FootLine(runs: line)
                }
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s2)
        .frame(maxWidth: .infinity)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .top) { Hairline() }
        .shadow(color: .black.opacity(colorScheme == .dark ? 0.5 : 0.08), radius: 8, y: -2)
    }
}

/// A line under the verb: its words, a run that opens a page underlined in the ink.
struct FootLine: View {
    @Environment(\.colorScheme) private var colorScheme
    let runs: [FootRun]

    var body: some View {
        let theme = Theme(colorScheme)
        Text(said(theme))
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity)
    }

    private func said(_ theme: Theme) -> AttributedString {
        runs.reduce(into: AttributedString()) { line, run in
            var part = AttributedString(run.text)
            part.foregroundColor = theme.color(run.url == nil ? Tokens.Color.ink2 : Tokens.Color.ink)
            if let url = run.url {
                part.link = url
                part.underlineStyle = .single
                part.font = Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold)
            }
            line += part
        }
    }
}

/// The move's confirmation (web MovePanel.svelte): the move in the API's words with the verb that
/// makes it and a way out; then what it came to, the platform's reason under a refusal in its own
/// words, the platform's page where the member should look; a failure on the loss's edge.
struct MovePanelView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    let panel: MovePanel
    let actions: PinActions

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            Text(panel.line)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: panel.tone == .quiet ? .regular : .semibold))
                .foregroundStyle(theme.color(ink))
                .fixedSize(horizontal: false, vertical: true)
            if let said = panel.said {
                Text(said)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .fixedSize(horizontal: false, vertical: true)
            }
            controls
        }
        .padding(Tokens.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.color(Tokens.Color.surface))
        .overlay(alignment: .leading) {
            Rectangle().fill(theme.color(panel.tone == .problem ? Tokens.Color.lossInk : Tokens.Color.accent))
                .frame(width: 4)
        }
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.line)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Words.Move.title)
    }

    @ViewBuilder
    private var controls: some View {
        if let verb = panel.verb {
            Verb(verb, enabled: panel.verbEnabled, action: actions.confirm)
        }
        if let page = panel.page, panel.pageSolid, let url = page.url {
            Verb(page.text) { openURL(url) }
        }
        HStack(spacing: Tokens.Space.s4) {
            if let page = panel.page, !panel.pageSolid, let url = page.url {
                QuietButton(page.text) { openURL(url) }
            }
            if let close = panel.close {
                QuietButton(close, action: actions.close)
            }
        }
    }

    private var ink: ThemedColor {
        switch panel.tone {
        case .plain: Tokens.Color.ink
        case .quiet: Tokens.Color.ink2
        case .problem: Tokens.Color.lossInk
        }
    }
}
