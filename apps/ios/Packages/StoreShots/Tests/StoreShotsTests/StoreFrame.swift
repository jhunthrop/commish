import CommishCore
import CommishDesign
import Shell
import SwiftUI

/// A screen as a store shot draws it: its top, cut where the phone's room ends, and the verb the screen
/// pins above the bar, if any.
struct StoreScreen {
    let body: AnyView
    let pin: AnyView?

    init(_ body: some View) {
        self.body = AnyView(body)
        pin = nil
    }

    init(_ body: some View, pin: some View) {
        self.body = AnyView(body)
        self.pin = AnyView(pin)
    }
}

/// The app's own bars around a screen: the top bar with the league's face, the phone's five at the foot
/// with the screen's tab lit (none for a pushed page).
struct StoreChrome {
    let face: String
    let tabs: [RailTab]
    let lit: String?
}

/// One store screenshot at a phone's size: the whistle and the caption on the surface, the screen below
/// it as the phone draws it (its bars where the app has them), the phone's foot at the bottom edge.
struct StoreShotFrame: View {
    @Environment(\.colorScheme) private var colorScheme
    let caption: String
    let chrome: StoreChrome?
    let screen: StoreScreen
    let size: CGSize

    static let markSide: Double = 26
    static let captionSize: Double = 26
    static let phoneCorner: Double = 28
    static let phoneInset: Double = 14

    var body: some View {
        let theme = Theme(colorScheme)
        let corner = UnevenRoundedRectangle(topLeadingRadius: Self.phoneCorner, topTrailingRadius: Self.phoneCorner)
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                Mark(side: Self.markSide)
                Text(caption)
                    .font(Faces.font(.ui, size: Self.captionSize, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, Tokens.Space.s5 + Tokens.Space.s1)
            .padding(.top, Tokens.Space.s6)
            .padding(.bottom, Tokens.Space.s5)
            phone
                .background(theme.color(Tokens.Color.bg))
                .clipShape(corner)
                .overlay(corner.stroke(theme.color(Tokens.Color.lineStrong), lineWidth: 1))
                .padding(.horizontal, Self.phoneInset)
        }
        .frame(width: size.width, height: size.height, alignment: .top)
        .background(theme.color(Tokens.Color.surface))
    }

    private var phone: some View {
        VStack(spacing: 0) {
            if let chrome {
                TopBar(
                    face: chrome.face, open: false, query: .constant(""), still: true,
                    actions: TopBarActions(toggleSwitch: {}, openAccount: {}, search: { _ in })
                )
            }
            // The room between the bars takes what is left; the screen's top fills it from its top edge
            // and is cut at its foot, as the phone's first screen shows it.
            Color.clear
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .overlay(alignment: .top) { screen.body.fixedSize(horizontal: false, vertical: true) }
                .clipped()
            if let pin = screen.pin {
                pin
            }
            if let chrome {
                TabStrip(tabs: chrome.tabs, lit: chrome.lit)
            }
        }
    }
}
