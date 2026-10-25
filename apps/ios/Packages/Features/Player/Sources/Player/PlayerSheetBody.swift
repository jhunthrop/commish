import CommishAPI
import CommishCore
import CommishDesign
import SwiftUI

/// The player sheet's content for the player the sheet opened on: it makes his view model once for his
/// id and keeps it, so the list under the sheet reading again (his fresh facts, a new order) neither
/// reads his week again nor changes the player it shows; a sheet opened on another player makes his.
public struct PlayerSheetContainer: View {
    @State private var viewModel: PlayerSheetViewModel?
    private let player: SheetPlayer
    private let offer: SheetOffer?
    private let close: () -> Void
    private let make: @MainActor (SheetPlayer) -> PlayerSheetViewModel

    public init(
        player: SheetPlayer, offer: SheetOffer?, close: @escaping () -> Void,
        make: @escaping @MainActor (SheetPlayer) -> PlayerSheetViewModel
    ) {
        self.player = player
        self.offer = offer
        self.close = close
        self.make = make
    }

    public var body: some View {
        Group {
            if let viewModel, viewModel.player.id == player.id {
                PlayerSheetBody(viewModel: viewModel, offer: offer, close: close)
            } else {
                PlayerSheetState(state: .loading, stamp: nil)
            }
        }
        .task(id: player.id) {
            if viewModel?.player.id != player.id {
                viewModel = make(player)
            }
            await viewModel?.load()
        }
    }
}

/// The player sheet's body over his view model: the shelf's words while his week is read, his card once
/// it is, the shelf's words for a week that could not be read; and the screen's verb pinned at its foot,
/// in its place once his game has kicked off on a lineup screen the held words (shelf.ts shelfVerb).
public struct PlayerSheetBody: View {
    private let viewModel: PlayerSheetViewModel
    private let offer: SheetOffer?
    private let close: () -> Void

    public init(viewModel: PlayerSheetViewModel, offer: SheetOffer?, close: @escaping () -> Void) {
        self.viewModel = viewModel
        self.offer = offer
        self.close = close
    }

    public var body: some View {
        ScrollView {
            PlayerSheetState(state: viewModel.state, stamp: viewModel.stampWords)
                .padding(.bottom, Tokens.Space.s5)
        }
        .scrollIndicators(.hidden)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let verb = SheetVerb.of(offer, game: Self.game(viewModel.state)) {
                SheetVerbView(verb: verb) {
                    offer?.act()
                    close()
                }
            }
        }
    }

    /// His game by his week's line once his card is read; before, the offer stands.
    static func game(_ state: PlayerSheetViewModel.State) -> GameRead? {
        guard case let .loaded(card, _) = state else {
            return nil
        }
        return card.game
    }
}

/// The sheet's verb at its foot (PlayerShelf.svelte's foot): the screen's verb with the line under it, or
/// the held words in its place.
public struct SheetVerbView: View {
    @Environment(\.colorScheme) private var colorScheme
    private let verb: SheetVerb
    private let action: () -> Void

    public init(verb: SheetVerb, action: @escaping () -> Void) {
        self.verb = verb
        self.action = action
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: Tokens.Space.s1) {
            switch verb {
            case let .act(label, line):
                Verb(label, action: action)
                if let line {
                    Text(line)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                        .foregroundStyle(theme.color(Tokens.Color.ink3))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            case let .held(words):
                Text(words)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
        }
        .padding(.vertical, Tokens.Space.s2)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .top) { Hairline() }
    }
}

/// The body at a state, as the mock draws it too.
public struct PlayerSheetState: View {
    private let state: PlayerSheetViewModel.State
    private let stamp: String?

    public init(state: PlayerSheetViewModel.State, stamp: String?) {
        self.state = state
        self.stamp = stamp
    }

    public var body: some View {
        switch state {
        case .loading:
            BasisText(PlayerSheetWords.unreadBasis(failed: false, weekTile: Words.Card.proj))
        case let .loaded(card, _):
            PlayerCardView(card: card, stamp: stamp)
        case let .failed(words):
            BasisText(words)
        }
    }
}
