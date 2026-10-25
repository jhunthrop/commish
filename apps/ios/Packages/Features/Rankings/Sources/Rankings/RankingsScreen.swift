import BoxScore
import CommishAPI
import CommishCore
import CommishDesign
import SwiftUI

/// What the screen's controls do: a name opens the player sheet, a chip chooses, the search's letters,
/// Show more.
public struct RankingsActions {
    let open: (SheetPlayer) -> Void
    let choose: (RankingsChip?) -> Void
    let find: (String) -> Void
    let more: () -> Void

    /// Controls that do nothing: a snapshot's.
    static var none: RankingsActions {
        RankingsActions(open: { _ in }, choose: { _ in }, find: { _ in }, more: {})
    }
}

/// The page's head (PageHead at 390): "Rankings" in the number face, the sentence under it, and over a
/// saved read when it was read.
struct RankingsHeadView: View {
    @Environment(\.colorScheme) private var colorScheme
    let name: String
    let lead: String?
    let stamp: String?

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 2) {
            Text(name)
                .font(Faces.font(.num, size: Tokens.TypeScale.display, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            if let lead {
                Text(lead)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
            if let stamp {
                Text(stamp)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
                    .padding(.top, Tokens.Space.s1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The search, big, with the hits beside it, and the chips: All, our order's four, the week's K and
/// D/ST (OrderScreen.svelte's players mode at 390).
struct RankingsFiltersView: View {
    @Environment(\.colorScheme) private var colorScheme
    let chip: RankingsChip?
    let query: String
    let hits: String?
    let actions: RankingsActions
    /// Draws the field at rest and the chips unscrolled (a snapshot draws no scroll view or field).
    var still = false

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            HStack(spacing: Tokens.Space.s2) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                if still {
                    Text(query.isEmpty ? Words.Order.search : query)
                        .foregroundStyle(theme.color(query.isEmpty ? Tokens.Color.ink3 : Tokens.Color.ink))
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    TextField(Words.Order.search, text: Binding(get: { query }, set: { actions.find($0) }))
                    #if os(iOS)
                        .textInputAutocapitalization(.never)
                    #endif
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                }
                if let hits {
                    Text(hits)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                        .monospacedDigit()
                        .lineLimit(1)
                        .foregroundStyle(theme.color(Tokens.Color.ink3))
                }
            }
            .font(Faces.font(.ui, size: Tokens.TypeScale.md))
            .lineLimit(1)
            .padding(.horizontal, Tokens.Space.s3)
            .frame(height: 44)
            .background(theme.color(Tokens.Color.surface))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .strokeBorder(theme.color(Tokens.Color.lineStrong)))
            .accessibilityLabel(Words.Order.search)
            if still {
                chips
            } else {
                ScrollView(.horizontal, showsIndicators: false) { chips }
            }
        }
    }

    private var chips: some View {
        HStack(spacing: Tokens.Space.s2) {
            ChoiceChip(Words.Order.every, pressed: chip == nil) { actions.choose(nil) }
            ForEach(RankingsChip.allCases) { next in
                ChoiceChip(next.word, pressed: chip == next) { actions.choose(next) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Words.InSeason.position)
    }
}

/// Our order as a box score (OrderTable.svelte at 390): the heads, the rows that play, the byes under
/// their head; or the line when a filter leaves none.
struct RankingsTableView: View {
    let model: RankingsModel
    let sections: [RankingsSection<RankingsRow>]
    let open: (SheetPlayer) -> Void

    var body: some View {
        if let none = model.none {
            BasisText(none)
        } else {
            TableFrame {
                RankingsHeadRow(heads: model.heads)
                ForEach(sections) { section in
                    if let head = section.head {
                        SectionRow(title: head)
                    }
                    ForEach(section.rows) { row in
                        RankingsRowView(row: row, open: open)
                    }
                }
            }
            .accessibilityLabel(Words.Order.rankGroup)
        }
    }
}

/// The kickers' or defenses' week (WeekScreen.svelte at 390): its basis line with the rules our stats
/// lack over the rows, the status line before the week's projection is in, the rows in their sections,
/// or the line when a search matches none.
struct WeekRankingsView: View {
    let model: WeekRankingsModel
    let sections: [RankingsSection<WeekRankingsRow>]
    let open: (SheetPlayer) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            BasisText([model.basis, model.rules].compactMap(\.self).joined(separator: " "))
            if let status = model.status {
                BasisText(status)
            }
            if let none = model.none {
                BasisText(none)
            } else {
                TableFrame {
                    WeekHeadRow(proj: model.proj)
                    ForEach(sections) { section in
                        if let head = section.head {
                            SectionRow(title: head)
                        }
                        ForEach(section.rows) { row in
                            WeekRankingsRowView(
                                row: row, proj: model.proj, kicked: section.key == "kicked_off", open: open
                            )
                        }
                    }
                }
                .accessibilityLabel(model.heading)
            }
        }
    }
}

/// The Rankings as the view model says them, in the web's order at 390: the head, the search and the
/// chips, then our order with Show more and its basis once, or the week's. Pure of state, so a snapshot
/// draws it from the fixture; `rows` limits the rows a snapshot draws.
public struct RankingsScreen: View {
    let name: String
    let lead: String?
    let stamp: String?
    let chip: RankingsChip?
    let query: String
    let content: RankingsContent
    let more: Bool
    /// Why the chip or search asked for last could not be read, said once over the rows shown.
    var problem: String?
    let actions: RankingsActions
    var still = false
    var rows: Int?

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            RankingsHeadView(name: name, lead: lead, stamp: stamp)
            switch content {
            case let .order(model):
                RankingsFiltersView(chip: chip, query: query, hits: model.hits, actions: actions, still: still)
                ProblemLine(problem: problem)
                RankingsTableView(model: model, sections: Self.first(model.sections, rows), open: actions.open)
                if more, rows == nil {
                    QuietButton(Words.Order.moreRows, action: actions.more)
                        .frame(maxWidth: .infinity)
                }
                if rows == nil || model.none != nil {
                    BasisText(model.basis)
                }
            case let .week(model):
                RankingsFiltersView(chip: chip, query: query, hits: nil, actions: actions, still: still)
                ProblemLine(problem: problem)
                WeekRankingsView(model: model, sections: Self.first(model.sections, rows), open: actions.open)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s4)
    }

    /// The sections up to `rows` rows, every row with none.
    static func first<Row>(_ sections: [RankingsSection<Row>], _ rows: Int?) -> [RankingsSection<Row>] {
        guard var left = rows else {
            return sections
        }
        return sections.compactMap { section in
            guard left > 0 else {
                return nil
            }
            let kept = Array(section.rows.prefix(left))
            left -= kept.count
            return section.with(rows: kept)
        }
    }
}

/// The one line over the rows when the chip or search asked for could not be read, in the loss's ink.
struct ProblemLine: View {
    @Environment(\.colorScheme) private var colorScheme
    let problem: String?

    var body: some View {
        if let problem {
            Text(problem)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(Theme(colorScheme).color(Tokens.Color.lossInk))
        }
    }
}

/// The Rankings with their view model: the saved read at once, then the API's; a pull reads again; a
/// search on our order reads once its letters rest; a row's name opens the player sheet by his id, and
/// the sheet keeps its player when the rows read again under it.
public struct RankingsView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(PlayerSheetHost.self) private var sheet
    private let viewModel: RankingsViewModel

    public init(viewModel: RankingsViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .loaded(content, _, _):
                ScrollView {
                    RankingsScreen(
                        name: viewModel.name, lead: viewModel.lead, stamp: viewModel.stampWords, chip: viewModel.chip,
                        query: viewModel.query, content: content, more: viewModel.more, problem: viewModel.problem,
                        actions: actions
                    )
                }
                .refreshable { await viewModel.load() }
                .onChange(of: content) { _, fresh in
                    sheet.parentRefreshed(fresh.sheetPlayers)
                }
            case let .failed(sentence):
                VStack(spacing: Tokens.Space.s4) {
                    BasisText(sentence)
                    QuietButton(AppWords.Failure.tryAgain) {
                        Task { await viewModel.load() }
                    }
                }
                .padding(Tokens.Space.s5)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.color(Tokens.Color.bg))
        .task { await viewModel.load() }
        .task(id: viewModel.query) {
            guard viewModel.searchPending, await (try? Task.sleep(for: RankingsViewModel.searchPause)) != nil else {
                return
            }
            await viewModel.load()
        }
    }

    private var actions: RankingsActions {
        RankingsActions(
            open: { sheet.open($0) },
            choose: { chip in Task { await viewModel.choose(chip: chip) } },
            find: { viewModel.find($0) },
            more: { Task { await viewModel.showMore() } }
        )
    }
}
