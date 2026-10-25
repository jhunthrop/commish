import CommishAPI
import CommishCore
import CommishDesign
import SwiftUI

/// What the screen's controls do: a row opens the player sheet, a chip chooses.
struct BoardActions {
    let open: (SheetPlayer) -> Void
    /// A format chip, by the run's format id ("ppr-12").
    let format: (String) -> Void
    let position: (BoardPosition?) -> Void

    /// Controls that do nothing: a snapshot's.
    static var none: BoardActions {
        BoardActions(open: { _ in }, format: { _ in }, position: { _ in })
    }
}

/// The board's head (web PageHead at 390): the heading in the number face, the run's stamp, in season
/// the weeks the board ranks, and over a saved board why it shows.
struct BoardHeadView: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: BoardModel
    let stamp: String?

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 2) {
            Text(model.words.heading)
                .font(Faces.font(.num, size: Tokens.TypeScale.display, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            Text(model.stamp)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                .foregroundStyle(theme.color(Tokens.Color.ink3))
            if let rest = model.restLine {
                Text(rest)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
            if let stamp {
                Text(stamp)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
                    .padding(.top, Tokens.Space.s1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The format chips and the position chips, each a row that scrolls sideways (ChipGroup.svelte).
struct BoardChipsView: View {
    let model: BoardModel
    let actions: BoardActions
    var live = true

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            // A run of one format has no other to choose.
            if model.formats.count > 1 {
                ChipRow(chips: model.formats, choose: actions.format, live: live)
            }
            ChipRow(chips: model.positions, choose: actions.position, live: live)
        }
    }
}

/// One row of chips that scrolls sideways; drawn still where nothing scrolls (a snapshot, which
/// cannot draw a scroll view's content).
struct ChipRow<Value: Hashable & Sendable>: View {
    let chips: [BoardChip<Value>]
    let choose: (Value) -> Void
    var live = true

    var body: some View {
        if live {
            ScrollView(.horizontal, showsIndicators: false) { row }
                .scrollClipDisabled()
        } else {
            row.frame(maxWidth: .infinity, alignment: .leading).clipped()
        }
    }

    private var row: some View {
        HStack(spacing: Tokens.Space.s2) {
            ForEach(chips) { chip in
                ChoiceChip(chip.label, pressed: chip.pressed) { choose(chip.value) }
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
        .fixedSize()
    }
}

/// The rows: the heads once, each section's rows under its tier's band or its head (the season-long
/// run). `live` draws rows
/// as they scroll in (the screen, over a whole board); a snapshot draws every row it is given.
struct BoardTableView: View {
    let columns: BoardColumns
    let sections: [BoardSection]
    let open: (SheetPlayer) -> Void
    var live = true

    var body: some View {
        if live {
            LazyVStack(spacing: 0) { content }
        } else {
            VStack(spacing: 0) { content }
        }
    }

    @ViewBuilder
    private var content: some View {
        BoardHeadRow(columns: columns)
        ForEach(sections) { section in
            if let band = section.band {
                TierStripView(band: band)
            }
            if let head = section.head {
                BoardSectionHead(title: head)
            }
            ForEach(section.rows) { row in
                BoardRowView(row: row, columns: columns, open: open)
            }
        }
    }
}

/// The basis, said once at the foot: what the numbers are, then the capture the statuses come from.
struct BoardBasisView: View {
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            ForEach(lines, id: \.self) { BasisText($0) }
        }
        .padding(.horizontal, Tokens.Space.s3)
    }
}

/// The one verb pinned above the bar, where the web's board pins it, on the page's raised shadow.
struct BoardPinView: View {
    @Environment(\.colorScheme) private var colorScheme
    let verb: PageVerb
    let press: () -> Void

    var body: some View {
        Verb(verb.title, action: press)
            .padding(.horizontal, Tokens.Space.s3)
            .padding(.vertical, Tokens.Space.s2)
            .frame(maxWidth: .infinity)
            .background(Theme(colorScheme).color(Tokens.Color.bg))
            .overlay(alignment: .top) { Hairline() }
            .shadow(color: .black.opacity(colorScheme == .dark ? 0.5 : 0.08), radius: 8, y: -2)
    }
}

/// The Board as its model says it, top to bottom, in the web's order at 390: the heading, the chips,
/// the rows, the basis. Pure of state, so a snapshot draws it from the fixture.
public struct BoardScreen: View {
    let model: BoardModel
    let stamp: String?
    let actions: BoardActions
    var sections: [BoardSection]?
    /// The screen's: chips that scroll and rows drawn as they scroll in; a snapshot's draws them still.
    var live = true

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            BoardHeadView(model: model, stamp: stamp).padding(.horizontal, Tokens.Space.s3)
            BoardChipsView(model: model, actions: actions, live: live)
            BoardTableView(
                columns: model.columns, sections: sections ?? model.sections, open: actions.open, live: live
            )
            BoardBasisView(lines: model.basis)
        }
        .padding(.vertical, Tokens.Space.s4)
    }
}

/// The Board with its view model: each format's saved board at once, then the run's; a pull reads
/// again; the chips choose through the view model, which holds them while the player sheet is open
/// and after; a row opens the sheet by his id, and the sheet keeps him when the board reads again
/// under it; the one verb pinned above the bar opens its page.
public struct BoardView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    @Environment(PlayerSheetHost.self) private var sheet
    private let viewModel: BoardViewModel

    public init(viewModel: BoardViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .loaded(model, _, _):
                ScrollView {
                    BoardScreen(model: model, stamp: viewModel.stampWords, actions: actions)
                }
                .refreshable { await viewModel.load() }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if let verb = model.words.verb {
                        BoardPinView(verb: verb) { openURL(verb.page) }
                    }
                }
                .onChange(of: model) { _, fresh in
                    sheet.parentRefreshed(fresh.rows.compactMap(\.sheetPlayer))
                }
            case let .failed(sentence):
                VStack(spacing: Tokens.Space.s4) {
                    // Another format's board may be saved: its chips stay, so the member can turn back.
                    ChipRow(
                        chips: BoardModel.formatChips(viewModel.formats, chosen: viewModel.filter.format),
                        choose: actions.format
                    )
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

    private var actions: BoardActions {
        BoardActions(
            open: { sheet.open($0) },
            format: { format in Task { await viewModel.choose(format: format) } },
            position: { viewModel.choose(position: $0) }
        )
    }
}
