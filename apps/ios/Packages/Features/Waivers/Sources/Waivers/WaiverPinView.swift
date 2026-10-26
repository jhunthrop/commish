import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// What the pin's controls do.
struct WaiverPinActions {
    let press: () -> Void
    let confirm: () -> Void
    let close: () -> Void
    let bid: @MainActor (String) -> Void

    static var none: WaiverPinActions {
        WaiverPinActions(press: {}, confirm: {}, close: {}, bid: { _ in })
    }
}

/// The screen's one verb pinned above the bar (Screen.svelte's pin): the pair an open row's verb makes in
/// bold over it, the verb full width, the line under it; while the claim is open its confirmation (with
/// the bid field where the league bids) stands in the verb's place, so one verb shows.
struct WaiverPinView: View {
    @Environment(\.colorScheme) private var colorScheme
    let pin: WaiverPin
    let actions: WaiverPinActions
    /// Draws the bid field at rest, its bid as words (a snapshot cannot draw a text field's contents).
    var still = false

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: Tokens.Space.s1) {
            if let panel = pin.panel {
                MovePanelView(
                    panel: panel, title: Words.Move.claimTitle, confirm: actions.confirm, close: actions.close
                ) {
                    if let bid = pin.bid {
                        BidFieldView(field: bid, change: actions.bid, still: still)
                    }
                }
            } else {
                if let pair = pin.pair {
                    Text(pair)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .bold))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
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

/// The claim's bid (MovePanel.svelte's bid field): its label naming the number's basis, the bid as typed
/// in waiver dollars, and what the league does not take in the platform's terms. We never suggest a bid.
struct BidFieldView: View {
    @Environment(\.colorScheme) private var colorScheme
    let field: BidField
    let change: @MainActor (String) -> Void
    let still: Bool
    @FocusState private var typing: Bool

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            Text(field.label)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .fixedSize(horizontal: false, vertical: true)
            Group {
                if still {
                    Text(field.typed)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    TextField(field.label, text: Binding(get: { field.typed }, set: { change($0) }))
                        .labelsHidden()
                        .focused($typing)
                    #if os(iOS)
                        .keyboardType(.numberPad)
                    #endif
                        .disabled(!field.editable)
                        // The number pad has no return key: Done above it puts the keyboard away.
                        .toolbar {
                            ToolbarItemGroup(placement: .keyboard) {
                                Spacer()
                                Button(Words.Move.done) { typing = false }
                            }
                        }
                }
            }
            .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(theme.color(Tokens.Color.ink))
            .padding(.horizontal, Tokens.Space.s2)
            .frame(width: 112, height: 40)
            .background(theme.color(Tokens.Color.surface))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                .strokeBorder(theme.color(Tokens.Color.lineStrong)))
            if let problem = field.problem {
                Text(problem)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.lossInk))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
