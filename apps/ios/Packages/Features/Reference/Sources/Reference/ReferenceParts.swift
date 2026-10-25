import Board
import CommishCore
import CommishDesign
import SwiftUI

/// What a reference screen's controls do: a row opens the player sheet, a link opens its page (a club,
/// ADP in another format, Compare), which the app pushes as its own screen.
public struct ReferenceActions {
    let open: (SheetPlayer) -> Void
    let link: (URL) -> Void

    public init(open: @escaping (SheetPlayer) -> Void, link: @escaping (URL) -> Void) {
        self.open = open
        self.link = link
    }

    /// Controls that do nothing: a snapshot's.
    static var none: ReferenceActions {
        ReferenceActions(open: { _ in }, link: { _ in })
    }

    /// A club chip: the club's page.
    func club(_ abbr: String) {
        link(SiteLinks.club(abbr))
    }
}

/// A reference page's head (web PageHead at 390): the heading in the number face, the run's stamp,
/// the page's lead, and over a saved screen why it shows.
struct ReferenceHead: View {
    @Environment(\.colorScheme) private var colorScheme
    let heading: String
    let stamp: String?
    var lead: String?
    /// Why a saved screen shows: offline, or the last read.
    var stale: String?

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 2) {
            Text(heading)
                .font(Faces.font(.num, size: Tokens.TypeScale.display, weight: .bold))
                .textCase(.uppercase)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            if let stamp {
                Text(stamp)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
            if let lead {
                Text(lead)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .padding(.top, Tokens.Space.s1)
            }
            if let stale {
                Text(stale)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
                    .padding(.top, Tokens.Space.s1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Tokens.Space.s3)
    }
}

/// A column head over a table's figures: the small caps the board's heads use.
struct ColumnHead: View {
    @Environment(\.colorScheme) private var colorScheme
    let words: String
    var alignment: Alignment = .trailing

    var body: some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .lineLimit(2)
            .minimumScaleFactor(0.75)
            .multilineTextAlignment(alignment == .leading ? .leading : .trailing)
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink3))
            .frame(maxWidth: .infinity, alignment: alignment)
    }
}

/// A figure in a row, in the number face, the empty figure quiet.
struct RowFigure: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String
    var ink: ThemedColor = Tokens.Color.ink2
    var size: Double = Tokens.TypeScale.lg

    var body: some View {
        Text(text)
            .font(Faces.font(.num, size: size, weight: .semibold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .foregroundStyle(Theme(colorScheme).color(text == Words.Box.none ? Tokens.Color.ink3 : ink))
    }
}

/// The screen with its view model: the saved or read screen in a scroll that a pull reads again, the
/// verb pinned above the bar, the words and a try again where nothing could be read.
struct RunScreenContainer<Model: Equatable & Sendable, Content: View, Pin: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    let viewModel: RunScreenViewModel<Model>
    @ViewBuilder let content: (Model, String?) -> Content
    @ViewBuilder let pin: (Model) -> Pin

    var body: some View {
        let theme = Theme(colorScheme)
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .loaded(model, _):
                ScrollView { content(model, viewModel.stampWords) }
                    .refreshable { await viewModel.load() }
                    .safeAreaInset(edge: .bottom, spacing: 0) { pin(model) }
            case let .failed(sentence):
                VStack(spacing: Tokens.Space.s4) {
                    BasisText(sentence).padding(.horizontal, Tokens.Space.s3)
                    QuietButton(AppWords.Failure.tryAgain) {
                        Task { await viewModel.load() }
                    }
                }
                .padding(.vertical, Tokens.Space.s5)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.color(Tokens.Color.bg))
        .task { await viewModel.load() }
    }
}

/// The one verb pinned above the bar, opening its page on the site where the app has no screen for it
/// (a mock draft).
struct PagePin: View {
    @Environment(\.openURL) private var openURL
    let verb: PageVerb

    var body: some View {
        BoardPinView(verb: verb) { openURL(verb.page) }
    }
}
