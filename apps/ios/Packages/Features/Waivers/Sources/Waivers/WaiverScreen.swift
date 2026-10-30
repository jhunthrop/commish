import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// The Waivers screen as its model says it, in the web's order (WaiverScreen.svelte at 390): the strip,
/// the line when the week's projection is still to come, the table, the basis once at the foot. Pure of
/// state, so a snapshot draws it from the fixture; the pin above the bar is the caller's.
public struct WaiverScreen: View {
    let model: WaiverModel
    let stamp: String?
    let chosenCard: String?
    let chooseCard: (String) -> Void
    let actions: TableActions
    let filters: FiltersView
    let panel: PanelActions

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            ForEach(WaiverPart.allCases, id: \.self) { part in
                partView(part)
            }
        }
        .padding(.vertical, Tokens.Space.s4)
    }

    func partView(_ part: WaiverPart) -> WaiverPartView {
        WaiverPartView(
            part: part, model: model, stamp: stamp, chosenCard: chosenCard, chooseCard: chooseCard, actions: actions,
            filters: filters, panel: panel
        )
    }
}

/// The screen's runs, top to bottom: each a snapshot of its own, so no reference grows past what a
/// repository keeps.
enum WaiverPart: CaseIterable {
    /// The strip, the position panel and the rows that gain.
    case top
    /// The rest under the divider, the Stash group and the basis.
    case foot
}

struct WaiverPartView: View {
    let part: WaiverPart
    let model: WaiverModel
    let stamp: String?
    let chosenCard: String?
    let chooseCard: (String) -> Void
    let actions: TableActions
    let filters: FiltersView
    let panel: PanelActions

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            switch part {
            case .top:
                WaiverStripView(model: model, stamp: stamp, chosen: chosenCard, choose: chooseCard)
                WaiverPanelView(panel: panel)
                filters
                if let arrives = model.arrives {
                    BasisText(arrives)
                }
                WaiverTableView(model: model, groups: .gaining, actions: actions)
            case .foot:
                WaiverTableView(model: model, groups: [.rest, .stash], actions: actions)
                BasisText(model.basis)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
    }
}

/// The Waivers screen with its view model: the saved answer at once, then the API's; a pull reads again;
/// the verb pinned above the bar; a typed bid planned again once it rests; a row's name opens the player
/// sheet by his id, and the sheet keeps its player when the table reads again under it.
public struct WaiverView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(PlayerSheetHost.self) private var sheet
    private let viewModel: WaiverViewModel
    private let leagueID: String
    /// How long a typed bid rests before the claim is planned again for it (WaiverScreen's BID_PAUSE_MS).
    static let bidPause: Duration = .milliseconds(600)

    public init(viewModel: WaiverViewModel, leagueID: String) {
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
                    WaiverScreen(
                        model: model, stamp: viewModel.stampWords, chosenCard: viewModel.card?.key,
                        chooseCard: { viewModel.choose(card: $0) }, actions: actions(model),
                        filters: FiltersView(
                            positions: model.positions, chosen: viewModel.position,
                            choose: { position in
                                Task { await viewModel.choose(position: position, leagueID: leagueID) }
                            },
                            query: viewModel.query, find: { viewModel.find($0) }, problem: viewModel.problem
                        ),
                        panel: panel(model)
                    )
                }
                .refreshable { await viewModel.load(leagueID: leagueID) }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if !viewModel.pin.isEmpty {
                        WaiverPinView(pin: viewModel.pin, actions: WaiverPinActions(
                            press: { Task { await viewModel.press(leagueID: leagueID) } },
                            confirm: { Task { await viewModel.confirm(leagueID: leagueID) } },
                            close: { viewModel.close() },
                            bid: { viewModel.type(bid: $0) }
                        ))
                    }
                }
                .onChange(of: model) { _, fresh in
                    sheet.parentRefreshed(fresh.rows.compactMap(\.sheetPlayer))
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
        .task(id: leagueID) { await viewModel.load(leagueID: leagueID) }
        .task(id: viewModel.typed) {
            guard await (try? Task.sleep(for: Self.bidPause)) != nil else {
                return
            }
            await viewModel.replanBid(leagueID: leagueID)
        }
    }

    /// The sheet's verb on Waivers (WaiverScreen.svelte's shelfOffer): the claim in the screen's words
    /// with the pair and its gain under it, made from his row.
    private func offer(_ model: WaiverModel, _ player: SheetPlayer) -> SheetOffer? {
        guard let row = model.rows.first(where: { $0.sheetPlayer?.id == player.id }) else {
            return nil
        }
        let said = model.sheetOffer(row)
        let viewModel = viewModel
        let leagueID = leagueID
        return SheetOffer(label: said.label, line: said.line, lineup: false) {
            Task { await viewModel.claimFromSheet(row: row.key, leagueID: leagueID) }
        }
    }

    /// The position panel's cards and controls: a free agent's Add is the screen's one verb with the
    /// advice's drop; a name opens his sheet, with the table's verb where the table lists him.
    private func panel(_ model: WaiverModel) -> PanelActions {
        let viewModel = viewModel
        let leagueID = leagueID
        let cards = viewModel.panel
        return PanelActions(
            cards: cards, mode: viewModel.panelMode, hasWeek: model.panelHasWeek,
            opened: cards.first { $0.key == viewModel.openCard }, choose: { viewModel.choose(panelMode: $0) },
            toggle: { viewModel.toggle(card: $0) },
            add: { source in Task { await viewModel.addFromPanel(source, leagueID: leagueID) } },
            open: { sheet.open($0, offer: offer(model, $0)) }
        )
    }

    private func actions(_ model: WaiverModel) -> TableActions {
        TableActions(
            open: { sheet.open($0, offer: offer(model, $0)) }, tap: { viewModel.tap(row: $0) },
            chooseDrop: { viewModel.choose(drop: $0) },
            opened: viewModel.openRow, drops: viewModel.drops, chosenDrop: viewModel.chosenDrop,
            dropHead: viewModel.opened.map { model.dropHead($0) }, table: viewModel.table, sort: viewModel.sort,
            onSort: { viewModel.sort(by: $0) }, reading: viewModel.reading
        )
    }
}
