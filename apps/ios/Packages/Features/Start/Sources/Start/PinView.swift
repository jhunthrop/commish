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
                MovePanelView(
                    panel: panel, title: Words.Move.title, confirm: actions.confirm, close: actions.close
                ) { EmptyView() }
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
