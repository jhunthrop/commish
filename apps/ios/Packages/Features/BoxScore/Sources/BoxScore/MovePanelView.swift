import CommishCore
import CommishDesign
import SwiftUI

/// A line under the verb: its words, a run that opens a page underlined in the ink.
public struct FootLine: View {
    @Environment(\.colorScheme) private var colorScheme
    let runs: [FootRun]

    public init(runs: [FootRun]) {
        self.runs = runs
    }

    public var body: some View {
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
/// makes it and a way out (a claim's bid field between them, where the league bids); then what it came
/// to, the platform's reason under a refusal in its own words, the platform's page where the member
/// should look; a failure on the loss's edge. The Start screen's lineup move and the Waivers claim.
public struct MovePanelView<Field: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    let panel: MovePanel
    let title: String
    let confirm: () -> Void
    let close: () -> Void
    let field: Field

    public init(
        panel: MovePanel, title: String, confirm: @escaping () -> Void, close: @escaping () -> Void,
        @ViewBuilder field: () -> Field
    ) {
        self.panel = panel
        self.title = title
        self.confirm = confirm
        self.close = close
        self.field = field()
    }

    public var body: some View {
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
            field
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
        .accessibilityLabel(title)
    }

    @ViewBuilder
    private var controls: some View {
        if let verb = panel.verb {
            Verb(verb, enabled: panel.verbEnabled, action: confirm)
        }
        if let page = panel.page, panel.pageSolid, let url = page.url {
            Verb(page.text) { openURL(url) }
        }
        HStack(spacing: Tokens.Space.s4) {
            if let page = panel.page, !panel.pageSolid, let url = page.url {
                QuietButton(page.text) { openURL(url) }
            }
            if let way = panel.close {
                QuietButton(way, action: close)
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
