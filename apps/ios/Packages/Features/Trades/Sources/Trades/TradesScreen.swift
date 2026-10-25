import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// What the screen's controls do: a name opens the player sheet, a row opens or closes its trade, a
/// verb copies the trade's offer, the chips and the gain heads reorder the finder.
public struct TradeActions {
    let open: (SheetPlayer) -> Void
    let toggle: (String) -> Void
    let press: (String) -> Void
    let showEvery: (Bool) -> Void
    let sort: (TradeSort) -> Void

    public init(
        open: @escaping (SheetPlayer) -> Void = { _ in }, toggle: @escaping (String) -> Void = { _ in },
        press: @escaping (String) -> Void = { _ in }, showEvery: @escaping (Bool) -> Void = { _ in },
        sort: @escaping (TradeSort) -> Void = { _ in }
    ) {
        self.open = open
        self.toggle = toggle
        self.press = press
        self.showEvery = showEvery
        self.sort = sort
    }
}

/// What the member has done on the screen: the chips, the order, the trades opened, their checks and
/// the lines under the pressed verbs.
public struct TradesShown: Equatable {
    public let every: Bool
    public let sort: TradeSort
    public let opened: Set<String>
    public let checks: [String: TradeCheckState]
    public let copied: [String: CopiedLine]

    public init(
        every: Bool = false, sort: TradeSort = .mine, opened: Set<String> = [],
        checks: [String: TradeCheckState] = [:], copied: [String: CopiedLine] = [:]
    ) {
        self.every = every
        self.sort = sort
        self.opened = opened
        self.checks = checks
        self.copied = copied
    }
}

/// The Trades as its model says it, in the web's order (TradeScreen.svelte at 390): the strip of the
/// trades worth proposing, the chips, the finder with any trade opened, the basis once at the foot with
/// the record's link. Pure of state, so a snapshot draws it from the fixture at the fixture's clock.
public struct TradesScreen: View {
    let model: TradesModel
    let stamp: String?
    let shown: TradesShown
    let actions: TradeActions

    public init(model: TradesModel, stamp: String?, shown: TradesShown, actions: TradeActions = TradeActions()) {
        self.model = model
        self.stamp = stamp
        self.shown = shown
        self.actions = actions
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            ForEach(TradesPart.allCases, id: \.self) { part in
                TradesPartView(part: part, model: model, stamp: stamp, shown: shown, actions: actions)
            }
        }
        .padding(.vertical, Tokens.Space.s4)
    }
}

/// The screen's runs, top to bottom: each a snapshot of its own, so no reference grows past what a
/// repository keeps.
public enum TradesPart: CaseIterable, Sendable {
    /// The strip (or the decision where no trade is worth proposing) and the chips.
    case strip
    /// The finder, any trade opened in it.
    case finder
    /// The basis and the record's link.
    case basis
}

struct TradesPartView: View {
    let part: TradesPart
    let model: TradesModel
    let stamp: String?
    let shown: TradesShown
    let actions: TradeActions

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            switch part {
            case .strip:
                if let strip = model.strip {
                    TradeStripView(
                        strip: strip, verb: model.verb, page: model.page, stamp: stamp, copied: shown.copied,
                        press: actions.press
                    )
                } else {
                    DecisionView(decision: model.decision, stamp: stamp)
                }
                ChipsRow(model: model, every: shown.every, showEvery: actions.showEvery)
            case .finder:
                TradeFinderView(model: model, shown: shown, actions: actions)
            case .basis:
                BasisFoot(text: shown.opened.isEmpty ? model.basis : model.basisOpened)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
    }
}

/// No trade worth proposing: the decision in the screen's large face, the stamp of a saved read under.
struct DecisionView: View {
    @Environment(\.colorScheme) private var colorScheme
    let decision: String
    let stamp: String?

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 2) {
            Text(decision)
                .font(Faces.font(.ui, size: Tokens.TypeScale.lg, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            if let stamp {
                StampText(stamp)
            }
        }
    }
}

/// "Last read Sat 12:00 pm": a saved read's stamp, in the accent's ink.
struct StampText: View {
    @Environment(\.colorScheme) private var colorScheme
    let stamp: String

    init(_ stamp: String) {
        self.stamp = stamp
    }

    var body: some View {
        Text(stamp)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.accentText))
    }
}

/// Each team's best, or every trade, with their counts (TradeScreen's chip group).
struct ChipsRow: View {
    let model: TradesModel
    let every: Bool
    let showEvery: (Bool) -> Void

    var body: some View {
        FlowRow(spacing: Tokens.Space.s2) {
            ChoiceChip(model.best, pressed: !every) { showEvery(false) }
            ChoiceChip(model.every, pressed: every) { showEvery(true) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Words.Trades.every)
    }
}

/// The basis, then "How the order has done", which opens our record.
struct BasisFoot: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    let text: String

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            BasisText(text)
            Button { openURL(SiteLinks.record) } label: {
                Text(Words.InSeason.orderRecord)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .underline()
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
        }
    }
}

/// The line under a pressed verb: "Copied. Propose it on FFPC's trade page.", the page its link when
/// the platform's page is known.
struct CopiedText: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    let line: CopiedLine
    let page: URL?

    var body: some View {
        let theme = Theme(colorScheme)
        Button {
            if let page {
                openURL(page)
            }
        } label: {
            Text(words(theme))
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .disabled(page == nil)
        .accessibilityLabel(line.words)
    }

    private func words(_ theme: Theme) -> AttributedString {
        var said = AttributedString("\(line.said) \(Words.Trades.proposeItOn) ")
        said.foregroundColor = theme.color(Tokens.Color.ink2)
        var link = AttributedString(line.page)
        link.foregroundColor = theme.color(Tokens.Color.ink)
        link.font = Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold)
        if page != nil {
            link.underlineStyle = .single
        }
        var stop = AttributedString(".")
        stop.foregroundColor = theme.color(Tokens.Color.ink2)
        return said + link + stop
    }
}

/// The Trades with its view model: the saved finder at once, then the API's; a pull reads again; a
/// row opens its trade and reads its check; a verb copies the offer and opens the platform's trade
/// page; a name opens the player sheet by his id, and the sheet keeps its player when the finder reads
/// again under it.
public struct TradesView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    @Environment(PlayerSheetHost.self) private var sheet
    private let viewModel: TradesViewModel
    private let leagueID: String

    public init(viewModel: TradesViewModel, leagueID: String) {
        self.viewModel = viewModel
        self.leagueID = leagueID
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .loaded(model, _, _):
                ScrollView {
                    TradesScreen(model: model, stamp: viewModel.stampWords, shown: shown, actions: actions(model))
                }
                .refreshable { await viewModel.load(leagueID: leagueID) }
                .onChange(of: model) { _, fresh in
                    sheet.parentRefreshed(fresh.sheetPlayers)
                }
            case let .failed(sentence):
                VStack(spacing: Tokens.Space.s4) {
                    BasisText(sentence)
                    QuietButton(AppWords.Failure.tryAgain) {
                        Task { await viewModel.load(leagueID: leagueID) }
                    }
                }
                .padding(Tokens.Space.s5)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.color(Tokens.Color.bg))
        .task { await viewModel.load(leagueID: leagueID) }
    }

    private var shown: TradesShown {
        TradesShown(
            every: viewModel.every, sort: viewModel.sort, opened: viewModel.opened, checks: viewModel.checks,
            copied: viewModel.copied
        )
    }

    private func actions(_ model: TradesModel) -> TradeActions {
        TradeActions(
            open: { sheet.open($0) },
            toggle: { key in Task { await viewModel.toggle(key, leagueID: leagueID) } },
            press: { key in
                viewModel.press(key)
                // As the web's verb: the offer copied, then the platform's trade page.
                if let page = model.page {
                    openURL(page)
                }
            },
            showEvery: { viewModel.showEvery($0) },
            sort: { viewModel.sort(by: $0) }
        )
    }
}
