import CommishCore
import CommishDesign
import SwiftUI

/// The player sheet's frame (the web's player shelf): his full page and the close at its top, his
/// face, name, club and position pill from the row, then the body the screen's lane fills. Until it
/// does, the body says what the shelf says while his week is read.
public struct PlayerSheetView<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    private let model: PlayerSheetModel
    private let close: () -> Void
    private let content: Content

    public init(model: PlayerSheetModel, close: @escaping () -> Void, @ViewBuilder content: () -> Content) {
        self.model = model
        self.close = close
        self.content = content()
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            SheetTop(model: model, close: close)
            SheetHead(model: model)
            content
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Tokens.Space.s4)
        .padding(.top, Tokens.Space.s3)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.color(Tokens.Color.bg))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(model.name)
    }
}

public extension PlayerSheetView where Content == BasisText {
    /// The frame with the words the shelf shows while his week is read.
    init(model: PlayerSheetModel, close: @escaping () -> Void) {
        self.init(model: model, close: close) { BasisText(model.loading) }
    }
}

/// The sheet's top: his full page on the site, then the close.
struct SheetTop: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    let model: PlayerSheetModel
    let close: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: Tokens.Space.s2) {
            Spacer()
            // His page as a universal link: the system hands it to the app's player page, or the browser.
            Button { openURL(model.fullPage) } label: {
                Text(model.fullPageWords)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                    .underline()
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.closeWords)
        }
    }
}

/// His face, name, club and position pill, as the row drew him.
struct SheetHead: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: PlayerSheetModel

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: Tokens.Space.s3) {
            Avatar(model.initials, side: 64)
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                Text(model.name)
                    .font(Faces.font(.num, size: Tokens.TypeScale.head, weight: .bold))
                    .textCase(.uppercase)
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                HStack(spacing: Tokens.Space.s2) {
                    if let club = model.club {
                        Text(club)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                            .foregroundStyle(theme.color(Tokens.Color.ink2))
                    }
                    if let pill = model.pill {
                        PositionPill(pill)
                    }
                }
            }
        }
    }
}

public extension View {
    /// Presents the player sheet over this screen for the player the host shows, as a native sheet at
    /// half the screen and the whole of it; `content` fills its body for that player.
    func playerSheet(
        _ host: PlayerSheetHost,
        @ViewBuilder content: @escaping (SheetPlayer) -> some View
    ) -> some View {
        sheet(item: Binding(get: { host.shown }, set: { host.shown = $0 })) { player in
            PlayerSheetView(model: PlayerSheetModel(player: player), close: host.close) { content(player) }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }
}
