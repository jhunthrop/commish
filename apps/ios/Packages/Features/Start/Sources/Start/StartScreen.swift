import CommishCore
import CommishDesign
import SwiftUI

/// The Start screen as its model says it, in the web's order (StartScreen.svelte at 390): the strip,
/// the lineup with the Team row, the bench and the injured reserve, the basis once at the foot. Pure
/// of state, so a snapshot draws it from the fixture at the fixture's clock; the pin above the bar is
/// the caller's (StartView pins it, a snapshot draws it under the screen).
public struct StartScreen: View {
    let model: StartModel
    let stamp: String?
    let actions: RowActions

    public init(
        model: StartModel, stamp: String?, opened: Set<String> = [], open: @escaping (SheetPlayer) -> Void = { _ in },
        toggleWhy: @escaping (String) -> Void = { _ in }
    ) {
        self.model = model
        self.stamp = stamp
        actions = RowActions(open: open, toggleWhy: toggleWhy, opened: opened)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            ForEach(StartPart.allCases, id: \.self) { part in
                StartPartView(part: part, model: model, stamp: stamp, actions: actions)
            }
        }
        .padding(.vertical, Tokens.Space.s4)
    }
}

/// The screen's two runs, top to bottom: each a snapshot of its own, so no reference grows past what a
/// repository keeps.
enum StartPart: CaseIterable {
    /// The strip and the lineup with its Team row.
    case lineup
    /// The bench, the injured reserve and the basis.
    case bench
}

struct StartPartView: View {
    let part: StartPart
    let model: StartModel
    let stamp: String?
    let actions: RowActions

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            switch part {
            case .lineup:
                StripView(model: model, stamp: stamp)
                LineupTableView(model: model, actions: actions)
            case .bench:
                BenchView(model: model, actions: actions)
                BasisText(model.basis)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
    }
}

/// The Start screen with its view model: the saved lineup at once, then the API's; a pull reads again;
/// the verb pinned above the bar; a row's name opens the player sheet by his id, and the sheet keeps
/// its player when the lineup reads again under it.
public struct StartView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(PlayerSheetHost.self) private var sheet
    private let viewModel: StartViewModel
    private let leagueID: String

    public init(viewModel: StartViewModel, leagueID: String) {
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
                    StartScreen(
                        model: model, stamp: viewModel.stampWords, opened: viewModel.opened,
                        open: { sheet.open($0) }, toggleWhy: { viewModel.toggleWhy($0) }
                    )
                }
                .refreshable { await viewModel.load(leagueID: leagueID) }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if !viewModel.pin.isEmpty {
                        PinView(pin: viewModel.pin, actions: PinActions(
                            press: { Task { await viewModel.press(leagueID: leagueID) } },
                            confirm: { Task { await viewModel.confirm(leagueID: leagueID) } },
                            close: { viewModel.close() }
                        ))
                    }
                }
                .onChange(of: model) { _, fresh in
                    sheet.parentRefreshed((fresh.starters + fresh.bench + fresh.reserve).compactMap(\.sheetPlayer))
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
    }
}
